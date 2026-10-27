/**
 * CLI tests for tools/optimize-indexes.ts (mongodb-memory-server).
 *
 * The tool is run as a child process (tsx) against an in-memory MongoDB so the
 * real exit codes are verified: `--check` returns 1 while a schema index is
 * missing and 0 once everything exists; the create mode returns 1 when a
 * unique index had to be skipped because of duplicate keys.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Transaction } from '@/models/index';
import { parseMode } from '../../tools/optimize-indexes';

const ROOT = path.resolve(__dirname, '..', '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const TOOL = path.join(ROOT, 'tools', 'optimize-indexes.ts');
const RUN_TIMEOUT = 90_000;

let mongod: MongoMemoryServer;
let uri: string;

interface RunResult {
  code: number | null;
  output: string;
}

function runTool(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, ['--tsconfig', 'tsconfig.tools.json', TOOL, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        MONGODB_URI: uri,
        LOG_LEVEL: 'error',
        SKIP_INDEX_SYNC: '',
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri('explorerDB_cli');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

describe('parseMode', () => {
  it('maps CLI flags to modes', () => {
    expect(parseMode([])).toBe('create');
    expect(parseMode(['--dry-run'])).toBe('dry-run');
    expect(parseMode(['--check'])).toBe('check');
    expect(parseMode(['--dry-run', '--check'])).toBe('check');
    expect(parseMode(['--help'])).toBe('help');
    expect(parseMode(['-h'])).toBe('help');
  });
});

describe('optimize-indexes CLI', () => {
  it(
    '--check exits 1 on a DB without indexes and lists the missing ones',
    async () => {
      const result = await runTool(['--check']);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Block.number_1');
      expect(result.output).toContain('Transaction.hash_1');
    },
    RUN_TIMEOUT
  );

  it(
    '--dry-run exits 0 and creates nothing',
    async () => {
      const dryRun = await runTool(['--dry-run']);
      expect(dryRun.code).toBe(0);
      expect(dryRun.output).toContain('Block.number_1');
      expect(dryRun.output).toContain('no changes were made');

      const check = await runTool(['--check']);
      expect(check.code).toBe(1);
    },
    RUN_TIMEOUT
  );

  it(
    'create mode exits 0 after creating the indexes, then --check exits 0',
    async () => {
      const create = await runTool([]);
      expect(create.code).toBe(0);
      expect(create.output).toContain('Created: Block.number_1');
      expect(create.output).toContain('Created: Transaction.hash_1');

      const check = await runTool(['--check']);
      expect(check.code).toBe(0);
      expect(check.output).toContain('All schema indexes exist');

      const indexes = await Transaction.collection.indexes();
      expect(indexes.find((index) => index.name === 'hash_1')?.unique).toBe(true);
    },
    RUN_TIMEOUT
  );

  it(
    'create mode skips a unique index with duplicate keys and exits 1',
    async () => {
      const hash = '0x' + 'cd'.repeat(32);
      await Transaction.collection.insertMany([
        { hash, blockNumber: 1, transactionIndex: 0 },
        { hash, blockNumber: 1, transactionIndex: 1 },
      ]);

      const create = await runTool([]);
      expect(create.code).toBe(1);
      expect(create.output).toContain('Skipped: Transaction.hash_1');
      expect(create.output).toContain('duplicate key');
      expect(create.output).toContain('Created: Block.number_1');

      const check = await runTool(['--check']);
      expect(check.code).toBe(1);
      expect(check.output).toContain('1 index(es) missing');
      expect(check.output).toContain('Transaction.hash_1');
    },
    RUN_TIMEOUT
  );

  it(
    'SKIP_INDEX_SYNC=1 turns create mode into a no-op',
    async () => {
      const create = await runTool([], { SKIP_INDEX_SYNC: '1' });
      expect(create.code).toBe(0);
      expect(create.output).toContain('SKIP_INDEX_SYNC');

      const check = await runTool(['--check']);
      expect(check.code).toBe(1);
    },
    RUN_TIMEOUT
  );
});
