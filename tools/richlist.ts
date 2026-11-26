#!/usr/bin/env node
/**
 * Account balances for the richlist (`Account`): the current balance of every address the
 * stored chain has touched, as a transaction's sender, recipient or created contract, a block's
 * miner, or a party of an internal transaction.
 *
 * Incremental: a pass reads the addresses touched in the stored blocks after its marker
 * (`scan_progress` `richlist`) and asks the node for their balances at its latest state, so after
 * the first pass only what changed is read again. The worker (tools/worker.ts) runs a pass every
 * five minutes while the richlist is on (`richlist.enabled`).
 *
 * Until 2026-11-27 the tool walked from the head down to block 0 in steps of 50 blocks with pauses,
 * re-read already seen addresses by chance (30 % / 10 %), and never ran again once it reached
 * block 0: on TK04 the balances were two days old.
 *
 *   npm run richlist                one pass, then exit
 *   npm run richlist -- --from 0    recompute every balance (resets the marker first)
 */
import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import Web3 from 'web3';
import {
  connectDB,
  ensureIndexesOnStartup,
  Account,
  Block,
  InternalTransaction,
  ScanProgress,
  Transaction,
} from '../models/index';
import { getWeb3ProviderURL } from '../lib/config';

const SCAN = 'richlist';
/** Stored blocks whose addresses are read at once. */
const RANGE = 10_000;
/** Balances asked of the node at once. */
const CHUNK = 20;
/** Pause between passes in the worker. */
export const RICHLIST_INTERVAL_MS = 5 * 60 * 1000;
/** An address seen once in a pass is not read again in it; the set is dropped past this size. */
const SEEN_LIMIT = 1_000_000;

const ZERO = '0x0000000000000000000000000000000000000000';
const ADDRESS = /^0x[0-9a-f]{40}$/;

let web3: Web3 | null = null;
const node = () => (web3 ??= new Web3(new Web3.providers.HttpProvider(getWeb3ProviderURL())));

async function storedHead(): Promise<number> {
  const head = (await Block.findOne().sort({ number: -1 }).select('number').lean()) as {
    number: number;
  } | null;
  return head?.number ?? -1;
}

/** Addresses touched in the stored blocks from..to. */
async function touchedAddresses(from: number, to: number): Promise<string[]> {
  const inRange = { blockNumber: { $gte: from, $lte: to } };
  const lists = await Promise.all([
    Transaction.distinct('from', inRange),
    Transaction.distinct('to', inRange),
    Transaction.distinct('creates', { ...inRange, creates: { $ne: null } }),
    Block.distinct('miner', { number: { $gte: from, $lte: to } }),
    InternalTransaction.distinct('from', inRange),
    InternalTransaction.distinct('to', inRange),
    InternalTransaction.distinct('createdContract', { ...inRange, createdContract: { $ne: null } }),
  ]);
  const addresses = new Set<string>();
  for (const list of lists) {
    for (const value of list as unknown[]) {
      const address = typeof value === 'string' ? value.toLowerCase() : '';
      if (ADDRESS.test(address) && address !== ZERO) addresses.add(address);
    }
  }
  return [...addresses];
}

/** Reads the balances (and whether there is code) and stores them; returns how many were stored. */
async function refreshBalances(addresses: string[], head: number): Promise<number> {
  let stored = 0;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const read = await Promise.all(
      chunk.map(async (address) => {
        try {
          const [balance, code] = await Promise.all([
            node().eth.getBalance(address),
            node().eth.getCode(address),
          ]);
          return { address, balance: balance.toString(), type: code.length > 2 ? 1 : 0 };
        } catch (error) {
          console.warn(`⚠️ Balance of ${address} not read: ${(error as Error).message}`);
          return null;
        }
      })
    );
    const accounts = read.filter((account) => account !== null);
    if (accounts.length === 0) continue;
    await Account.bulkWrite(
      accounts.map((account) => ({
        updateOne: {
          filter: { address: account.address },
          // blockNumber: the stored head the balance was read at
          update: { $set: { ...account, blockNumber: head } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    stored += accounts.length;
  }
  return stored;
}

/** One pass: the addresses touched since the marker, up to the stored head. */
export async function richlistPass(): Promise<{ from: number; to: number; accounts: number }> {
  const head = await storedHead();
  const marker = (await ScanProgress.findOne({ scanType: SCAN })
    .select('lastScannedBlock')
    .lean()) as { lastScannedBlock?: number } | null;
  const start = (marker?.lastScannedBlock ?? -1) + 1;
  let accounts = 0;
  const seen = new Set<string>();
  for (let from = start; from <= head; from += RANGE) {
    const to = Math.min(from + RANGE - 1, head);
    const fresh = (await touchedAddresses(from, to)).filter((address) => !seen.has(address));
    accounts += await refreshBalances(fresh, head);
    if (seen.size > SEEN_LIMIT) seen.clear();
    fresh.forEach((address) => seen.add(address));
    await ScanProgress.updateOne(
      { scanType: SCAN },
      { lastScannedBlock: to, lastUpdateTime: new Date() },
      { upsert: true }
    );
  }
  return { from: start, to: head, accounts };
}

async function initDB(): Promise<void> {
  await connectDB();
  if (mongoose.connection.readyState !== 1) throw new Error('database connection failed');
  await ensureIndexesOnStartup('richlist');
}

const logPass = (result: { from: number; to: number; accounts: number }) => {
  if (result.from > result.to) return;
  console.log(
    `💰 Richlist: ${result.accounts} balances read for blocks ${result.from}-${result.to}`
  );
};

/** The worker's job: a pass now and then every RICHLIST_INTERVAL_MS. */
export async function runRichlist(): Promise<void> {
  await initDB();
  for (;;) {
    try {
      logPass(await richlistPass());
    } catch (error) {
      console.error(
        '❌ Richlist pass failed; retrying at the next pass:',
        (error as Error).message
      );
    }
    await new Promise((resolve) => setTimeout(resolve, RICHLIST_INTERVAL_MS));
  }
}

if (require.main === module) {
  (async () => {
    await initDB();
    const fromIndex = process.argv.indexOf('--from');
    if (fromIndex >= 0) {
      const from = Number.parseInt(process.argv[fromIndex + 1] ?? '', 10);
      if (!Number.isSafeInteger(from) || from < 0) throw new Error('--from needs a block number');
      await ScanProgress.updateOne(
        { scanType: SCAN },
        { lastScannedBlock: from - 1, lastUpdateTime: new Date() },
        { upsert: true }
      );
      console.log(`Richlist marker reset: the next pass starts at block ${from}`);
    }
    logPass(await richlistPass());
    await mongoose.disconnect();
  })().catch((error) => {
    console.error('❌', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
