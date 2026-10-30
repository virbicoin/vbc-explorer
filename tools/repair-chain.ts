/**
 * Orphan block repair tool
 *
 * Verifies the stored chain and replaces orphaned blocks with the node's
 * canonical blocks (lib/sync/chain-check.ts + lib/sync/reorg.ts replaceBlock).
 * Run it against the local node only: --fix performs ~2 RPC calls per block.
 *
 * Usage:
 *   npm run repair-chain -- --check                 count gaps and parentHash mismatches (exit 1 when mismatches exist)
 *   npm run repair-chain -- --sample [k]            compare k random heights with the node (default 1000)
 *   npm run repair-chain -- --fix [--from n] [--to n] [--dry-run] [--max-depth 64] [--max-replace 256]
 *
 * --fix repairs every broken link from the common ancestor upward until the
 * chain reconnects, saves its position in scan_progress ('repair') so an
 * interrupted run resumes, then re-runs --check and exits 0 only when no
 * mismatch is left. --dry-run prints the heights and old/new hashes that would
 * be replaced and writes nothing.
 *
 * After a repair: recompute statistics from the lowest replaced height
 * (`RESCAN_FROM=<minReplaced> npm run stats`, or the equivalent legacy form
 * `RESCAN=100:<ceil((head - minReplaced) / 100) + 10>`); the token scan is
 * rewound automatically and will re-index transfers; richlist balances come
 * from the node, no action needed.
 *
 * Direct: npx tsx --tsconfig tsconfig.tools.json tools/repair-chain.ts --check
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import Web3 from 'web3';
import { connectDB, ensureIndexesOnStartup } from '../models/index';
import { getWeb3ProviderURL } from '../lib/config';
import { createWeb3Node } from '../lib/sync/web3-node';
import { checkChain, repairChain, rescanHint, sampleAgainstNode } from '../lib/sync/chain-check';

type Mode = 'check' | 'sample' | 'fix' | 'help';

export interface CliOptions {
  mode: Mode;
  sampleSize: number;
  from?: number;
  to?: number;
  dryRun: boolean;
  maxDepth: number;
  maxReplace: number;
}

function intArg(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = Number.parseInt(argv[index + 1] ?? '', 10);
  return Number.isFinite(value) ? value : undefined;
}

export function parseArgs(argv: string[]): CliOptions {
  let mode: Mode = 'help';
  if (argv.includes('--check')) mode = 'check';
  else if (argv.includes('--sample')) mode = 'sample';
  else if (argv.includes('--fix')) mode = 'fix';
  return {
    mode,
    sampleSize: intArg(argv, '--sample') ?? 1000,
    from: intArg(argv, '--from'),
    to: intArg(argv, '--to'),
    dryRun: argv.includes('--dry-run'),
    maxDepth: intArg(argv, '--max-depth') ?? 64,
    maxReplace: intArg(argv, '--max-replace') ?? 256,
  };
}

function usage(): void {
  console.log(`
🔗 repair-chain — verify the stored chain and replace orphaned blocks

  npm run repair-chain -- --check                 gaps + parentHash mismatches (exit 1 when mismatches exist)
  npm run repair-chain -- --sample [k]            compare k random heights with the node (default 1000)
  npm run repair-chain -- --fix [--from n] [--to n] [--dry-run] [--max-depth 64] [--max-replace 256]
`);
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.mode === 'help') {
    usage();
    return 0;
  }

  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ MongoDB connection failed');
    return 1;
  }
  await ensureIndexesOnStartup('repair-chain');

  if (options.mode === 'check') {
    console.log('🔍 Checking parentHash links of every stored block...');
    const result = await checkChain({
      from: options.from,
      to: options.to,
      onProgress: (scanned, height) =>
        console.log(`  … ${scanned} blocks scanned (height ${height})`),
    });
    console.log(
      `\n📊 Scanned ${result.scanned} blocks (${result.first ?? '-'}..${result.last ?? '-'})`
    );
    console.log(
      `   gaps: ${result.gaps}${result.gapRanges.length ? ` (first: ${result.gapRanges.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(', ')})` : ''}`
    );
    console.log(
      `   parentHash mismatches: ${result.mismatches}${result.mismatchHeights.length ? ` (first: ${result.mismatchHeights.join(', ')})` : ''}`
    );
    return result.mismatches === 0 ? 0 : 1;
  }

  const providerUrl = getWeb3ProviderURL();
  console.log(`🔌 Node: ${providerUrl}`);
  const node = createWeb3Node(new Web3(new Web3.providers.HttpProvider(providerUrl)));

  if (options.mode === 'sample') {
    console.log(`🎲 Comparing ${options.sampleSize} random heights with the node...`);
    const result = await sampleAgainstNode(node, options.sampleSize);
    console.log(
      `\n📊 checked ${result.checked}, missing in DB ${result.missingInDb}, mismatches ${result.mismatches}`
    );
    for (const example of result.examples) {
      console.log(
        `  - height ${example.height}: db ${example.dbHash} node ${example.nodeHash ?? '(none)'}`
      );
    }
    return result.mismatches === 0 ? 0 : 1;
  }

  console.log(
    `🛠️  Repairing orphaned blocks${options.dryRun ? ' (dry run: nothing is written)' : ''}` +
      `${options.from !== undefined ? ` from ${options.from}` : ''}${options.to !== undefined ? ` to ${options.to}` : ''} ` +
      `(max depth ${options.maxDepth}, max ${options.maxReplace} replacements per site)`
  );
  const result = await repairChain(node, {
    from: options.from,
    to: options.to,
    dryRun: options.dryRun,
    maxDepth: options.maxDepth,
    maxReplacePerSite: options.maxReplace,
    onProgress: (done, total, height) =>
      console.log(`  … ${done}/${total} sites processed (height ${height})`),
  });

  console.log(`\n📊 ${result.sites} broken link(s) found`);
  if (result.dryRun) {
    console.log(`   ${result.planned.length} block(s) would be replaced:`);
    for (const plan of result.planned.slice(0, 200)) {
      console.log(`  - ${plan.height}: ${plan.oldHash ?? '(missing)'} → ${plan.newHash}`);
    }
    if (result.planned.length > 200) console.log(`  … and ${result.planned.length - 200} more`);
  } else {
    console.log(
      `   replaced ${result.replaced.length} block(s), transactions: -${result.deletedTransactions} +${result.addedTransactions}, token transfers removed: ${result.deletedTokenTransfers}`
    );
  }
  for (const skipped of result.skippedSites) {
    console.log(`  ⚠️  site ${skipped.height} skipped: ${skipped.reason}`);
  }
  for (const site of result.capReached) {
    console.log(`  ⚠️  site ${site}: replacement cap reached, re-run --fix to continue`);
  }
  if (result.minReplaced !== null) {
    const head = await node.getBlockNumber();
    const hint = rescanHint(result.minReplaced, head);
    console.log(
      `\n   replaced range: ${result.minReplaced}..${result.maxReplaced} (chain head ${head})`
    );
    console.log(`   next: ${hint.preferred}   (BlockStat of the replaced heights was removed)`);
    console.log(
      `         equivalent legacy form: ${hint.legacy}   (RESCAN=<interval>:<range> scans range × interval blocks back from the head)`
    );
    console.log(
      '   token transfers of the replaced heights are re-indexed by the next tokens run (scan progress rewound)'
    );
  }
  if (result.verification) {
    console.log(
      `\n✅ verification: ${result.verification.scanned} blocks, ${result.verification.gaps} gap(s), ${result.verification.mismatches} mismatch(es)`
    );
    return result.verification.mismatches === 0 && result.skippedSites.length === 0 ? 0 : 1;
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
