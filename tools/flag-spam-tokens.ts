/**
 * Backfill / maintenance of the `hidden` flag on Contract and Token documents.
 *
 * Applies classifyDisplayName() (lib/security/display-name.ts) to every
 * document: names that look like URLs, contain control / zero-width / bidi
 * characters or HTML, or exceed the length caps are flagged hidden with a
 * reason. Flags set manually (`hiddenReason: 'manual'`) are never changed by
 * the automatic pass.
 *
 * Usage:
 *   npm run flag-spam-tokens                                   # classify everything and write the flags
 *   npm run flag-spam-tokens -- --dry-run                      # report what would change, write nothing
 *   npm run flag-spam-tokens -- --address 0x... --hide         # hide one address (reason: manual)
 *   npm run flag-spam-tokens -- --address 0x... --unhide       # clear the flag of one address
 *   npm run flag-spam-tokens -- --unhide-all                   # clear every flag (incl. manual)
 *
 * Direct: npx tsx --tsconfig tsconfig.tools.json tools/flag-spam-tokens.ts [options]
 */

import mongoose from 'mongoose';
import { connectDB, ensureIndexesOnStartup, Contract, Token } from '../models/index';
import { classifyDisplayName, type HiddenReason } from '../lib/security/display-name';
import type { AnyModel } from '../lib/db/indexes';

interface Options {
  dryRun: boolean;
  address: string | null;
  hide: boolean;
  unhide: boolean;
  unhideAll: boolean;
  reason: HiddenReason;
  help: boolean;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: argv.includes('--dry-run'),
    address: null,
    hide: argv.includes('--hide'),
    unhide: argv.includes('--unhide'),
    unhideAll: argv.includes('--unhide-all'),
    reason: 'manual',
    help: argv.includes('--help') || argv.includes('-h'),
  };
  const addressIndex = argv.indexOf('--address');
  if (addressIndex >= 0 && argv[addressIndex + 1]) {
    options.address = argv[addressIndex + 1].toLowerCase();
  }
  const reasonIndex = argv.indexOf('--reason');
  if (reasonIndex >= 0 && argv[reasonIndex + 1]) {
    options.reason = argv[reasonIndex + 1] as HiddenReason;
  }
  return options;
}

function usage(): void {
  console.log(`
🚫 flag-spam-tokens — hide tokens / contracts whose name looks like a URL or contains control characters

  npm run flag-spam-tokens                              classify all Contract + Token docs and write hidden/hiddenReason
  npm run flag-spam-tokens -- --dry-run                 report only
  npm run flag-spam-tokens -- --address 0x... --hide    hide one address (reason: manual)
  npm run flag-spam-tokens -- --address 0x... --unhide  clear the flag of one address
  npm run flag-spam-tokens -- --unhide-all              clear every flag, including manual ones
`);
}

interface NamedDoc {
  _id: unknown;
  address?: string;
  name?: string;
  tokenName?: string;
  contractName?: string;
  symbol?: string;
  logoUrl?: string | null;
  hidden?: boolean;
  hiddenReason?: string | null;
}

interface Change {
  collection: string;
  address: string;
  from: string;
  to: string;
  name: string;
}

/** Classify every document of a model; returns the changes (applied unless dryRun). */
export async function classifyCollection(
  model: AnyModel,
  dryRun: boolean
): Promise<{ scanned: number; hidden: number; changes: Change[] }> {
  const docs = (await model
    .find(
      {},
      {
        address: 1,
        name: 1,
        tokenName: 1,
        contractName: 1,
        symbol: 1,
        logoUrl: 1,
        hidden: 1,
        hiddenReason: 1,
      }
    )
    .lean()) as NamedDoc[];
  const changes: Change[] = [];
  let hidden = 0;
  for (const doc of docs) {
    const name = doc.name ?? doc.tokenName ?? doc.contractName ?? '';
    const result = classifyDisplayName({ name, symbol: doc.symbol ?? '', logoUrl: doc.logoUrl });
    const currentlyHidden = doc.hidden === true;
    const currentReason = doc.hiddenReason ?? null;
    if (currentReason === 'manual') {
      if (currentlyHidden) hidden += 1;
      continue; // manual decisions win
    }
    const wantHidden = result.hidden;
    const wantReason = result.reason ?? null;
    if (wantHidden) hidden += 1;
    if (wantHidden !== currentlyHidden || wantReason !== currentReason) {
      changes.push({
        collection: model.collection.name,
        address: doc.address ?? String(doc._id),
        from: currentlyHidden ? `hidden (${currentReason ?? 'auto'})` : 'visible',
        to: wantHidden ? `hidden (${wantReason})` : 'visible',
        name: name.slice(0, 80),
      });
      if (!dryRun) {
        await model.updateOne(
          { _id: doc._id },
          { $set: { hidden: wantHidden, hiddenReason: wantReason } }
        );
      }
    }
  }
  return { scanned: docs.length, hidden, changes };
}

async function setFlag(
  address: string,
  hidden: boolean,
  reason: HiddenReason | null,
  dryRun: boolean
) {
  for (const model of [Contract, Token] as AnyModel[]) {
    const doc = await model.findOne({ address }).lean();
    if (!doc) {
      console.log(`  ${model.collection.name}: no document for ${address}`);
      continue;
    }
    console.log(
      `  ${model.collection.name}: ${address} → ${hidden ? `hidden (${reason})` : 'visible'}${dryRun ? ' (dry run)' : ''}`
    );
    if (!dryRun) {
      await model.updateOne(
        { address },
        { $set: { hidden, hiddenReason: hidden ? reason : null } }
      );
    }
  }
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
  await ensureIndexesOnStartup('flag-spam-tokens');

  if (options.unhideAll) {
    console.log(
      `🧹 Clearing hidden flags on every Contract and Token${options.dryRun ? ' (dry run)' : ''}`
    );
    for (const model of [Contract, Token] as AnyModel[]) {
      const count = await model.countDocuments({ hidden: true });
      console.log(`  ${model.collection.name}: ${count} hidden`);
      if (!options.dryRun && count > 0) {
        await model.updateMany({ hidden: true }, { $set: { hidden: false, hiddenReason: null } });
      }
    }
    return 0;
  }

  if (options.address) {
    if (options.hide === options.unhide) {
      console.error('❌ --address requires exactly one of --hide / --unhide');
      return 1;
    }
    await setFlag(
      options.address,
      options.hide,
      options.hide ? options.reason : null,
      options.dryRun
    );
    return 0;
  }

  console.log(
    `🔍 Classifying display names${options.dryRun ? ' (dry run: nothing is written)' : ''}...`
  );
  let exit = 0;
  for (const model of [Contract, Token] as AnyModel[]) {
    const { scanned, hidden, changes } = await classifyCollection(model, options.dryRun);
    console.log(
      `\n📦 ${model.collection.name}: ${scanned} scanned, ${hidden} hidden after this run, ${changes.length} change(s)`
    );
    for (const change of changes) {
      console.log(`  ${change.address}  ${change.from} → ${change.to}  "${change.name}"`);
    }
    if (changes.length > 0 && options.dryRun) exit = 0;
  }
  console.log(options.dryRun ? '\n(dry run: no changes were made)' : '\n✅ Done');
  return exit;
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
