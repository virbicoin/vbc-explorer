/**
 * Uncle reward backfill
 *
 * Fills Block.uncleReward — the coins created for a block's uncles (uncle
 * rewards + nephew rewards, lib/reward-schedule.ts) — on blocks stored before
 * the sync recorded it. /api/total_supply and the other supply figures add
 * these amounts to the block-reward schedule (lib/supply.ts), so run this once
 * after deploying the change, against the local node.
 *
 * Usage:
 *   npm run backfill-uncle-rewards                        fill every stored block with uncles but no uncleReward
 *   npm run backfill-uncle-rewards -- --dry-run           count them and the amount, write nothing
 *   npm run backfill-uncle-rewards -- --from 0 [--to n]   rescan a range (blocks already filled are skipped)
 *   options: --batch 1000 (blocks read per query), --concurrency 8 (parallel node lookups)
 *
 * Each block is checked against the node first; a stored block that is not
 * canonical (run `npm run repair-chain -- --fix`) or whose uncle lookup fails
 * is reported and the exit code is 1. Progress is saved in scan_progress
 * ('uncle-rewards'), so a plain re-run continues after the last scanned
 * height; `--from 0` retries reported blocks.
 *
 * Direct: npx tsx --tsconfig tsconfig.tools.json tools/backfill-uncle-rewards.ts --dry-run
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import Web3 from 'web3';
import { formatEther } from 'viem';
import { connectDB, ensureIndexesOnStartup } from '../models/index';
import { getWeb3ProviderURL } from '../lib/config';
import { createWeb3Node } from '../lib/sync/web3-node';
import { backfillUncleRewards } from '../lib/sync/uncle-rewards';

export interface CliOptions {
  help: boolean;
  dryRun: boolean;
  from?: number;
  to?: number;
  batchSize: number;
  concurrency: number;
}

function intArg(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = Number.parseInt(argv[index + 1] ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseArgs(argv: string[]): CliOptions {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    dryRun: argv.includes('--dry-run'),
    from: intArg(argv, '--from'),
    to: intArg(argv, '--to'),
    batchSize: Math.max(1, intArg(argv, '--batch') ?? 1000),
    concurrency: Math.max(1, intArg(argv, '--concurrency') ?? 8),
  };
}

function usage(): void {
  console.log(`
⛏️  backfill-uncle-rewards — record the uncle issuance of stored blocks (Block.uncleReward)

  npm run backfill-uncle-rewards                        fill blocks with uncles but no uncleReward
  npm run backfill-uncle-rewards -- --dry-run           count them, write nothing
  npm run backfill-uncle-rewards -- --from 0 [--to n]   rescan a range (filled blocks are skipped)
  options: --batch 1000 --concurrency 8
`);
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ MongoDB connection failed');
    return 1;
  }
  await ensureIndexesOnStartup('backfill-uncle-rewards');

  const providerUrl = getWeb3ProviderURL();
  console.log(`🔌 Node: ${providerUrl}`);
  const node = createWeb3Node(new Web3(new Web3.providers.HttpProvider(providerUrl)));

  console.log(
    `⛏️  Backfilling uncle rewards${options.dryRun ? ' (dry run: nothing is written)' : ''}`
  );
  let reported = 0;
  const summary = await backfillUncleRewards({
    node,
    from: options.from,
    to: options.to,
    batchSize: options.batchSize,
    concurrency: options.concurrency,
    dryRun: options.dryRun,
    onBatch: (progress) => {
      if (progress.scanned - reported >= 100_000 || progress.position >= progress.to) {
        reported = progress.scanned;
        console.log(
          `  … height ${progress.position}/${progress.to}: ${progress.withUncles} with uncles, ` +
            `${progress.filled} filled, ${progress.failedCount} failed`
        );
      }
    },
  });

  console.log(`\n📊 Scanned ${summary.scanned} blocks (${summary.from}..${summary.position})`);
  console.log(`   with uncles: ${summary.withUncles} (already recorded: ${summary.alreadySet})`);
  console.log(
    `   ${options.dryRun ? 'would fill' : 'filled'}: ${summary.filled} block(s), ${formatEther(BigInt(summary.filledWei))} coins of uncle issuance`
  );
  if (summary.failedCount > 0) {
    console.log(`   failed: ${summary.failedCount}`);
    for (const failure of summary.failed) {
      console.log(`  - ${failure.number}: ${failure.error}`);
    }
    if (summary.failedCount > summary.failed.length) {
      console.log(`  … and ${summary.failedCount - summary.failed.length} more`);
    }
    console.log('   re-run with --from 0 after fixing the cause (filled blocks are skipped)');
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  let code = 1;
  try {
    code = await run(process.argv.slice(2));
  } catch (error) {
    console.error('❌ Unexpected error:', error instanceof Error ? error.message : error);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      // nothing to clean up
    }
  }
  process.exit(code);
}

// `require` is undefined when this module is imported from an ESM test runner
if (typeof require !== 'undefined' && require.main === module) {
  void main();
}
