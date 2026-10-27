/**
 * SSRF-safe JSON fetch for chain-derived URLs (NFT tokenURI metadata).
 *
 * This is the only place in the codebase that is allowed to fetch a URL that
 * came from the blockchain (tokenURI, metadata, logoUrl). Rules:
 *
 * - https only (`ipfs://` is rewritten to the configured gateway); http, data:,
 *   javascript: etc. are rejected before any network activity
 * - the host must be a DNS name, never an IP literal
 * - every address the name resolves to is checked; one private / special
 *   address (loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10,
 *   0/8, multicast, reserved, ::1, ::, fc00::/7, fe80::/10, mapped IPv4, ...)
 *   rejects the request
 * - the TCP connection is made to the validated address (the socket lookup is
 *   pinned), so a DNS answer cannot change between validation and connect
 * - redirects are never followed (any 3xx is a failure)
 * - the response must be `application/json` (or `*+json`) and at most
 *   `maxBytes`, checked on Content-Length and again while reading the body
 * - every rejection is logged with `logger.warn` (reason, URL, caller context)
 *
 * Node-only (dns / https). Keep browser-safe URL checks in `./url.ts`.
 */

import dns from 'node:dns';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { logger } from '../logger';
import {
  DEFAULT_IPFS_GATEWAY,
  isPrivateIp,
  parseSafeHttpsUrl,
  resolveIpfsUrl,
  type UrlRejectReason,
} from './url';

export type SafeFetchReason =
  | UrlRejectReason
  | 'dns'
  | 'private-address'
  | 'redirect'
  | 'status'
  | 'content-type'
  | 'too-large'
  | 'timeout'
  | 'network'
  | 'invalid-json';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** DNS resolver: every address the name maps to (injectable for tests). */
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  /** The validated address the socket must connect to. */
  address: ResolvedAddress;
  headers: Record<string, string>;
  timeoutMs: number;
  /** Stop reading (and mark `truncated`) once the body exceeds this many bytes. */
  maxBytes: number;
}

export interface TransportResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

/** HTTP transport (injectable for tests). Must not follow redirects. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface SafeFetchOptions {
  /** Maximum response size in bytes (default 256 KiB). */
  maxBytes?: number;
  /** Overall timeout in milliseconds (default 5 s). */
  timeoutMs?: number;
  /** Gateway for `ipfs://` URIs (default `https://ipfs.io/ipfs/`). */
  ipfsGateway?: string;
  userAgent?: string;
  lookup?: LookupFn;
  transport?: Transport;
  /** Extra fields written to the rejection log (e.g. `{ contract, tokenId }`). */
  context?: Record<string, unknown>;
}

export type SafeFetchResult<T = unknown> =
  | { ok: true; url: string; data: T; bytes: number }
  | { ok: false; url: string; reason: SafeFetchReason; message: string; status?: number };

export const DEFAULT_MAX_BYTES = 262_144;
export const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_USER_AGENT = 'VBC-Explorer/1.0 (+safe-fetch)';

/** `application/json` or any `*+json` media type (parameters ignored). */
export function isJsonContentType(value: string | string[] | undefined): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  const mime = (first || '').split(';')[0].trim().toLowerCase();
  return mime === 'application/json' || mime.endsWith('+json');
}

const defaultLookup: LookupFn = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
};

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number
) => void;

/** `https.request` with the socket lookup pinned to the validated address. */
const httpsTransport: Transport = (request) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const { url, address } = request;
    const pinnedLookup = (
      _hostname: string,
      options: { all?: boolean } | LookupCallback,
      callback?: LookupCallback
    ) => {
      const done = (typeof options === 'function' ? options : callback) as LookupCallback;
      if (typeof options === 'object' && options.all) {
        done(null, [{ address: address.address, family: address.family }]);
      } else {
        done(null, address.address, address.family);
      }
    };

    let settled = false;
    const finish = (response: TransportResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(response);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(error);
    };

    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: request.headers,
        servername: url.hostname,
        agent: false, // never reuse a pooled socket that was opened for another address
        lookup: pinnedLookup as unknown as undefined,
        timeout: request.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          received += chunk.length;
          if (received > request.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (received - request.maxBytes)));
            res.destroy();
            req.destroy();
            finish({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
              truncated: true,
            });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            truncated,
          })
        );
        res.on('error', fail);
      }
    );

    const deadline = setTimeout(() => req.destroy(new Error('timeout')), request.timeoutMs + 100);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
    req.end();
  });

function truncateForLog(value: string, max = 512): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Fetch and parse JSON from a chain-derived URL under the rules above.
 * Never throws; a rejected or failed request returns `{ ok: false, reason }`.
 */
export async function safeFetchJson<T = unknown>(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult<T>> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolvedUrl = resolveIpfsUrl(
    String(rawUrl ?? ''),
    options.ipfsGateway ?? DEFAULT_IPFS_GATEWAY
  );

  const reject = (
    reason: SafeFetchReason,
    message: string,
    status?: number
  ): SafeFetchResult<T> => {
    logger.warn('Unsafe URL fetch rejected', {
      reason,
      message,
      url: truncateForLog(resolvedUrl),
      ...(status !== undefined ? { status } : {}),
      ...(options.context ?? {}),
    });
    return {
      ok: false,
      url: resolvedUrl,
      reason,
      message,
      ...(status !== undefined ? { status } : {}),
    };
  };

  const parsed = parseSafeHttpsUrl(resolvedUrl);
  if (!parsed.ok) return reject(parsed.reason, `URL rejected (${parsed.reason})`);
  const url = parsed.url;

  let addresses: ResolvedAddress[];
  try {
    addresses = await (options.lookup ?? defaultLookup)(url.hostname);
  } catch (error) {
    return reject('dns', `DNS lookup failed: ${error instanceof Error ? error.message : error}`);
  }
  if (addresses.length === 0) return reject('dns', 'DNS lookup returned no addresses');
  const blocked = addresses.find((entry) => isPrivateIp(entry.address));
  if (blocked) {
    return reject('private-address', `${url.hostname} resolves to ${blocked.address}`);
  }

  let response: TransportResponse;
  try {
    response = await (options.transport ?? httpsTransport)({
      url,
      address: addresses[0],
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'application/json',
      },
      timeoutMs,
      maxBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reject(/timeout/i.test(message) ? 'timeout' : 'network', message);
  }

  if (response.status >= 300 && response.status < 400) {
    return reject('redirect', `redirect (${response.status}) not followed`, response.status);
  }
  if (response.status !== 200) {
    return reject('status', `unexpected HTTP status ${response.status}`, response.status);
  }
  const contentType = headerValue(response.headers, 'content-type');
  if (!isJsonContentType(contentType)) {
    return reject('content-type', `unsupported content-type ${contentType ?? '(none)'}`);
  }
  const contentLength = Number(headerValue(response.headers, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return reject('too-large', `Content-Length ${contentLength} exceeds ${maxBytes} bytes`);
  }
  if (response.truncated || response.body.length > maxBytes) {
    return reject('too-large', `body exceeds ${maxBytes} bytes`);
  }

  let data: T;
  try {
    data = JSON.parse(response.body.toString('utf8')) as T;
  } catch {
    return reject('invalid-json', 'response is not valid JSON');
  }
  return { ok: true, url: url.toString(), data, bytes: response.body.length };
}
