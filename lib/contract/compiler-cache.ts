/**
 * Verified local cache of Solidity compilers.
 *
 * `getCompiler(version)` returns `<cacheDir>/<version>.js`, a release build of
 * soljson from https://binaries.soliditylang.org whose sha256 matched the value
 * published in `bin/list.json` when it was downloaded and still matches the
 * recorded `<version>.sha256` when it is read back. Only versions listed under
 * `releases` are accepted (nightly / pre-release builds are refused), downloads
 * run one at a time, concurrent requests for the same version share a single
 * download, and nothing that failed verification is ever written to the cache.
 * `solc.loadRemoteVersion` is not used anywhere: the compile worker executes
 * only files that passed this check.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { getCompilerConfig } from '../config';
import { logger } from '../logger';
import { normalizeCompilerVersion } from './solc-utils';

export const SOLC_BINARIES_BASE_URL = 'https://binaries.soliditylang.org/bin';
/** list.json: 15 s, 2 MB. */
export const LIST_JSON_TIMEOUT_MS = 15_000;
export const LIST_JSON_MAX_BYTES = 2 * 1024 * 1024;
/** Compiler build: generous, soljson files are 10–40 MB. */
export const COMPILER_DOWNLOAD_TIMEOUT_MS = 180_000;
export const COMPILER_MAX_BYTES = 128 * 1024 * 1024;
const LIST_CACHE_TTL_MS = 10 * 60_000;

/** The requested version cannot be served (unknown, not a release, nightly, not allowed). */
export class CompilerVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerVersionError';
  }
}

/** A downloaded or cached file did not match its published sha256. */
export class CompilerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerIntegrityError';
  }
}

/** binaries.soliditylang.org could not be reached or answered unexpectedly. */
export class CompilerDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerDownloadError';
  }
}

export interface CompilerCacheOptions {
  /** Defaults to `config.compiler.cacheDir` (~/.cache/vbc-solc). */
  cacheDir?: string;
  /** Defaults to https://binaries.soliditylang.org/bin. */
  baseUrl?: string;
  /** Defaults to `config.compiler.allowedVersions`; null = every release. */
  allowedVersions?: string[] | null;
  listTimeoutMs?: number;
  downloadTimeoutMs?: number;
  /** Tests only: accept a plain-http base URL (a local fixture server). */
  allowInsecureBaseUrl?: boolean;
}

export interface CachedCompiler {
  /** Short version, e.g. `0.8.30`. */
  version: string;
  /** Long version from list.json, e.g. `0.8.30+commit.73712a01`. */
  longVersion: string;
  /** Absolute path of the verified soljson file. */
  path: string;
  sha256: string;
  /** True when served from the cache without a download. */
  fromCache: boolean;
}

interface SolcBuild {
  path: string;
  version: string;
  build?: string;
  longVersion: string;
  sha256?: string;
  keccak256?: string;
  prerelease?: string;
}

interface SolcList {
  builds: SolcBuild[];
  releases: Record<string, string>;
  latestRelease?: string;
}

interface ResolvedOptions {
  cacheDir: string;
  baseUrl: string;
  allowedVersions: string[] | null;
  listTimeoutMs: number;
  downloadTimeoutMs: number;
}

export function isNightlyVersion(version: string): boolean {
  return /nightly/i.test(version);
}

/**
 * `v0.8.30+commit.73712a01` / `0.8.30` → `0.8.30`. Throws CompilerVersionError
 * for empty input, nightly builds and anything that is not `x.y.z`.
 */
export function toShortVersion(version: unknown): string {
  const trimmed = typeof version === 'string' ? version.trim() : '';
  if (!trimmed) throw new CompilerVersionError('Compiler version is required');
  if (isNightlyVersion(trimmed)) {
    throw new CompilerVersionError(`Nightly compiler builds are not allowed: ${trimmed}`);
  }
  const short = normalizeCompilerVersion(trimmed);
  if (!/^\d+\.\d+\.\d+$/.test(short)) {
    throw new CompilerVersionError(`Unsupported compiler version: ${trimmed}`);
  }
  return short;
}

/** Files that hold a cached version. */
export function cachedCompilerPaths(
  cacheDir: string,
  short: string
): { file: string; meta: string } {
  return {
    file: path.join(cacheDir, `${short}.js`),
    meta: path.join(cacheDir, `${short}.sha256`),
  };
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(/*turbopackIgnore: true*/ file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function resolveOptions(options: CompilerCacheOptions): ResolvedOptions {
  const config = getCompilerConfig();
  const baseUrl = (options.baseUrl ?? SOLC_BINARIES_BASE_URL).replace(/\/+$/, '');
  if (!options.allowInsecureBaseUrl && !baseUrl.startsWith('https://')) {
    throw new CompilerDownloadError('Compiler downloads must use https');
  }
  return {
    cacheDir: options.cacheDir ?? config.cacheDir,
    baseUrl,
    allowedVersions:
      options.allowedVersions === undefined ? config.allowedVersions : options.allowedVersions,
    listTimeoutMs: options.listTimeoutMs ?? LIST_JSON_TIMEOUT_MS,
    downloadTimeoutMs: options.downloadTimeoutMs ?? COMPILER_DOWNLOAD_TIMEOUT_MS,
  };
}

/** GET a URL into memory with a timeout and a hard size cap (no redirects). */
function fetchBytes(url: string, limits: { timeoutMs: number; maxBytes: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new CompilerDownloadError(`Invalid URL: ${url}`));
      return;
    }
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(
      target,
      { headers: { 'user-agent': 'vbc-explorer compiler-cache', accept: '*/*' } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new CompilerDownloadError(`${url}: HTTP ${response.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxBytes) {
            request.destroy(
              new CompilerDownloadError(`${url}: response exceeds ${limits.maxBytes} bytes`)
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', (error) =>
          reject(
            error instanceof CompilerDownloadError
              ? error
              : new CompilerDownloadError(`${url}: ${error.message}`)
          )
        );
      }
    );
    request.setTimeout(limits.timeoutMs, () => {
      request.destroy(new CompilerDownloadError(`${url}: timed out after ${limits.timeoutMs} ms`));
    });
    request.on('error', (error) =>
      reject(
        error instanceof CompilerDownloadError
          ? error
          : new CompilerDownloadError(`${url}: ${error.message}`)
      )
    );
  });
}

const listCache = new Map<string, { fetchedAt: number; list: SolcList }>();

/** Tests: forget the cached list.json. */
export function clearCompilerListCache(): void {
  listCache.clear();
}

async function loadList(options: ResolvedOptions): Promise<SolcList> {
  const cached = listCache.get(options.baseUrl);
  if (cached && Date.now() - cached.fetchedAt < LIST_CACHE_TTL_MS) return cached.list;
  const buffer = await fetchBytes(`${options.baseUrl}/list.json`, {
    timeoutMs: options.listTimeoutMs,
    maxBytes: LIST_JSON_MAX_BYTES,
  });
  let list: SolcList;
  try {
    list = JSON.parse(buffer.toString('utf8')) as SolcList;
  } catch {
    throw new CompilerDownloadError('list.json is not valid JSON');
  }
  if (
    !list ||
    typeof list !== 'object' ||
    !Array.isArray(list.builds) ||
    !list.releases ||
    typeof list.releases !== 'object'
  ) {
    throw new CompilerDownloadError('list.json has an unexpected shape');
  }
  listCache.set(options.baseUrl, { fetchedAt: Date.now(), list });
  return list;
}

/** The release build of a short version, or CompilerVersionError. */
export function findReleaseBuild(list: SolcList, short: string): SolcBuild & { sha256: string } {
  const file = list.releases[short];
  if (!file) {
    throw new CompilerVersionError(`solc ${short} is not a release on binaries.soliditylang.org`);
  }
  const build =
    list.builds.find((b) => b.path === file) ??
    list.builds.find((b) => b.version === short && !b.prerelease);
  if (!build) throw new CompilerVersionError(`list.json has no build entry for solc ${short}`);
  if (
    build.prerelease ||
    isNightlyVersion(build.longVersion ?? '') ||
    isNightlyVersion(build.path)
  ) {
    throw new CompilerVersionError(`solc ${short} resolves to a pre-release build (${build.path})`);
  }
  const sha256 = (build.sha256 ?? '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new CompilerDownloadError(`list.json has no sha256 for ${build.path}`);
  }
  return { ...build, sha256 };
}

function parseMeta(text: string): { sha256: string; longVersion: string } | null {
  const match = /^([0-9a-f]{64})\s+(\S+)/i.exec(text.trim());
  return match ? { sha256: match[1].toLowerCase(), longVersion: match[2] } : null;
}

async function removeQuietly(file: string): Promise<void> {
  try {
    await fsp.unlink(file);
  } catch {
    // already gone
  }
}

/** A cached version whose file still matches its recorded sha256, or null. */
async function readVerifiedCache(cacheDir: string, short: string): Promise<CachedCompiler | null> {
  const { file, meta } = cachedCompilerPaths(cacheDir, short);
  // turbopackIgnore: the cache lives outside the project; tracing must not follow it
  if (
    !fs.existsSync(/*turbopackIgnore: true*/ file) ||
    !fs.existsSync(/*turbopackIgnore: true*/ meta)
  ) {
    return null;
  }
  const record = parseMeta(await fsp.readFile(/*turbopackIgnore: true*/ meta, 'utf8'));
  if (!record) {
    logger.warn('Cached compiler has no readable sha256 record; discarding it', { file });
    await Promise.all([removeQuietly(file), removeQuietly(meta)]);
    return null;
  }
  const actual = await sha256File(file);
  if (actual !== record.sha256) {
    logger.warn('Cached compiler failed its sha256 check; discarding it', {
      file,
      expected: record.sha256,
      actual,
    });
    await Promise.all([removeQuietly(file), removeQuietly(meta)]);
    return null;
  }
  return {
    version: short,
    longVersion: record.longVersion,
    path: file,
    sha256: actual,
    fromCache: true,
  };
}

async function downloadAndVerify(short: string, options: ResolvedOptions): Promise<CachedCompiler> {
  // another process may have populated the cache while we waited for the download slot
  const cached = await readVerifiedCache(options.cacheDir, short);
  if (cached) return cached;

  const list = await loadList(options);
  const build = findReleaseBuild(list, short);
  const url = `${options.baseUrl}/${build.path}`;
  const startedAt = Date.now();
  const buffer = await fetchBytes(url, {
    timeoutMs: options.downloadTimeoutMs,
    maxBytes: COMPILER_MAX_BYTES,
  });
  const actual = sha256Hex(buffer);
  if (actual !== build.sha256) {
    logger.error('Compiler download failed its sha256 check; nothing was cached', {
      version: short,
      url,
      expected: build.sha256,
      actual,
    });
    throw new CompilerIntegrityError(
      `sha256 mismatch for ${build.path}: expected ${build.sha256}, got ${actual}`
    );
  }

  const { file, meta } = cachedCompilerPaths(options.cacheDir, short);
  const partial = `${file}.${process.pid}.${Date.now()}.part`;
  try {
    await fsp.writeFile(partial, buffer);
    await fsp.rename(partial, file);
    await fsp.writeFile(meta, `${actual}  ${build.longVersion}\n`);
  } catch (error) {
    await removeQuietly(partial);
    throw error;
  }
  logger.info('Compiler downloaded and verified', {
    version: short,
    longVersion: build.longVersion,
    bytes: buffer.length,
    durationMs: Date.now() - startedAt,
    path: file,
  });
  return {
    version: short,
    longVersion: build.longVersion,
    path: file,
    sha256: actual,
    fromCache: false,
  };
}

const inFlight = new Map<string, Promise<CachedCompiler>>();
let downloadTail: Promise<unknown> = Promise.resolve();

/**
 * Path of a verified compiler for `version`, downloading it when the cache
 * does not have it. Concurrent calls for the same version share one promise;
 * downloads of different versions run one after another.
 */
export async function getCompiler(
  version: string,
  options: CompilerCacheOptions = {}
): Promise<CachedCompiler> {
  const short = toShortVersion(version);
  const resolved = resolveOptions(options);
  if (resolved.allowedVersions && !resolved.allowedVersions.includes(short)) {
    throw new CompilerVersionError(`solc ${short} is not in compiler.allowedVersions`);
  }

  const key = `${resolved.cacheDir}|${short}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async () => {
    await fsp.mkdir(resolved.cacheDir, { recursive: true });
    const cached = await readVerifiedCache(resolved.cacheDir, short);
    if (cached) return cached;
    const run = () => downloadAndVerify(short, resolved);
    const result = downloadTail.then(run, run);
    downloadTail = result.catch(() => undefined);
    return result;
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
