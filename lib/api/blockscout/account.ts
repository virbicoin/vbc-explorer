/**
 * Account module handlers for the Blockscout/Etherscan-compatible API.
 *
 * Implements the `account` actions: balance, balancemulti, eth_get_balance, balancehistory,
 * txlist, txlistinternal, pendingtxlist, txsBeaconWithdrawal, tokentx, tokennfttx, token1155tx,
 * tokenbalance, tokenbalancehistory, tokenlist, addresstokenbalance, addresstokennftbalance,
 * addresstokennftinventory, fundedby, listaccounts and getminedblocks.
 */

import { decodeFunctionResult, encodeFunctionData, numberToHex, type Address } from 'viem';
import {
  connectDB,
  Account,
  Block,
  InternalTransaction,
  Transaction,
  Token,
  TokenHolder,
  TokenTransfer,
} from '@/models/index';
import { requireDb } from '@/lib/db/get-db';
import { getNftOwnershipFromDb } from '@/lib/services/nft.service';
import { getClient } from '@/lib/web3/provider';
import { ercTokenType } from '@/lib/api/token-standard';
import {
  publicClient,
  successResponse,
  errorResponse,
  emptyListResponse,
  rpcResponse,
  rpcErrorResponse,
  txStatusFields,
  methodId,
  getHeadNumber,
  confirmations,
} from './shared';
import { getRewardSchedule } from '@/lib/config';
import { minerRewardWei, transactionFeesWei } from '@/lib/reward-schedule';

/** Paging, order and block range shared by the list actions. */
export interface ListOptions {
  page: number;
  offset: number;
  sort: 'asc' | 'desc';
  startblock?: number;
  endblock?: number;
}

function blockRange(options: ListOptions): Record<string, number> | null {
  const range: Record<string, number> = {};
  if (options.startblock !== undefined) range.$gte = options.startblock;
  if (options.endblock !== undefined) range.$lte = options.endblock;
  return Object.keys(range).length > 0 ? range : null;
}

function toUnixSeconds(value: unknown): string {
  if (typeof value === 'number') return String(value > 1e12 ? Math.floor(value / 1000) : value);
  if (value instanceof Date || typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? '' : String(Math.floor(ms / 1000));
  }
  return '';
}

export async function getBalance(address: string) {
  try {
    const balance = await publicClient.getBalance({ address: address as Address });
    return successResponse(balance.toString());
  } catch (error) {
    return errorResponse('Error fetching balance');
  }
}

export async function getBalanceMulti(addresses: string) {
  try {
    const addressList = addresses.split(',').slice(0, 20); // Max 20 addresses
    const balances = await Promise.all(
      addressList.map(async (addr) => {
        const balance = await publicClient.getBalance({ address: addr.trim() as Address });
        return {
          account: addr.trim(),
          balance: balance.toString(),
        };
      })
    );
    return successResponse(balances);
  } catch (error) {
    return errorResponse('Error fetching balances');
  }
}

/** Blockscout `eth_get_balance`: the node's answer in the JSON-RPC envelope. */
export async function getEthGetBalance(address: string, block: string) {
  try {
    const balance = await publicClient.request({
      method: 'eth_getBalance',
      params: [address as Address, block as `0x${string}`],
    });
    return rpcResponse(balance);
  } catch (error) {
    return rpcErrorResponse('Balance not found');
  }
}

export async function getTxList(address: string, options: ListOptions) {
  try {
    await connectDB();
    const account = address.toLowerCase();
    const direction = options.sort === 'asc' ? 1 : -1;
    const filter: Record<string, unknown> = { $or: [{ from: account }, { to: account }] };
    const range = blockRange(options);
    if (range) filter.blockNumber = range;

    const [txs, head] = await Promise.all([
      Transaction.find(filter)
        .sort({ blockNumber: direction, transactionIndex: direction })
        .skip((options.page - 1) * options.offset)
        .limit(options.offset)
        .lean(),
      getHeadNumber(),
    ]);
    if (txs.length === 0) return emptyListResponse();

    const result = txs.map((tx: Record<string, unknown>) => ({
      blockNumber: String(tx.blockNumber),
      timeStamp: String(tx.timestamp ?? ''),
      hash: tx.hash,
      nonce: String(tx.nonce ?? 0),
      blockHash: tx.blockHash || '',
      transactionIndex: String(tx.transactionIndex ?? 0),
      from: tx.from,
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      gas: String(tx.gas ?? 0),
      gasPrice: tx.gasPrice?.toString() || '0',
      ...txStatusFields(tx.status),
      input: tx.input || '0x',
      // address of the contract a creation transaction deployed
      contractAddress: tx.creates || '',
      // not stored (the sync keeps only the transaction's own gas)
      cumulativeGasUsed: '0',
      gasUsed: String(tx.gasUsed ?? 0),
      confirmations: confirmations(head, tx.blockNumber),
      methodId: methodId(tx.input),
      functionName: '',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transactions');
  }
}

/** `tokentransfers` condition selecting one token standard. */
export function transferKindFilter(kind: 'erc20' | 'erc721' | 'erc1155'): Record<string, unknown> {
  // tokenId is only set on NFT transfers; VRC-1155 transfers are marked by tokenType
  if (kind === 'erc1155') return { tokenType: 'VRC-1155' };
  if (kind === 'erc721') return { tokenId: { $ne: null }, tokenType: { $ne: 'VRC-1155' } };
  return { tokenId: null };
}

/**
 * Token transfer events of an address and/or a token contract, from the
 * `tokentransfers` collection: `tokentx` (fungible, `value`), `tokennfttx`
 * (ERC-721, `tokenID`) and `token1155tx` (ERC-1155, `tokenID` + `tokenValue`).
 * Transfers of tokens hidden as spam are left out unless that contract is
 * asked for by address.
 */
export async function getTokenTransfers(
  kind: 'erc20' | 'erc721' | 'erc1155',
  address: string | undefined,
  contractaddress: string | undefined,
  options: ListOptions
) {
  try {
    await connectDB();
    const direction = options.sort === 'asc' ? 1 : -1;
    const filter: Record<string, unknown> = transferKindFilter(kind);
    if (address) {
      const account = address.toLowerCase();
      filter.$or = [{ from: account }, { to: account }];
    }
    if (contractaddress) {
      filter.tokenAddress = contractaddress.toLowerCase();
    } else {
      const hidden = (await Token.find({ hidden: true }).distinct('address')) as string[];
      if (hidden.length > 0) filter.tokenAddress = { $nin: hidden };
    }
    const range = blockRange(options);
    if (range) filter.blockNumber = range;

    const transfers = (await TokenTransfer.find(filter)
      // by time only, so the per-address indexes ({ from | to, timestamp }) serve the order
      .sort({ timestamp: direction })
      .skip((options.page - 1) * options.offset)
      .limit(options.offset)
      .lean()) as Array<Record<string, unknown>>;
    if (transfers.length === 0) return emptyListResponse();

    const tokenAddresses = [...new Set(transfers.map((t) => String(t.tokenAddress)))];
    const hashes = [...new Set(transfers.map((t) => String(t.transactionHash)))];
    const [tokens, txs, head] = await Promise.all([
      Token.find({ address: { $in: tokenAddresses } }).lean(),
      Transaction.find({ hash: { $in: hashes } })
        .select('hash nonce blockHash transactionIndex gas gasPrice gasUsed input')
        .lean(),
      getHeadNumber(),
    ]);
    const tokenByAddress = new Map(
      (tokens as Array<Record<string, unknown>>).map((token) => [String(token.address), token])
    );
    const txByHash = new Map(
      (txs as Array<Record<string, unknown>>).map((tx) => [String(tx.hash), tx])
    );

    const result = transfers.map((transfer) => {
      const token = tokenByAddress.get(String(transfer.tokenAddress));
      const tx = txByHash.get(String(transfer.transactionHash));
      const amount =
        kind === 'erc721'
          ? { tokenID: String(transfer.tokenId) }
          : kind === 'erc1155'
            ? { tokenID: String(transfer.tokenId), tokenValue: transfer.value?.toString() || '0' }
            : { value: transfer.value?.toString() || '0' };
      return {
        blockNumber: String(transfer.blockNumber),
        timeStamp: toUnixSeconds(transfer.timestamp),
        hash: transfer.transactionHash,
        nonce: String(tx?.nonce ?? 0),
        blockHash: tx?.blockHash || '',
        from: transfer.from,
        contractAddress: transfer.tokenAddress,
        to: transfer.to,
        ...amount,
        tokenName: token?.name || '',
        tokenSymbol: token?.symbol || '',
        ...(kind === 'erc1155'
          ? {}
          : { tokenDecimal: kind === 'erc721' ? '0' : String(token?.decimals ?? 18) }),
        transactionIndex: String(tx?.transactionIndex ?? 0),
        gas: String(tx?.gas ?? 0),
        gasPrice: tx?.gasPrice?.toString() || '0',
        gasUsed: String(tx?.gasUsed ?? 0),
        cumulativeGasUsed: '0',
        input: 'deprecated',
        methodId: methodId(tx?.input),
        functionName: '',
        confirmations: confirmations(head, transfer.blockNumber),
      };
    });

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token transfers');
  }
}

/** What `txlistinternal` is asked for: a transaction, an address, or only a block range. */
export interface InternalListQuery {
  txhash?: string;
  address?: string;
}

/** Calls that moved value, and creations / selfdestructs of any value. */
const VALUE_OR_CONTRACT = {
  $or: [{ value: { $ne: '0' } }, { type: { $in: ['create', 'create2', 'selfdestruct'] } }],
};

/** Etherscan / Blockscout `txlistinternal` row of an `InternalTransaction` document. */
function internalTransactionRow(doc: Record<string, unknown>) {
  const traceAddress = Array.isArray(doc.traceAddress) ? (doc.traceAddress as number[]) : [];
  return {
    blockNumber: String(doc.blockNumber),
    timeStamp: String(doc.timestamp ?? ''),
    // Etherscan names the transaction `hash`, Blockscout `transactionHash`
    hash: doc.transactionHash,
    transactionHash: doc.transactionHash,
    from: doc.from,
    to: doc.to || '',
    value: String(doc.value ?? '0'),
    contractAddress: doc.createdContract || '',
    // call data is not stored
    input: '',
    type: doc.type,
    callType: doc.callType || '',
    gas: String(doc.gas ?? '0'),
    gasUsed: String(doc.gasUsed ?? '0'),
    traceId: traceAddress.length > 0 ? traceAddress.join('_') : '0',
    index: String(doc.index),
    // also 1 below a failed call: the value did not move
    isError: doc.reverted ? '1' : '0',
    errCode: doc.error || '',
  };
}

/**
 * `txlistinternal`: internal transactions (tools/internal-txs.ts) of a
 * transaction, of an address (sender, receiver or created contract) or of a
 * block range. As on Etherscan and Blockscout only calls that moved value and
 * contract creations / selfdestructs are listed; the v2 lists have every call.
 */
export async function getInternalTransactions(query: InternalListQuery, options: ListOptions) {
  try {
    await connectDB();
    const conditions: Array<Record<string, unknown>> = [VALUE_OR_CONTRACT];
    if (query.txhash) conditions.push({ transactionHash: query.txhash.toLowerCase() });
    if (query.address) {
      const account = query.address.toLowerCase();
      conditions.push({ $or: [{ from: account }, { to: account }, { createdContract: account }] });
    }
    const range = blockRange(options);
    if (range) conditions.push({ blockNumber: range });
    const direction = options.sort === 'asc' ? 1 : -1;

    const docs = (await InternalTransaction.find({ $and: conditions })
      .sort(
        query.txhash
          ? { index: direction }
          : { blockNumber: direction, transactionIndex: direction, index: direction }
      )
      .skip((options.page - 1) * options.offset)
      .limit(options.offset)
      .lean()) as Array<Record<string, unknown>>;
    if (docs.length === 0) return emptyListResponse();
    return successResponse(docs.map(internalTransactionRow));
  } catch (error) {
    return errorResponse('Error fetching internal transactions');
  }
}

/** Blockscout `account/tokenlist`: the tokens an address holds. */
export async function getAccountTokenList(address: string) {
  try {
    await connectDB();
    const holdings = (
      (await TokenHolder.find({
        holderAddress: address.toLowerCase(),
        balance: { $nin: ['0', ''], $exists: true },
      }).lean()) as Array<Record<string, unknown>>
    ).filter((holding) => /^[1-9]\d*$/.test(String(holding.balance)));

    const tokens = (await Token.find({
      address: { $in: holdings.map((holding) => String(holding.tokenAddress)) },
    }).lean()) as Array<Record<string, unknown>>;
    const tokenByAddress = new Map(tokens.map((token) => [String(token.address), token]));

    const result = holdings
      .filter((holding) => !tokenByAddress.get(String(holding.tokenAddress))?.hidden)
      .map((holding) => {
        const token = tokenByAddress.get(String(holding.tokenAddress));
        return {
          balance: String(holding.balance),
          contractAddress: holding.tokenAddress,
          decimals: token ? String(token.decimals ?? 18) : '',
          name: token?.name || '',
          symbol: token?.symbol || '',
          type: ercTokenType(token?.type as string | undefined),
        };
      })
      .sort((a, b) => String(a.contractAddress).localeCompare(String(b.contractAddress)));

    if (result.length === 0) return emptyListResponse('No tokens found');
    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token list');
  }
}

// Get specific token balance for an address
export async function getTokenBalance(address: string, contractaddress: string) {
  try {
    // ERC20 balanceOf ABI
    const balanceOfAbi = [
      {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ] as const;

    const balance = await publicClient.readContract({
      address: contractaddress as Address,
      abi: balanceOfAbi,
      functionName: 'balanceOf',
      args: [address as Address],
    });

    return successResponse(balance.toString());
  } catch (error) {
    return errorResponse('Error fetching token balance');
  }
}

// Get blocks mined by address
export async function getMinedBlocks(address: string, page = 1, offset = 10) {
  try {
    await connectDB();
    const skip = (page - 1) * offset;

    const blocks = await Block.find({
      miner: address.toLowerCase(),
    })
      .sort({ number: -1 })
      .skip(skip)
      .limit(offset)
      .lean();
    if (blocks.length === 0) return emptyListResponse();

    // Etherscan's blockReward is what the miner got: reward + fees + uncle inclusion reward
    const txs = (await Transaction.find({
      blockNumber: { $in: blocks.map((block: Record<string, unknown>) => Number(block.number)) },
    })
      .select('blockNumber gasUsed gasPrice')
      .lean()) as Array<{ blockNumber: number; gasUsed?: number; gasPrice?: string }>;
    const schedule = getRewardSchedule();
    const result = blocks.map((block: Record<string, unknown>) => {
      const number = Number(block.number);
      const reward = minerRewardWei(
        schedule,
        number,
        (block.uncles as string[] | undefined)?.length ?? 0,
        transactionFeesWei(txs.filter((tx) => tx.blockNumber === number))
      );
      return {
        blockNumber: String(block.number),
        timeStamp: String(block.timestamp || ''),
        blockReward: reward.total.toString(),
      };
    });

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching mined blocks');
  }
}

// ============================================
// Further account actions (Etherscan PRO-style and Blockscout ones)
// ============================================

interface Paging {
  page: number;
  offset: number;
}

const ERC20_BALANCE_OF = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** Node error text for a historical query (a pruned node cannot answer). */
function historyError(error: unknown): string {
  const details = (error as { details?: unknown }).details;
  return typeof details === 'string' &&
    /missing trie node|state|pruned|not available/i.test(details)
    ? 'Historical state is not available from the node'
    : 'Error fetching historical balance';
}

/** Etherscan `account/balancehistory`: the native balance at a block (archive node needed). */
export async function getBalanceHistory(address: string, blockno: number) {
  try {
    const balance = (await publicClient.request({
      method: 'eth_getBalance',
      params: [address as Address, numberToHex(blockno)],
    } as never)) as string;
    return successResponse(BigInt(balance).toString());
  } catch (error) {
    return errorResponse(historyError(error));
  }
}

/** Etherscan `account/tokenbalancehistory`: a token balance at a block (archive node needed). */
export async function getTokenBalanceHistory(
  address: string,
  contractaddress: string,
  blockno: number
) {
  try {
    const data = (await publicClient.request({
      method: 'eth_call',
      params: [
        {
          to: contractaddress,
          data: encodeFunctionData({
            abi: ERC20_BALANCE_OF,
            functionName: 'balanceOf',
            args: [address as Address],
          }),
        },
        numberToHex(blockno),
      ],
    } as never)) as `0x${string}`;
    const balance = decodeFunctionResult({
      abi: ERC20_BALANCE_OF,
      functionName: 'balanceOf',
      data,
    });
    return successResponse(balance.toString());
  } catch (error) {
    return errorResponse(historyError(error));
  }
}

/** Holdings of an address with a positive balance, joined with their token records. */
async function positiveHoldings(address: string) {
  await connectDB();
  const holdings = (
    (await TokenHolder.find({ holderAddress: address }).lean()) as Array<Record<string, unknown>>
  ).filter((holding) => /^[1-9]\d*$/.test(String(holding.balance)));
  const tokens = (await Token.find({
    address: { $in: holdings.map((holding) => String(holding.tokenAddress)) },
    hidden: { $ne: true },
  }).lean()) as Array<Record<string, unknown>>;
  const byAddress = new Map(tokens.map((token) => [String(token.address), token]));
  return holdings
    .filter((holding) => byAddress.has(String(holding.tokenAddress)))
    .map((holding) => ({ holding, token: byAddress.get(String(holding.tokenAddress))! }))
    .sort((a, b) => String(a.holding.tokenAddress).localeCompare(String(b.holding.tokenAddress)));
}

function pageOf<T>(rows: T[], paging: Paging): T[] {
  return rows.slice((paging.page - 1) * paging.offset, paging.page * paging.offset);
}

/** Etherscan `account/addresstokenbalance`: the ERC-20 tokens an address holds. */
export async function getAddressTokenBalance(address: string, paging: Paging) {
  try {
    const rows = (await positiveHoldings(address))
      .filter(({ token }) => ercTokenType(token.type as string | undefined) === 'ERC-20')
      .map(({ holding, token }) => ({
        TokenAddress: String(holding.tokenAddress),
        TokenName: String(token.name ?? ''),
        TokenSymbol: String(token.symbol ?? ''),
        TokenQuantity: String(holding.balance),
        TokenDivisor: String(token.decimals ?? 18),
      }));
    const page = pageOf(rows, paging);
    return page.length > 0 ? successResponse(page) : emptyListResponse('No tokens found');
  } catch {
    return errorResponse('Error fetching token balances');
  }
}

/** Etherscan `account/addresstokennftbalance`: the NFT collections an address holds. */
export async function getAddressNftBalance(address: string, paging: Paging) {
  try {
    const rows = (await positiveHoldings(address))
      .filter(({ token }) =>
        ['ERC-721', 'ERC-1155'].includes(ercTokenType(token.type as string | undefined))
      )
      .map(({ holding, token }) => ({
        TokenAddress: String(holding.tokenAddress),
        TokenName: String(token.name ?? ''),
        TokenSymbol: String(token.symbol ?? ''),
        TokenQuantity: String(holding.balance),
      }));
    const page = pageOf(rows, paging);
    return page.length > 0 ? successResponse(page) : emptyListResponse('No tokens found');
  } catch {
    return errorResponse('Error fetching NFT balances');
  }
}

/** Etherscan `account/addresstokennftinventory`: the token ids an address owns in a collection. */
export async function getAddressNftInventory(
  address: string,
  contractaddress: string,
  paging: Paging
) {
  try {
    await connectDB();
    const { items } = await getNftOwnershipFromDb(requireDb(), contractaddress);
    const owned = items
      .filter((item) => item.owner === address)
      .sort((a, b) => a.tokenId - b.tokenId)
      .map((item) => ({ TokenAddress: contractaddress, TokenId: String(item.tokenId) }));
    const page = pageOf(owned, paging);
    return page.length > 0 ? successResponse(page) : emptyListResponse('No tokens found');
  } catch {
    return errorResponse('Error fetching NFT inventory');
  }
}

/**
 * Etherscan `account/fundedby`: the first transfer of the native coin into the address, from a
 * transaction or an internal transaction, whichever came first.
 */
export async function getFundedBy(address: string) {
  try {
    await connectDB();
    const [tx, internal] = await Promise.all([
      Transaction.findOne({ to: address, value: { $nin: ['0', '0x0', ''] }, status: { $ne: 0 } })
        .sort({ blockNumber: 1, transactionIndex: 1 })
        .lean() as Promise<Record<string, unknown> | null>,
      InternalTransaction.findOne({
        to: address,
        value: { $nin: ['0', '0x0', ''] },
        reverted: { $ne: true },
      })
        .sort({ blockNumber: 1, transactionIndex: 1, index: 1 })
        .lean() as Promise<Record<string, unknown> | null>,
    ]);
    const candidates = [
      tx && {
        block: Number(tx.blockNumber),
        position: Number(tx.transactionIndex ?? 0),
        timeStamp: toUnixSeconds(tx.timestamp),
        fundingAddress: String(tx.from),
        fundingTxn: String(tx.hash),
        value: String(tx.value),
      },
      internal && {
        block: Number(internal.blockNumber),
        position: Number(internal.transactionIndex ?? 0),
        timeStamp: toUnixSeconds(internal.timestamp),
        fundingAddress: String(internal.from),
        fundingTxn: String(internal.transactionHash),
        value: String(internal.value),
      },
    ].filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (candidates.length === 0) return errorResponse('No funding transaction found', '');
    candidates.sort((a, b) => a.block - b.block || a.position - b.position);
    const { position: _position, ...first } = candidates[0];
    return successResponse({ ...first, block: String(first.block) });
  } catch {
    return errorResponse('Error fetching funding transaction');
  }
}

/** Blockscout `account/listaccounts`: addresses by balance, largest first. */
export async function listAccounts(paging: Paging) {
  try {
    await connectDB();
    const rows = (await Account.aggregate([
      { $match: { balance: { $nin: ['0', '', null] } } },
      { $addFields: { balanceDecimal: { $toDecimal: '$balance' } } },
      { $sort: { balanceDecimal: -1, address: 1 } },
      { $skip: (paging.page - 1) * paging.offset },
      { $limit: paging.offset },
      { $project: { _id: 0, address: 1, balance: 1 } },
    ])) as Array<{ address: string; balance: string }>;
    if (rows.length === 0) return emptyListResponse('No accounts found');
    return successResponse(
      rows.map((row) => ({ address: row.address, balance: String(row.balance) }))
    );
  } catch {
    return errorResponse('Error fetching accounts');
  }
}

interface PendingTx {
  hash?: string;
  nonce?: string;
  from?: string;
  to?: string | null;
  value?: string;
  gas?: string;
  gasPrice?: string;
  input?: string;
}

/**
 * Pending transactions from the node's pool: `txpool_content` (Geth-style) or
 * `parity_pendingTransactions` (OpenEthereum-style); empty when the node offers neither.
 */
async function nodePendingTransactions(): Promise<PendingTx[]> {
  const send = (method: string) =>
    getClient().request({ method, params: [] } as never) as Promise<unknown>;
  try {
    const pool = (await send('txpool_content')) as {
      pending?: Record<string, Record<string, PendingTx>>;
    };
    return Object.values(pool?.pending ?? {}).flatMap((byNonce) => Object.values(byNonce));
  } catch {
    // not a Geth-style node
  }
  try {
    const list = await send('parity_pendingTransactions');
    return Array.isArray(list) ? (list as PendingTx[]) : [];
  } catch {
    return [];
  }
}

const hexToDecimal = (value: string | undefined | null) => (value ? BigInt(value).toString() : '');

/** Blockscout `account/pendingtxlist`: pending transactions from or to the address. */
export async function getPendingTxList(address: string, paging: Paging) {
  try {
    const rows = (await nodePendingTransactions())
      .filter((tx) => tx.from?.toLowerCase() === address || tx.to?.toLowerCase() === address)
      .map((tx) => ({
        hash: String(tx.hash ?? '').toLowerCase(),
        nonce: hexToDecimal(tx.nonce),
        from: String(tx.from ?? '').toLowerCase(),
        to: tx.to ? tx.to.toLowerCase() : '',
        value: hexToDecimal(tx.value),
        gas: hexToDecimal(tx.gas),
        gasPrice: hexToDecimal(tx.gasPrice),
        input: tx.input ?? '0x',
        contractAddress: '',
        cumulativeGasUsed: '',
        gasUsed: '',
      }));
    const page = pageOf(rows, paging);
    return page.length > 0 ? successResponse(page) : emptyListResponse();
  } catch {
    return errorResponse('Error fetching pending transactions');
  }
}
