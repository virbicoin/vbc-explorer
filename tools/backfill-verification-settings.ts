/**
 * Verification settings backfill
 *
 * Records verified before 2026-11 have no optimizationRuns / evmVersion / license, and the web
 * form stored its own optimization flag even for standard JSON inputs that enabled the
 * optimizer. For every verified record whose stored source is a standard JSON input, this sets
 * the settings of that input (lib/contract/verification-backfill.ts). Single-file records are
 * left alone (their settings are not known).
 *
 * Usage:
 *   npm run backfill-verification-settings -- --dry-run   list the changes, write nothing
 *   npm run backfill-verification-settings                write them
 *
 * Direct: npx tsx --tsconfig tsconfig.tools.json tools/backfill-verification-settings.ts --dry-run
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import { connectDB } from '../models/index';
import { backfillVerificationSettings } from '../lib/contract/verification-backfill';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: backfill-verification-settings [--dry-run]');
    return 0;
  }
  const dryRun = args.includes('--dry-run');
  await connectDB();
  const result = await backfillVerificationSettings({ dryRun });
  for (const { address, name, fix } of result.changed) {
    console.log(`${dryRun ? 'would set' : 'set'} ${address} ${name}: ${JSON.stringify(fix)}`);
  }
  console.log(
    `${result.checked} verified records checked, ${result.changed.length} ${dryRun ? 'to change (dry run)' : 'changed'}`
  );
  return 0;
}

main()
  .then(async (code) => {
    await mongoose.disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(
      'backfill-verification-settings failed:',
      error instanceof Error ? error.message : error
    );
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
