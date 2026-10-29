/**
 * Rate-limit buckets and route helpers.
 *
 * Every API route applies a limit at the top of its handler (Edge middleware
 * cannot share the in-process store, so limits live in the routes). The
 * buckets below are the only place limits are defined; keys are
 * `<bucket>:<client ip>` where the client IP comes from the single trusted
 * header set by nginx (see getClientIp). Requests whose IP is unknown share
 * one bucket with a tenth of the normal limit.
 *
 *   withRateLimit('api', async (request, ctx) => { ... })   // wrap a handler
 *   const limited = enforceRateLimit(request, 'verify');    // or inline
 *   if (limited) return limited;
 */

import { NextResponse } from 'next/server';
import { logger } from '../logger';
import { checkRateLimit, getClientIp, getSecurityHeaders } from './validation';

export interface RateLimitBucketConfig {
  /** Requests per minute per client IP (token bucket: burst = perMinute, refill = perMinute/60 per second). */
  perMinute: number;
  /** Name of a process-wide mutex that serializes the handler (solc compiles synchronously). */
  exclusive?: string;
}

/** Bucket name → limit. Add a bucket here before using it in a route. */
export const RATE_LIMITS = {
  /** General read APIs (blocks, transactions, stats, DEX, config, ...). */
  api: { perMinute: 100 },
  /**
   * /api/compile, /api/contract/verify, v2 verification, Etherscan verifysourcecode: 5/min.
   * Compiles run in a worker-thread queue (lib/contract/compile-worker.ts), so no mutex here.
   */
  verify: { perMinute: 5 },
  /** /api/contract/interact (POST). */
  interact: { perMinute: 30 },
  /** /api/tokens/[address]?tokenId= — reads tokenURI and fetches external metadata. */
  tokenMetadata: { perMinute: 10 },
  /** Launchpad reads that hit the node (kept for compatibility; the register / sync writes use `write`). */
  launchpad: { perMinute: 30 },
  /** Chain-authenticated writes: POST /api/launchpad/register, POST /api/launchpad/sync. */
  write: { perMinute: 10 },
  /** JSON-RPC relay (/api/web3relay). */
  relay: { perMinute: 60 },
  /** POST /api/contract/[address] (stores contract info). */
  contractWrite: { perMinute: 10 },
} as const satisfies Record<string, RateLimitBucketConfig>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Share of the normal limit granted to requests without a trusted client IP. */
export const UNKNOWN_IP_DIVISOR = 10;

export type RateLimitResponseFormat = 'default' | 'v2' | 'etherscan';

export interface EnforceRateLimitOptions {
  /** Body shape of the 429 response (`default`: `{ error, retryAfter }`, `v2`: `{ message }`, `etherscan`: `{ status: '0', message, result }`). */
  format?: RateLimitResponseFormat;
}

/** Denials per IP in the current minute (for the abuse warning). */
const deniedByIp = new Map<string, { count: number; windowStart: number; warned: boolean }>();
const ABUSE_WINDOW_MS = 60_000;
export const ABUSE_THRESHOLD = 20;

/** Number of 429s this IP received in the current one-minute window (across buckets). */
export function getDeniedInCurrentWindow(ip: string, now = Date.now()): number {
  const entry = deniedByIp.get(ip);
  if (!entry || now - entry.windowStart >= ABUSE_WINDOW_MS) return 0;
  return entry.count;
}

function recordDenial(ip: string, bucket: string, now = Date.now()): void {
  let entry = deniedByIp.get(ip);
  if (!entry || now - entry.windowStart >= ABUSE_WINDOW_MS) {
    entry = { count: 0, windowStart: now, warned: false };
    deniedByIp.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count >= ABUSE_THRESHOLD && !entry.warned) {
    entry.warned = true;
    // One line per IP per minute: the seed for a crowdsec scenario
    logger.warn('Rate limit abuse: repeated 429 responses', {
      ip,
      denied: entry.count,
      windowSeconds: ABUSE_WINDOW_MS / 1000,
      lastBucket: bucket,
    });
  }
  if (deniedByIp.size > 10_000) {
    for (const [key, value] of deniedByIp) {
      if (now - value.windowStart >= ABUSE_WINDOW_MS) deniedByIp.delete(key);
    }
  }
}

/** Test hook: forget the denial counters. */
export function resetRateLimitTracking(): void {
  deniedByIp.clear();
}

/** Effective per-minute limit for a bucket and client. */
export function effectiveLimit(bucket: RateLimitBucket, ip: string): number {
  const { perMinute } = RATE_LIMITS[bucket];
  return ip === 'unknown' ? Math.max(1, Math.floor(perMinute / UNKNOWN_IP_DIVISOR)) : perMinute;
}

function rateLimitBody(format: RateLimitResponseFormat, retryAfter: number) {
  switch (format) {
    case 'v2':
      return { message: 'Rate limit exceeded' };
    case 'etherscan':
      return { status: '0', message: 'Rate limit exceeded', result: null };
    default:
      return { error: 'Rate limit exceeded', retryAfter };
  }
}

/**
 * Apply a bucket to the request. Returns the 429 response to send, or null
 * when the request is allowed. Every denial is logged and counted.
 */
export function enforceRateLimit(
  request: Request,
  bucket: RateLimitBucket,
  options: EnforceRateLimitOptions = {}
): NextResponse | null {
  const ip = getClientIp(request);
  const limit = effectiveLimit(bucket, ip);
  const result = checkRateLimit(`${bucket}:${ip}`, limit, limit / 60);
  if (result.allowed) return null;

  const retryAfter = Math.max(1, result.resetIn);
  recordDenial(ip, bucket);
  logger.warn('Rate limit exceeded', {
    bucket,
    ip,
    limitPerMinute: limit,
    retryAfter,
    path: safePath(request),
  });
  return NextResponse.json(rateLimitBody(options.format ?? 'default', retryAfter), {
    status: 429,
    headers: { ...getSecurityHeaders(), 'Retry-After': String(retryAfter) },
  });
}

function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Mutex for handlers that must not run concurrently (solc compiles synchronously
// and blocks the event loop; serializing keeps one compile from starving others).

const mutexTails = new Map<string, Promise<void>>();

/** Run `fn` after every previously queued call with the same `name` has finished. */
export async function runExclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = mutexTails.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutexTails.set(
    name,
    previous.then(() => current)
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (mutexTails.get(name) === current) mutexTails.delete(name);
  }
}

type RouteHandler<Req extends Request, Ctx> = (
  request: Req,
  context: Ctx
) => Promise<Response> | Response;

/**
 * Wrap a route handler with a bucket (and the bucket's mutex, when it has one).
 *
 *   export const POST = withRateLimit('verify', async (request: NextRequest) => { ... });
 */
export function withRateLimit<Req extends Request = Request, Ctx = unknown>(
  bucket: RateLimitBucket,
  handler: RouteHandler<Req, Ctx>,
  options: EnforceRateLimitOptions = {}
): (request: Req, context: Ctx) => Promise<Response> {
  const exclusive = (RATE_LIMITS[bucket] as RateLimitBucketConfig).exclusive;
  return async (request, context) => {
    const limited = enforceRateLimit(request, bucket, options);
    if (limited) return limited;
    if (exclusive) return runExclusive(exclusive, async () => handler(request, context));
    return handler(request, context);
  };
}
