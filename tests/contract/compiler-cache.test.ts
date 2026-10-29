/**
 * lib/contract/compiler-cache.ts against a local fixture server standing in
 * for binaries.soliditylang.org: release lookup, sha256 verification, nightly
 * refusal, cache reuse, shared downloads and corrupted-cache recovery.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CompilerDownloadError,
  CompilerIntegrityError,
  CompilerVersionError,
  clearCompilerListCache,
  getCompiler,
  toShortVersion,
} from '@/lib/contract/compiler-cache';

const GOOD_FILE = 'soljson-v0.8.99+commit.aaaaaaaa.js';
const GOOD_BODY = 'module.exports = { fixture: "good" };\n';
const BAD_FILE = 'soljson-v0.8.98+commit.bbbbbbbb.js';
const BAD_BODY = 'module.exports = { fixture: "tampered" };\n';
const NIGHTLY_FILE = 'soljson-v0.8.97-nightly.2026.10.1+commit.cccccccc.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const LIST = {
  builds: [
    {
      path: GOOD_FILE,
      version: '0.8.99',
      build: 'commit.aaaaaaaa',
      longVersion: '0.8.99+commit.aaaaaaaa',
      sha256: `0x${sha256(GOOD_BODY)}`,
    },
    {
      path: BAD_FILE,
      version: '0.8.98',
      build: 'commit.bbbbbbbb',
      longVersion: '0.8.98+commit.bbbbbbbb',
      // published hash does not match what the server serves
      sha256: `0x${sha256('module.exports = { fixture: "original" };\n')}`,
    },
    {
      path: NIGHTLY_FILE,
      version: '0.8.97',
      prerelease: 'nightly.2026.10.1',
      build: 'commit.cccccccc',
      longVersion: '0.8.97-nightly.2026.10.1+commit.cccccccc',
      sha256: `0x${sha256('nightly')}`,
    },
  ],
  releases: { '0.8.99': GOOD_FILE, '0.8.98': BAD_FILE },
  latestRelease: '0.8.99',
};

let server: http.Server;
let baseUrl: string;
let cacheDir: string;
const requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    const url = req.url ?? '';
    if (url === '/bin/list.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(LIST));
    } else if (url === `/bin/${GOOD_FILE}`) {
      res.end(GOOD_BODY);
    } else if (url === `/bin/${BAD_FILE}`) {
      res.end(BAD_BODY);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/bin`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vbc-solc-test-'));
  requests.length = 0;
  clearCompilerListCache();
});

const options = () => ({ cacheDir, baseUrl, allowInsecureBaseUrl: true, allowedVersions: null });

describe('toShortVersion', () => {
  it('normalizes release names and refuses nightlies / garbage', () => {
    expect(toShortVersion('v0.8.30+commit.73712a01')).toBe('0.8.30');
    expect(toShortVersion(' 0.8.30 ')).toBe('0.8.30');
    expect(() => toShortVersion('0.8.31-nightly.2025.5.1+commit.abcdef12')).toThrow(
      CompilerVersionError
    );
    expect(() => toShortVersion('latest')).toThrow(CompilerVersionError);
    expect(() => toShortVersion('')).toThrow(CompilerVersionError);
    expect(() => toShortVersion(undefined)).toThrow(CompilerVersionError);
  });
});

describe('getCompiler', () => {
  it('downloads a release, verifies its sha256 and records it next to the file', async () => {
    const result = await getCompiler('v0.8.99+commit.aaaaaaaa', options());
    expect(result.fromCache).toBe(false);
    expect(result.version).toBe('0.8.99');
    expect(result.longVersion).toBe('0.8.99+commit.aaaaaaaa');
    expect(result.path).toBe(path.join(cacheDir, '0.8.99.js'));
    expect(fs.readFileSync(result.path, 'utf8')).toBe(GOOD_BODY);
    expect(fs.readFileSync(path.join(cacheDir, '0.8.99.sha256'), 'utf8')).toBe(
      `${sha256(GOOD_BODY)}  0.8.99+commit.aaaaaaaa\n`
    );
    expect(requests).toEqual(['/bin/list.json', `/bin/${GOOD_FILE}`]);

    // second call: served from the cache, no network
    const again = await getCompiler('0.8.99', options());
    expect(again.fromCache).toBe(true);
    expect(again.sha256).toBe(sha256(GOOD_BODY));
    expect(requests).toHaveLength(2);
  });

  it('rejects a download whose sha256 differs from list.json and caches nothing', async () => {
    await expect(getCompiler('0.8.98', options())).rejects.toBeInstanceOf(CompilerIntegrityError);
    expect(fs.existsSync(path.join(cacheDir, '0.8.98.js'))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, '0.8.98.sha256'))).toBe(false);
    expect(fs.readdirSync(cacheDir).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('refuses nightly builds, versions outside `releases` and versions outside the allow-list without touching the network', async () => {
    await expect(
      getCompiler('0.8.97-nightly.2026.10.1+commit.cccccccc', options())
    ).rejects.toBeInstanceOf(CompilerVersionError);
    expect(requests).toEqual([]);
    await expect(getCompiler('0.8.50', options())).rejects.toBeInstanceOf(CompilerVersionError);
    expect(requests).toEqual(['/bin/list.json']);
    await expect(
      getCompiler('0.8.99', { ...options(), allowedVersions: ['0.8.30'] })
    ).rejects.toBeInstanceOf(CompilerVersionError);
    expect(requests).toEqual(['/bin/list.json']);
  });

  it('shares one download between concurrent requests for the same version', async () => {
    const results = await Promise.all([
      getCompiler('0.8.99', options()),
      getCompiler('v0.8.99+commit.aaaaaaaa', options()),
      getCompiler('0.8.99', options()),
    ]);
    expect(results.map((r) => r.path)).toEqual(Array(3).fill(path.join(cacheDir, '0.8.99.js')));
    expect(requests.filter((r) => r === `/bin/${GOOD_FILE}`)).toHaveLength(1);
  });

  it('re-downloads a cached file that no longer matches its recorded sha256', async () => {
    await getCompiler('0.8.99', options());
    await fsp.writeFile(path.join(cacheDir, '0.8.99.js'), 'module.exports = "tampered";');
    requests.length = 0;
    const result = await getCompiler('0.8.99', options());
    expect(result.fromCache).toBe(false);
    expect(fs.readFileSync(result.path, 'utf8')).toBe(GOOD_BODY);
    expect(requests).toContain(`/bin/${GOOD_FILE}`);
  });

  it('insists on https for the real download host', async () => {
    await expect(
      getCompiler('0.8.99', { cacheDir, baseUrl, allowedVersions: null })
    ).rejects.toBeInstanceOf(CompilerDownloadError);
    expect(requests).toEqual([]);
  });

  it('reports an unreachable server as CompilerDownloadError', async () => {
    await expect(
      getCompiler('0.8.99', {
        ...options(),
        baseUrl: 'http://127.0.0.1:1/bin',
        listTimeoutMs: 2_000,
      })
    ).rejects.toBeInstanceOf(CompilerDownloadError);
  });
});
