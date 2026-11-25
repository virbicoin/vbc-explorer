/**
 * VRC-20 transfer events as `tokentransfers` documents (tools/tokens.ts).
 *
 * One document is stored per event, keyed by transaction hash and log index.
 * Before the log index was stored the key was transaction hash + token, so a
 * transaction that moved the same token more than once (a swap through a
 * pair, adding or removing liquidity, a fee-on-transfer token) kept only one
 * of its transfers. Those documents carry no `logIndex`; they are replaced
 * the first time the full history of their token has been stored again.
 */

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** The fields of a node log the transfer document is built from. */
export interface TransferLog {
  topics?: ReadonlyArray<unknown>;
  data?: unknown;
  blockNumber?: unknown;
  transactionHash?: unknown;
  logIndex?: unknown;
}

export interface Erc20TransferDoc {
  tokenAddress: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  from: string;
  to: string;
  value: string;
  timestamp: Date;
}

const topicAddress = (topic: unknown) => `0x${String(topic).slice(26)}`.toLowerCase();

/**
 * The `tokentransfers` document of a VRC-20 Transfer event; null when the log
 * lacks what identifies the event (sender and recipient topics, transaction
 * hash, log index).
 */
export function erc20TransferFromLog(
  log: TransferLog,
  tokenAddress: string,
  blockTimestamp: number | bigint
): Erc20TransferDoc | null {
  const topics = log.topics ?? [];
  if (topics.length < 3 || !log.transactionHash) return null;
  if (log.logIndex === undefined || log.logIndex === null || log.blockNumber === undefined) {
    return null;
  }
  const logIndex = Number(log.logIndex);
  const blockNumber = Number(log.blockNumber);
  if (!Number.isSafeInteger(logIndex) || !Number.isSafeInteger(blockNumber)) return null;

  const data = typeof log.data === 'string' ? log.data : '';
  return {
    tokenAddress: tokenAddress.toLowerCase(),
    transactionHash: String(log.transactionHash).toLowerCase(),
    logIndex,
    blockNumber,
    from: topicAddress(topics[1]),
    to: topicAddress(topics[2]),
    // the amount is the event data; an event without data moved nothing
    value: data && data !== '0x' ? BigInt(data).toString() : '0',
    timestamp: new Date(Number(blockTimestamp) * 1000),
  };
}

/** Bulk operations storing one document per event (transaction hash + log index). */
export function erc20TransferUpserts(transfers: Erc20TransferDoc[]) {
  return transfers.map((transfer) => ({
    updateOne: {
      filter: { transactionHash: transfer.transactionHash, logIndex: transfer.logIndex },
      update: { $set: transfer },
      upsert: true,
    },
  }));
}

/**
 * The documents of a token written before the log index was stored (see the
 * file comment). `tokenId: null` keeps NFT transfers out of the match.
 */
export function legacyErc20TransferFilter(tokenAddress: string) {
  return { tokenAddress: tokenAddress.toLowerCase(), tokenId: null, logIndex: { $exists: false } };
}

/** The collection operations used here (a MongoDB driver collection satisfies it). */
export interface TransferCollection {
  bulkWrite(operations: ReturnType<typeof erc20TransferUpserts>): Promise<unknown>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
}

export interface StoreTransfersResult {
  stored: number;
  legacyRemoved: number;
}

/**
 * Stores the transfer history of a VRC-20 token, one document per event.
 *
 * `complete` says that `transfers` is every Transfer event of the token since
 * its first block. Only then are the token's documents without a log index
 * removed: every event they stood for has just been written, so nothing is
 * lost, and on an incomplete run they stay as the only record of the events
 * that could not be read. The new documents are written before the old ones
 * are removed, so an interrupted run leaves duplicates for the next run to
 * clear, never a gap.
 */
export async function storeErc20Transfers(
  collection: TransferCollection,
  tokenAddress: string,
  transfers: Erc20TransferDoc[],
  options: { complete: boolean; batchSize?: number }
): Promise<StoreTransfersResult> {
  const batchSize = options.batchSize ?? 200;
  for (let start = 0; start < transfers.length; start += batchSize) {
    await collection.bulkWrite(erc20TransferUpserts(transfers.slice(start, start + batchSize)));
  }

  let legacyRemoved = 0;
  if (options.complete) {
    const removed = await collection.deleteMany(legacyErc20TransferFilter(tokenAddress));
    legacyRemoved = removed.deletedCount ?? 0;
  }
  return { stored: transfers.length, legacyRemoved };
}
