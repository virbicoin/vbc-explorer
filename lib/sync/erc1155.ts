/**
 * VRC-1155 (ERC-1155) transfers, synced by tools/tokens.ts.
 *
 * - Contracts are found by their events: every TransferSingle / TransferBatch
 *   log of a block range is read with one topic-filtered eth_getLogs, so a
 *   collection deployed by a factory is found as well. An emitter is accepted
 *   when it answers ERC-165 `supportsInterface(0xd9b67a26)` and still has code
 *   (tokens are never created for addresses without code); it is registered in
 *   `tokens` (type VRC-1155) and `Contract` (ERC 1155).
 * - One `tokentransfers` document per token id of an event (`batchIndex` is the
 *   id's position in a TransferBatch), with `tokenType: 'VRC-1155'`, the id as
 *   a decimal string (ids are uint256) and the amount in `value`. Documents are
 *   written through the driver so the schema's numeric `tokenId` cast never
 *   applies.
 * - A range is rewritten as a whole (the VRC-1155 documents of its blocks are
 *   replaced), so a run can be repeated; the progress marker is
 *   scan_progress 'erc1155' (lib/sync/range-scan.ts), rewound by replaceBlock().
 * - Holders (`tokenholders`) are recomputed from all transfers of every token a
 *   range touched: one document per holder with the sum of its balances over
 *   all ids (exact, with BigInt); per-id balances are computed from the
 *   transfers when an API needs them (lib/api/erc1155.ts).
 */

import { ethers } from 'ethers';
import { Block, Contract, Token, TokenHolder, TokenTransfer } from '../../models/index';
import { ERC_CODES, ERC1155_INTERFACE_ID } from '../contract/erc';
import { hiddenFields } from '../security/display-name';
import { logger } from '../logger';
import { claimRange, completeRange, loadRangeScan } from './range-scan';
import { dbHeadNumber } from './reorg';

export const VRC1155_TYPE = 'VRC-1155';
export const TRANSFER_SINGLE_TOPIC = ethers.id(
  'TransferSingle(address,address,address,uint256,uint256)'
);
export const TRANSFER_BATCH_TOPIC = ethers.id(
  'TransferBatch(address,address,address,uint256[],uint256[])'
);

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const abi = ethers.AbiCoder.defaultAbiCoder();
const probe = new ethers.Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

/** A node log as eth_getLogs returns it (quantities as hex strings or numbers). */
export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string | number | bigint;
  transactionHash: string;
  logIndex: string | number | bigint;
  removed?: boolean;
}

export interface Erc1155TransferDoc {
  tokenType: typeof VRC1155_TYPE;
  tokenAddress: string;
  transactionHash: string;
  logIndex: number;
  batchIndex: number;
  blockNumber: number;
  timestamp: Date;
  operator: string;
  from: string;
  to: string;
  tokenId: string;
  value: string;
}

const topicAddress = (topic: string) => `0x${topic.slice(26)}`.toLowerCase();
const toInt = (value: string | number | bigint) => Number(BigInt(value));

/**
 * The transfer documents of a TransferSingle / TransferBatch log; [] for
 * another log, a removed one, or one whose data does not decode.
 */
export function erc1155TransfersFromLog(log: RawLog, blockTimestamp: number): Erc1155TransferDoc[] {
  if (log.removed || log.topics.length !== 4) return [];
  const [signature, operator, from, to] = log.topics.map((topic) => topic.toLowerCase());
  const base = {
    tokenType: VRC1155_TYPE,
    tokenAddress: log.address.toLowerCase(),
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex: toInt(log.logIndex),
    blockNumber: toInt(log.blockNumber),
    timestamp: new Date(blockTimestamp * 1000),
    operator: topicAddress(operator),
    from: topicAddress(from),
    to: topicAddress(to),
  } as const;
  try {
    if (signature === TRANSFER_SINGLE_TOPIC) {
      const [id, value] = abi.decode(['uint256', 'uint256'], log.data);
      return [{ ...base, batchIndex: 0, tokenId: id.toString(), value: value.toString() }];
    }
    if (signature === TRANSFER_BATCH_TOPIC) {
      const [ids, values] = abi.decode(['uint256[]', 'uint256[]'], log.data) as unknown as [
        bigint[],
        bigint[],
      ];
      if (ids.length !== values.length) return [];
      return ids.map((id, index) => ({
        ...base,
        batchIndex: index,
        tokenId: id.toString(),
        value: values[index].toString(),
      }));
    }
  } catch {
    return [];
  }
  return [];
}

/** Balance of every holder per token id (zero balances and the zero address left out). */
export function erc1155Balances(
  transfers: Array<{ from: string; to: string; tokenId: string; value: string }>
): Map<string, Map<string, bigint>> {
  const balances = new Map<string, Map<string, bigint>>();
  const add = (holder: string, id: string, amount: bigint) => {
    if (holder === ZERO_ADDRESS) return;
    const ids = balances.get(holder) ?? new Map<string, bigint>();
    ids.set(id, (ids.get(id) ?? 0n) + amount);
    balances.set(holder, ids);
  };
  for (const transfer of transfers) {
    const amount = BigInt(transfer.value || '0');
    add(transfer.from.toLowerCase(), transfer.tokenId, -amount);
    add(transfer.to.toLowerCase(), transfer.tokenId, amount);
  }
  for (const [holder, ids] of balances) {
    for (const [id, amount] of ids) if (amount === 0n) ids.delete(id);
    if (ids.size === 0) balances.delete(holder);
  }
  return balances;
}

// ---------------------------------------------------------------------------
// Node access

export interface Erc1155Node {
  getLogs(fromBlock: number, toBlock: number, topics: string[][]): Promise<RawLog[]>;
  /** eth_call at the latest block; null when it reverts. */
  call(to: string, data: string): Promise<string | null>;
  getCode(address: string): Promise<string>;
}

/** An Erc1155Node over a JSON-RPC URL (the explorer's own node). */
export function createErc1155Node(url: string): Erc1155Node {
  const provider = new ethers.JsonRpcProvider(url, undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  const hex = (n: number) => `0x${n.toString(16)}`;
  return {
    async getLogs(fromBlock, toBlock, topics) {
      return (await provider.send('eth_getLogs', [
        { fromBlock: hex(fromBlock), toBlock: hex(toBlock), topics },
      ])) as RawLog[];
    },
    async call(to, data) {
      try {
        return (await provider.send('eth_call', [{ to, data }, 'latest'])) as string;
      } catch {
        return null;
      }
    },
    async getCode(address) {
      return (await provider.send('eth_getCode', [address, 'latest'])) as string;
    },
  };
}

async function callView(node: Erc1155Node, to: string, fn: string, args: unknown[] = []) {
  const result = await node.call(to, probe.encodeFunctionData(fn, args));
  if (!result || result === '0x') return null;
  try {
    return probe.decodeFunctionResult(fn, result)[0] as unknown;
  } catch {
    return null;
  }
}

/** Whether `address` is an ERC-1155 contract (ERC-165) that still has code. */
export async function isErc1155Contract(node: Erc1155Node, address: string): Promise<boolean> {
  const code = await node.getCode(address);
  if (!code || code === '0x' || code === '0x0') return false;
  return (await callView(node, address, 'supportsInterface', [ERC1155_INTERFACE_ID])) === true;
}

/** Create the `tokens` and `Contract` records of a VRC-1155 contract found at `blockNumber`. */
async function registerErc1155Token(node: Erc1155Node, address: string, blockNumber: number) {
  const text = async (fn: 'name' | 'symbol') => {
    const value = await callView(node, address, fn);
    return typeof value === 'string' ? value : '';
  };
  const [name, symbol] = await Promise.all([text('name'), text('symbol')]);
  const hidden = hiddenFields({ name, symbol });
  await Token.updateOne(
    { address },
    {
      $setOnInsert: {
        address,
        name,
        symbol,
        decimals: 0,
        totalSupply: '0',
        supply: '0',
        holders: 0,
        type: VRC1155_TYPE,
        ...hidden,
      },
    },
    { upsert: true }
  );
  await Contract.updateOne(
    { address },
    {
      $setOnInsert: {
        address,
        blockNumber,
        ERC: ERC_CODES.ERC1155,
        contractName: name || symbol || VRC1155_TYPE,
        tokenName: name || null,
        symbol: symbol || null,
        decimals: 0,
        verified: false,
        ...hidden,
      },
    },
    { upsert: true }
  );
  logger.info('VRC-1155 token registered', { address, name, symbol, blockNumber });
}

const isErc1155Type = (type: unknown) =>
  typeof type === 'string' && type.replace(/\D/g, '') === '1155';

/** Recompute `tokenholders` and the holder count / outstanding amount of a token. */
export async function refreshErc1155Holders(tokenAddress: string): Promise<number> {
  const transfers = (await TokenTransfer.collection
    .find(
      { tokenAddress, tokenType: VRC1155_TYPE },
      { projection: { from: 1, to: 1, tokenId: 1, value: 1 } }
    )
    .toArray()) as unknown as Array<{ from: string; to: string; tokenId: string; value: string }>;
  const balances = erc1155Balances(transfers);
  const totals = [...balances].map(([holder, ids]) => ({
    holder,
    amount: [...ids.values()].reduce((sum, amount) => sum + amount, 0n),
  }));
  const outstanding = totals.reduce((sum, { amount }) => sum + amount, 0n);
  totals.sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));

  await TokenHolder.deleteMany({ tokenAddress });
  if (totals.length > 0) {
    await TokenHolder.collection.insertMany(
      totals.map(({ holder, amount }, index) => ({
        tokenAddress,
        holderAddress: holder,
        balance: amount.toString(),
        percentage: outstanding > 0n ? Number((amount * 1_000_000n) / outstanding) / 10_000 : 0,
        rank: index + 1,
      }))
    );
  }
  await Token.updateOne(
    { address: tokenAddress },
    {
      $set: {
        holders: totals.length,
        totalSupply: outstanding.toString(),
        supply: outstanding.toString(),
        updatedAt: new Date(),
      },
    }
  );
  return totals.length;
}

export interface Erc1155RangeResult {
  from: number;
  to: number;
  logs: number;
  transfers: number;
  registered: string[];
  touchedTokens: string[];
}

/**
 * Read the TransferSingle / TransferBatch logs of [from, to], register new
 * VRC-1155 contracts, replace the range's VRC-1155 transfers and refresh the
 * holders of the tokens it touched. Node errors are thrown before anything is
 * written.
 */
export async function syncErc1155Range(
  node: Erc1155Node,
  from: number,
  to: number
): Promise<Erc1155RangeResult> {
  const logs = (
    await node.getLogs(from, to, [[TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC]])
  ).filter((log) => !log.removed);
  const emitters = [...new Set(logs.map((log) => log.address.toLowerCase()))];

  const known = (
    emitters.length > 0
      ? await Token.find({ address: { $in: emitters } })
          .select('address type')
          .lean()
      : []
  ) as Array<{ address: string; type?: string }>;
  const typeOf = new Map(known.map((token) => [token.address, token.type]));
  const accepted = new Set<string>();
  const registered: string[] = [];
  for (const address of emitters) {
    if (typeOf.has(address)) {
      // a contract already listed as another standard keeps its record and transfers
      if (isErc1155Type(typeOf.get(address))) accepted.add(address);
      continue;
    }
    if (await isErc1155Contract(node, address)) {
      const firstBlock = Math.min(
        ...logs
          .filter((log) => log.address.toLowerCase() === address)
          .map((log) => toInt(log.blockNumber))
      );
      await registerErc1155Token(node, address, firstBlock);
      registered.push(address);
      accepted.add(address);
    }
  }

  const heights = [...new Set(logs.map((log) => toInt(log.blockNumber)))];
  const blocks = (
    heights.length > 0
      ? await Block.find({ number: { $in: heights } })
          .select('number timestamp')
          .lean()
      : []
  ) as Array<{ number: number; timestamp?: number }>;
  const timeOf = new Map(blocks.map((block) => [block.number, Number(block.timestamp) || 0]));
  const docs = logs
    .filter((log) => accepted.has(log.address.toLowerCase()))
    .flatMap((log) => erc1155TransfersFromLog(log, timeOf.get(toInt(log.blockNumber)) ?? 0));

  // the range is rewritten as a whole
  await TokenTransfer.collection.deleteMany({
    tokenType: VRC1155_TYPE,
    blockNumber: { $gte: from, $lte: to },
  });
  for (let start = 0; start < docs.length; start += 1000) {
    await TokenTransfer.collection.insertMany(docs.slice(start, start + 1000), { ordered: false });
  }

  const touchedTokens = [...new Set(docs.map((doc) => doc.tokenAddress))];
  for (const token of touchedTokens) await refreshErc1155Holders(token);
  return { from, to, logs: logs.length, transfers: docs.length, registered, touchedTokens };
}

export interface Erc1155SyncResult {
  ranges: number;
  transfers: number;
  registered: string[];
  lastScannedBlock: number;
}

/** Sync VRC-1155 transfers up to the confirmed head (stored head − confirmations − 1). */
export async function syncErc1155ToConfirmedHead(
  node: Erc1155Node,
  options: { confirmations: number; rangeBlocks?: number; maxRanges?: number }
): Promise<Erc1155SyncResult> {
  const rangeBlocks = options.rangeBlocks ?? 100_000;
  const total: Erc1155SyncResult = {
    ranges: 0,
    transfers: 0,
    registered: [],
    lastScannedBlock: -1,
  };
  for (;;) {
    if (options.maxRanges !== undefined && total.ranges >= options.maxRanges) break;
    const head = await dbHeadNumber();
    const state = await loadRangeScan('erc1155');
    total.lastScannedBlock = state.lastScannedBlock;
    if (head === null) break;
    const confirmedHead = head - options.confirmations - 1;
    if (state.lastScannedBlock >= confirmedHead) break;
    const from = state.lastScannedBlock + 1;
    const to = Math.min(from + rangeBlocks - 1, confirmedHead);
    if (!(await claimRange('erc1155', state, to))) continue;
    const result = await syncErc1155Range(node, from, to);
    if (!(await completeRange('erc1155', state, to))) {
      logger.warn('VRC-1155: a reorganisation touched the range; syncing it again', { from, to });
      continue;
    }
    total.ranges++;
    total.transfers += result.transfers;
    total.registered.push(...result.registered);
    total.lastScannedBlock = to;
  }
  return total;
}
