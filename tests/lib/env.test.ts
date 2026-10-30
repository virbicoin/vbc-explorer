/**
 * lib/env.ts (environment files for the CLI tools) and lib/db/uri.ts (MongoDB
 * URI resolution without a default). Everything runs against temporary
 * directories; no database is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENV_FILES, describeMongoUri, loadEnvFiles } from '@/lib/env';
import { logger } from '@/lib/logger';
import {
  InvalidMongoUriError,
  MissingMongoUriError,
  MongoUriConfigError,
  resolveMongoUri,
  substituteEnvPlaceholders,
} from '@/lib/db/uri';

const KEYS = ['VBC_ENV_TEST_A', 'VBC_ENV_TEST_B', 'VBC_ENV_TEST_C'] as const;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbc-env-'));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('loadEnvFiles', () => {
  it('reads .env and .env.local from the given directory', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'VBC_ENV_TEST_A=from-dotenv\nVBC_ENV_TEST_B=b\n');
    fs.writeFileSync(path.join(dir, '.env.local'), 'VBC_ENV_TEST_C=c\n');
    const result = loadEnvFiles({ cwd: dir, log: false });
    expect(result).toEqual({ loaded: ['.env.local', '.env'], missing: [] });
    expect(process.env.VBC_ENV_TEST_A).toBe('from-dotenv');
    expect(process.env.VBC_ENV_TEST_B).toBe('b');
    expect(process.env.VBC_ENV_TEST_C).toBe('c');
  });

  it('lets .env.local win over .env and the environment win over both', () => {
    process.env.VBC_ENV_TEST_A = 'from-environment';
    fs.writeFileSync(path.join(dir, '.env'), 'VBC_ENV_TEST_A=dotenv\nVBC_ENV_TEST_B=dotenv\n');
    fs.writeFileSync(path.join(dir, '.env.local'), 'VBC_ENV_TEST_B=local\n');
    loadEnvFiles({ cwd: dir, log: false });
    expect(process.env.VBC_ENV_TEST_A).toBe('from-environment');
    expect(process.env.VBC_ENV_TEST_B).toBe('local');
    expect(ENV_FILES).toEqual(['.env.local', '.env']);
  });

  it('does nothing when the files do not exist', () => {
    expect(() => loadEnvFiles({ cwd: dir, log: false })).not.toThrow();
    expect(loadEnvFiles({ cwd: dir, log: false })).toEqual({
      loaded: [],
      missing: ['.env.local', '.env'],
    });
  });

  it('logs the file names and the MongoDB host, never the password', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const previous = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    try {
      fs.writeFileSync(
        path.join(dir, '.env'),
        'MONGODB_URI=mongodb://explorer:Sup3r%40Secret@localhost:27017/explorerDB?authSource=explorerDB\n'
      );
      loadEnvFiles({ cwd: dir });
      expect(info).toHaveBeenCalledTimes(1);
      const [message, meta] = info.mock.calls[0];
      expect(message).toBe('Environment files loaded');
      expect(meta).toEqual({
        files: ['.env'],
        mongodb: { host: 'localhost:27017', database: 'explorerDB' },
      });
      const printed = JSON.stringify(info.mock.calls);
      expect(printed).not.toContain('Sup3r');
      expect(printed).not.toContain('explorer:');
    } finally {
      if (previous === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previous;
    }
  });
});

describe('describeMongoUri', () => {
  it('returns host and database without credentials', () => {
    const summary = describeMongoUri(
      'mongodb://explorer:p%40ss%3Aword@localhost:27017/explorerDB?authSource=explorerDB'
    );
    expect(summary).toEqual({
      host: 'localhost:27017',
      database: 'explorerDB',
      authenticated: true,
    });
    expect(JSON.stringify(summary)).not.toContain('p%40ss');
    expect(describeMongoUri('mongodb://localhost/explorerDB')).toEqual({
      host: 'localhost',
      database: 'explorerDB',
      authenticated: false,
    });
    expect(describeMongoUri('mongodb+srv://u:p@cluster.example.net/db?retryWrites=true')).toEqual({
      host: 'cluster.example.net',
      database: 'db',
      authenticated: true,
    });
    expect(describeMongoUri('mongodb://h1:27017,h2:27017')).toEqual({
      host: 'h1:27017,h2:27017',
      database: null,
      authenticated: false,
    });
  });

  it('returns null for empty or non-MongoDB values', () => {
    expect(describeMongoUri(undefined)).toBeNull();
    expect(describeMongoUri('')).toBeNull();
    expect(describeMongoUri('postgres://x')).toBeNull();
  });
});

describe('resolveMongoUri', () => {
  it('prefers the environment variable', () => {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ database: { uri: 'mongodb://from-config/db' } }));
    expect(
      resolveMongoUri({ env: { MONGODB_URI: ' mongodb://user:pw@env-host/db ' }, configPath })
    ).toEqual({ uri: 'mongodb://user:pw@env-host/db', source: 'environment' });
  });

  it('falls back to config.json with ${VAR} placeholders substituted', () => {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ database: { uri: '${VBC_ENV_TEST_A}' } }));
    expect(
      resolveMongoUri({ env: { VBC_ENV_TEST_A: 'mongodb://cfg-host/explorerDB' }, configPath })
    ).toEqual({ uri: 'mongodb://cfg-host/explorerDB', source: 'config.json' });
    expect(substituteEnvPlaceholders('a-${X}-${Y}', { X: '1' })).toBe('a-1-');
  });

  it('throws MissingMongoUriError instead of using a default when nothing is configured', () => {
    expect(() => resolveMongoUri({ env: {}, cwd: dir })).toThrow(MissingMongoUriError);
    // an unresolved ${MONGODB_URI} placeholder in config.json is the same error
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ database: { uri: '${MONGODB_URI}' } }));
    expect(() => resolveMongoUri({ env: {}, configPath })).toThrow(MissingMongoUriError);
    expect(() => resolveMongoUri({ env: { MONGODB_URI: '   ' }, configPath })).toThrow(
      MissingMongoUriError
    );
    const error = (() => {
      try {
        resolveMongoUri({ env: {}, configPath });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(MongoUriConfigError);
    expect(error?.message).toContain('MONGODB_URI is not set');
    expect(error?.message).toContain('.env');
    expect(error?.message).not.toContain('localhost');
  });

  it('rejects non-MongoDB connection strings without echoing them', () => {
    let caught: Error | null = null;
    try {
      resolveMongoUri({ env: { MONGODB_URI: 'http://secret-user:secret-pw@example/db' } });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(InvalidMongoUriError);
    expect(caught?.message).not.toContain('secret');
    expect(caught?.message).toContain('environment');
  });

  it('ignores unreadable or incomplete config files', () => {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{ not json');
    expect(() => resolveMongoUri({ env: {}, configPath })).toThrow(MissingMongoUriError);
    fs.writeFileSync(configPath, JSON.stringify({ database: {} }));
    expect(() => resolveMongoUri({ env: {}, configPath })).toThrow(MissingMongoUriError);
  });
});
