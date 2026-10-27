/**
 * Node → database document normalization shared by tools/sync.ts and
 * tools/repair-chain.ts (lib/sync/reorg.ts).
 *
 * Every hash and address is stored lowercase; numbers come back from web3 v4
 * as bigint and are converted here.
 */

export interface RawBlockHeader {
  number: number;
  hash: string;
  parentHash: string;
}

/** Block as returned by the node (web3 v4 shapes; values may be bigint). */
export interface RawBlock {
  number?: unknown;
  hash?: unknown;
  parentHash?: unknown;
  nonce?: unknown;
  sha3Uncles?: unknown;
  logsBloom?: unknown;
  transactionsRoot?: unknown;
  stateRoot?: unknown;
  receiptsRoot?: unknown;
  miner?: unknown;
  difficulty?: unknown;
  totalDifficulty?: unknown;
  extraData?: unknown;
  size?: unknown;
  gasLimit?: unknown;
  gasUsed?: unknown;
  timestamp?: unknown;
  transactions?: ReadonlyArray<RawTransaction | string>;
  uncles?: ReadonlyArray<unknown>;
}

export interface RawTransaction {
  hash?: unknown;
  nonce?: unknown;
  blockHash?: unknown;
  blockNumber?: unknown;
  transactionIndex?: unknown;
  from?: unknown;
  to?: unknown;
  value?: unknown;
  gas?: unknown;
  gasPrice?: unknown;
  input?: unknown;
  data?: unknown;
  creates?: unknown;
}

export interface RawReceipt {
  status?: unknown;
  gasUsed?: unknown;
  contractAddress?: unknown;
}

/** What the sync code needs from a node. `tools/sync.ts` adapts web3; tests use a fake. */
export interface ChainNode {
  getBlockNumber(): Promise<number>;
  /** Full block with transaction objects, or null when the node has no block at that height. */
  getBlock(height: number): Promise<RawBlock | null>;
  /** Header only (hash / parentHash), or null. */
  getBlockHeader(height: number): Promise<RawBlockHeader | null>;
  getTransactionReceipt(hash: string): Promise<RawReceipt | null>;
}

export interface BlockDoc {
  number: number;
  hash: string;
  parentHash: string;
  nonce: string;
  sha3Uncles: string;
  logsBloom: string;
  transactionsRoot: string;
  stateRoot: string;
  receiptRoot: string;
  miner: string | null;
  difficulty: string;
  totalDifficulty: string;
  extraData: string;
  size: number;
  gasLimit: number;
  gasUsed: number;
  timestamp: number;
  transactions: string[];
  uncles: string[];
}

export interface TransactionDoc {
  hash: string;
  nonce: number;
  blockHash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string | null;
  to: string | null;
  creates: string | null;
  value: string;
  gas: number;
  gasUsed: number;
  gasPrice: string;
  input: string;
  timestamp: number;
  status: number | null;
}

export const toNumber = (value: unknown): number => {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return Number(value) || 0;
};

export const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  return String(value);
};

export const toHex = (value: unknown): string => toText(value).toLowerCase();

const toStatus = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value > 0n ? 1 : 0;
  if (typeof value === 'string')
    return value === '1' || value === '0x1' || value.toLowerCase() === 'true' ? 1 : 0;
  return value ? 1 : 0;
};

/** Transaction hashes of a raw block (objects or bare hashes). */
export function blockTransactionHashes(block: RawBlock): string[] {
  return (block.transactions ?? []).map((tx) => toHex(typeof tx === 'string' ? tx : tx.hash));
}

/** Transaction objects of a raw block (bare hashes are skipped). */
export function blockTransactionObjects(block: RawBlock): RawTransaction[] {
  return (block.transactions ?? []).filter(
    (tx): tx is RawTransaction => typeof tx === 'object' && tx !== null
  );
}

export function normalizeBlock(raw: RawBlock): BlockDoc {
  return {
    number: toNumber(raw.number),
    hash: toHex(raw.hash),
    parentHash: toHex(raw.parentHash),
    nonce: toText(raw.nonce),
    sha3Uncles: toText(raw.sha3Uncles),
    logsBloom: toText(raw.logsBloom),
    transactionsRoot: toText(raw.transactionsRoot),
    stateRoot: toText(raw.stateRoot),
    receiptRoot: toText(raw.receiptsRoot),
    miner: raw.miner ? toHex(raw.miner) : null,
    difficulty: toText(raw.difficulty),
    totalDifficulty: toText(raw.totalDifficulty),
    extraData: toText(raw.extraData),
    size: toNumber(raw.size),
    gasLimit: toNumber(raw.gasLimit),
    gasUsed: toNumber(raw.gasUsed),
    timestamp: toNumber(raw.timestamp),
    transactions: blockTransactionHashes(raw),
    uncles: (raw.uncles ?? []).map(toText),
  };
}

export function normalizeTransaction(
  tx: RawTransaction,
  receipt: RawReceipt | null,
  block: RawBlock
): TransactionDoc {
  const created = receipt?.contractAddress ?? tx.creates;
  return {
    hash: toHex(tx.hash),
    nonce: toNumber(tx.nonce),
    blockHash: toHex(tx.blockHash || block.hash),
    blockNumber: toNumber(tx.blockNumber ?? block.number),
    transactionIndex: toNumber(tx.transactionIndex),
    from: tx.from ? toHex(tx.from) : null,
    to: tx.to ? toHex(tx.to) : null,
    creates: created ? toHex(created) : null,
    value: toText(tx.value || '0'),
    gas: toNumber(tx.gas),
    gasUsed: receipt ? toNumber(receipt.gasUsed) : 0,
    gasPrice: toText(tx.gasPrice || '0'),
    input: toText(tx.input ?? tx.data ?? '0x'),
    timestamp: toNumber(block.timestamp),
    status: receipt ? toStatus(receipt.status) : null,
  };
}
