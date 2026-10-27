/**
 * Shared helpers for the sync tests: deterministic block/transaction builders
 * and a fake ChainNode serving an in-memory canonical chain.
 */
import type { ChainNode, RawBlock, RawReceipt, RawTransaction } from '@/lib/sync';
import { normalizeBlock, normalizeTransaction, upsertBlocks, upsertTransactions } from '@/lib/sync';
import { Block } from '@/models/index';

export const hashOf = (label: string, n: number) =>
  `0x${label}${String(n).padStart(4, '0')}`.padEnd(66, '0');

export type TestBlock = RawBlock & { number: number; hash: string; parentHash: string };

export function tx(hash: string, block: TestBlock, index = 0): RawTransaction {
  return {
    hash,
    blockHash: block.hash,
    blockNumber: block.number,
    transactionIndex: index,
    from: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    value: '1000',
    gas: 21000,
    gasPrice: '1',
    input: '0x',
    nonce: index,
  };
}

export function block(
  number: number,
  label: string,
  parentHash: string,
  txHashes: string[] = []
): TestBlock {
  const b: TestBlock = {
    number,
    hash: hashOf(label, number),
    parentHash,
    miner: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    timestamp: 1_700_000_000 + number * 12,
    gasLimit: 8_000_000,
    gasUsed: 21_000 * txHashes.length,
    difficulty: '1',
    totalDifficulty: String(number),
    size: 500,
    nonce: '0x0',
    transactions: [],
    uncles: [],
  };
  b.transactions = txHashes.map((h, i) => tx(h, b, i));
  return b;
}

/** Canonical chain 0..n (label `can`). */
export function canonicalChain(n: number, txAt: Record<number, string[]> = {}): TestBlock[] {
  const blocks: TestBlock[] = [];
  for (let i = 0; i <= n; i++) {
    const parent = i === 0 ? '0x' + '0'.repeat(64) : blocks[i - 1].hash;
    blocks.push(block(i, 'can', parent, txAt[i] ?? []));
  }
  return blocks;
}

export class FakeNode implements ChainNode {
  blocks = new Map<number, RawBlock>();
  receipts = new Map<string, RawReceipt>();
  headerCalls = 0;
  constructor(chain: TestBlock[]) {
    for (const b of chain) this.blocks.set(b.number, b);
  }
  async getBlockNumber() {
    return Math.max(...this.blocks.keys());
  }
  async getBlock(height: number) {
    return this.blocks.get(height) ?? null;
  }
  async getBlockHeader(height: number) {
    this.headerCalls += 1;
    const b = this.blocks.get(height);
    return b ? { number: height, hash: String(b.hash), parentHash: String(b.parentHash) } : null;
  }
  async getTransactionReceipt(hash: string) {
    return this.receipts.get(hash) ?? { status: 1, gasUsed: 21000, contractAddress: null };
  }
}

export async function seed(blocks: RawBlock[]) {
  await upsertBlocks(blocks.map(normalizeBlock));
  const txs = blocks.flatMap((b) =>
    (b.transactions ?? [])
      .filter((t): t is RawTransaction => typeof t === 'object')
      .map((t) => normalizeTransaction(t, { status: 1, gasUsed: 21000 }, b))
  );
  await upsertTransactions(txs);
}

export async function dbHash(height: number) {
  const doc = (await Block.findOne({ number: height }).lean()) as { hash?: string } | null;
  return doc?.hash ?? null;
}
