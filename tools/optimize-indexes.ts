/**
 * Database index tool
 *
 * Thin CLI wrapper around `ensureIndexes()` from models/index.ts. The Mongoose
 * schemas are the single source of truth for every index; this file keeps no
 * index table of its own and never drops anything.
 *
 * Usage:
 *   npm run optimize-indexes              # create every schema index that is missing
 *   npm run optimize-indexes -- --dry-run # list what would be created, change nothing
 *   npm run optimize-indexes -- --check   # exit 1 when any schema index is missing
 *
 * Exit code 0 means every schema index exists (or was created). Exit code 1
 * means the DB is unreachable, an index is missing (--check), or an index was
 * not created: a creation failed, or a unique index was skipped because the
 * collection holds duplicate keys (reported with the key and counts).
 * `--dry-run` runs the duplicate check for missing unique indexes (a `$group`
 * over the collection, ~10s on 3M blocks) so problems show up before any write.
 * `SKIP_INDEX_SYNC=1` turns the create and dry-run modes into no-ops.
 *
 * Direct execution: npx tsx --tsconfig tsconfig.tools.json tools/optimize-indexes.ts
 */

import mongoose from 'mongoose';
import { connectDB, ensureIndexes, checkIndexes, isIndexSyncSkipped } from '../models/index';
import { indexNameFor, type EnsureIndexesResult, type IndexSpec } from '../lib/db/indexes';
import { requireDb } from '../lib/db/get-db';

/**
 * Indexes that cannot be expressed as a Mongoose schema index (none today).
 * Keep this list empty unless there is a concrete reason; every entry must
 * state why it cannot live in models/index.ts.
 */
interface ExtraIndex {
  collection: string;
  keys: Record<string, 1 | -1>;
  options?: { unique?: boolean; sparse?: boolean; name?: string };
  reason: string;
}
const extraIndexes: ExtraIndex[] = [];

type Mode = 'create' | 'dry-run' | 'check' | 'help';

export function parseMode(argv: string[]): Mode {
  if (argv.includes('--help') || argv.includes('-h')) return 'help';
  if (argv.includes('--check')) return 'check';
  if (argv.includes('--dry-run')) return 'dry-run';
  return 'create';
}

function usage(): void {
  console.log(`
🗂️  Database index tool (indexes are defined by the schemas in models/index.ts)

Usage:
  npm run optimize-indexes              Create every schema index that is missing
  npm run optimize-indexes -- --dry-run Show what would be created (no changes)
  npm run optimize-indexes -- --check   Exit 1 when any schema index is missing
  npm run optimize-indexes -- --help    Show this help

Environment:
  MONGODB_URI        Connection string (falls back to config.json, then localhost)
  SKIP_INDEX_SYNC=1  Disable index creation (create / dry-run become no-ops)
`);
}

function formatSpec(spec: IndexSpec): string {
  const flags = [spec.unique ? 'unique' : '', spec.options.sparse ? 'sparse' : '']
    .filter(Boolean)
    .join(', ');
  return `${spec.collection}.${spec.name}  ${JSON.stringify(spec.keys)}${flags ? `  (${flags})` : ''}`;
}

function extraName(extra: ExtraIndex): string {
  return extra.options?.name ?? indexNameFor(extra.keys);
}

async function missingExtraIndexes(): Promise<ExtraIndex[]> {
  if (extraIndexes.length === 0) return [];
  const db = requireDb();
  const missing: ExtraIndex[] = [];
  for (const extra of extraIndexes) {
    let names: string[];
    try {
      names = (await db.collection(extra.collection).indexes()).map((index) => String(index.name));
    } catch {
      names = []; // collection does not exist yet
    }
    if (!names.includes(extraName(extra))) missing.push(extra);
  }
  return missing;
}

async function createExtraIndexes(): Promise<{ created: string[]; failed: string[] }> {
  const created: string[] = [];
  const failed: string[] = [];
  const db = requireDb();
  for (const extra of await missingExtraIndexes()) {
    const label = `${extra.collection}.${extraName(extra)}`;
    try {
      await db
        .collection(extra.collection)
        .createIndex(extra.keys, { ...extra.options, name: extraName(extra) });
      created.push(label);
      console.log(`  ✅ Created: ${label} (${extra.reason})`);
    } catch (error) {
      failed.push(label);
      console.log(`  ❌ Failed: ${label} - ${error instanceof Error ? error.message : error}`);
    }
  }
  return { created, failed };
}

function printResult(result: EnsureIndexesResult): void {
  for (const label of result.created) console.log(`  ✅ Created: ${label}`);
  for (const skipped of result.skipped) {
    console.log(`  ⏭️  Skipped: ${skipped.collection}.${skipped.index} - ${skipped.reason}`);
  }
  for (const failed of result.failed) {
    console.log(`  ❌ Failed: ${failed.collection}.${failed.index} - ${failed.error}`);
  }
  console.log(
    `\n📊 Summary: ${result.created.length} created, ${result.existing.length} already existed, ` +
      `${result.skipped.length} skipped, ${result.failed.length} failed`
  );
}

/** Run the tool with the given CLI arguments and return the process exit code. */
export async function run(argv: string[]): Promise<number> {
  const mode = parseMode(argv);
  if (mode === 'help') {
    usage();
    return 0;
  }

  console.log('🔗 Connecting to MongoDB...');
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ MongoDB connection failed');
    return 1;
  }
  console.log(`✅ Connected (database: ${mongoose.connection.db?.databaseName ?? 'unknown'})\n`);

  if (mode === 'check') {
    const missing = await checkIndexes();
    const missingExtra = await missingExtraIndexes();
    if (missing.length === 0 && missingExtra.length === 0) {
      console.log('✅ All schema indexes exist');
      return 0;
    }
    console.log(`❌ ${missing.length + missingExtra.length} index(es) missing:`);
    for (const spec of missing) console.log(`  - ${formatSpec(spec)}`);
    for (const extra of missingExtra) {
      console.log(
        `  - ${extra.collection}.${extraName(extra)}  ${JSON.stringify(extra.keys)}  (extra: ${extra.reason})`
      );
    }
    return 1;
  }

  if (isIndexSyncSkipped()) {
    console.log('⏭️  SKIP_INDEX_SYNC is set; index sync is disabled. Nothing to do.');
    return 0;
  }

  if (mode === 'dry-run') {
    const missing = await checkIndexes();
    const missingExtra = await missingExtraIndexes();
    if (missing.length === 0 && missingExtra.length === 0) {
      console.log('✅ All schema indexes exist; nothing would be created');
      return 0;
    }
    // Runs the duplicate-key check for missing unique indexes without creating anything
    const result = await ensureIndexes({ dryRun: true });
    const blocked = new Map(result.skipped.map((s) => [`${s.collection}.${s.index}`, s.reason]));
    console.log(`📝 ${missing.length + missingExtra.length} index(es) would be created:`);
    for (const spec of missing) {
      const reason = blocked.get(`${spec.collection}.${spec.name}`);
      console.log(
        `  - ${formatSpec(spec)}${reason ? `\n      ⚠️  would be skipped: ${reason}` : ''}`
      );
    }
    for (const extra of missingExtra) {
      console.log(
        `  - ${extra.collection}.${extraName(extra)}  ${JSON.stringify(extra.keys)}  (extra: ${extra.reason})`
      );
    }
    for (const failed of result.failed) {
      console.log(`  ❌ ${failed.collection}.${failed.index} - ${failed.error}`);
    }
    console.log('\n(dry run: no changes were made)');
    return 0;
  }

  console.log('🛠️  Creating missing schema indexes...');
  const result = await ensureIndexes();
  const extra = await createExtraIndexes();
  printResult(result);
  const ok = result.failed.length === 0 && result.skipped.length === 0 && extra.failed.length === 0;
  console.log(ok ? '\n✅ Done' : '\n⚠️  Finished with problems (see above)');
  return ok ? 0 : 1;
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
