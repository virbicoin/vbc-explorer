/**
 * Security Utilities
 *
 * Input validation, sanitization, and security helpers.
 * Browser-safe: no Node-only imports (client components use isValidImageUrl).
 */

import { parseIpv4, parseIpv6, parseSafeHttpsUrl } from './url';

/**
 * Validate Ethereum address format
 */
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Validate transaction/block hash format
 */
export function isValidHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

/**
 * Validate block number (positive integer or 'latest', 'pending', etc.)
 */
export function isValidBlockNumber(value: string | number): boolean {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0;
  }
  if (['latest', 'pending', 'earliest', 'safe', 'finalized'].includes(value)) {
    return true;
  }
  return /^\d+$/.test(value) && parseInt(value, 10) >= 0;
}

/**
 * Sanitize address - normalize and validate
 */
export function sanitizeAddress(address: string): string | null {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim().toLowerCase();
  return isValidAddress(trimmed) ? trimmed : null;
}

/**
 * Sanitize hash - normalize and validate
 */
export function sanitizeHash(hash: string): string | null {
  if (!hash || typeof hash !== 'string') return null;
  const trimmed = hash.trim().toLowerCase();
  return isValidHash(trimmed) ? trimmed : null;
}

/**
 * Escape special regex characters to prevent ReDoS attacks
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create safe case-insensitive regex for address matching
 * Prevents NoSQL injection via $regex
 */
export function createAddressRegex(address: string): RegExp | null {
  const sanitized = sanitizeAddress(address);
  if (!sanitized) return null;
  // Address is already validated as hex, safe to use
  return new RegExp(`^${sanitized}$`, 'i');
}

/** Deepest page any list API serves: `page × limit` above this is rejected (skip ≈ full scan). */
export const DEFAULT_MAX_OFFSET = 100_000;

export interface PaginationOptions {
  /** Limit used when the parameter is missing or invalid (default 20). */
  defaultLimit?: number;
  /** Reject requests whose `page × limit` exceeds this (default DEFAULT_MAX_OFFSET). */
  maxOffset?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  /** `(page - 1) × limit` */
  skip: number;
  /** True when `page × limit` exceeds `maxOffset`; the route must answer 400. */
  tooDeep: boolean;
  maxOffset: number;
}

/**
 * Validate pagination parameters (the single place `page` / `limit` are interpreted).
 * - page: integer ≥ 1, otherwise 1
 * - limit: integer ≥ 1 capped at `maxLimit` (values above are rounded down to the cap),
 *   otherwise `defaultLimit`
 * - tooDeep: `page × limit > maxOffset` — callers reject with 400 (see rejectDeepPagination)
 */
export function validatePagination(
  page: unknown,
  limit: unknown,
  maxLimit: number = 100,
  options: PaginationOptions = {}
): Pagination {
  const defaultLimit = Math.min(options.defaultLimit ?? 20, maxLimit);
  const maxOffset = options.maxOffset ?? DEFAULT_MAX_OFFSET;
  let validPage = 1;
  let validLimit = defaultLimit;

  if (page !== undefined && page !== null) {
    const parsed = parseInt(String(page), 10);
    if (!isNaN(parsed) && parsed >= 1) {
      validPage = parsed;
    }
  }

  if (limit !== undefined && limit !== null) {
    const parsed = parseInt(String(limit), 10);
    if (!isNaN(parsed) && parsed >= 1) {
      validLimit = Math.min(parsed, maxLimit);
    }
  }

  return {
    page: validPage,
    limit: validLimit,
    skip: (validPage - 1) * validLimit,
    tooDeep: validPage * validLimit > maxOffset,
    maxOffset,
  };
}

/**
 * Validate and sanitize search query
 */
export function sanitizeSearchQuery(query: string, maxLength: number = 200): string {
  if (!query || typeof query !== 'string') return '';
  // Remove potentially dangerous characters
  return query
    .slice(0, maxLength)
    .replace(/[<>'"&\\]/g, '')
    .trim();
}

/**
 * Rate limiting token bucket (simple in-memory implementation)
 */
interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  key: string,
  maxTokens: number = 100,
  refillRate: number = 10, // tokens per second
  tokensToConsume: number = 1
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { tokens: maxTokens, lastRefill: now };
    rateLimitStore.set(key, entry);
  }

  // Refill tokens based on time passed
  const timePassed = (now - entry.lastRefill) / 1000;
  const tokensToAdd = Math.floor(timePassed * refillRate);

  if (tokensToAdd > 0) {
    entry.tokens = Math.min(maxTokens, entry.tokens + tokensToAdd);
    entry.lastRefill = now;
  }

  // Check if request is allowed
  if (entry.tokens >= tokensToConsume) {
    entry.tokens -= tokensToConsume;
    return {
      allowed: true,
      remaining: entry.tokens,
      resetIn: Math.ceil((maxTokens - entry.tokens) / refillRate),
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetIn: Math.ceil((tokensToConsume - entry.tokens) / refillRate),
  };
}

/**
 * Clean up old rate limit entries (run periodically)
 */
export function cleanupRateLimits(maxAge: number = 3600000): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.lastRefill > maxAge) {
      rateLimitStore.delete(key);
    }
  }
}

/** Header that carries the real client IP; nginx sets it from Cloudflare's CF-Connecting-IP. */
export const DEFAULT_TRUSTED_IP_HEADER = 'x-client-ip';

/** Name of the trusted client-IP header (`TRUSTED_IP_HEADER`, default `x-client-ip`). */
export function getTrustedIpHeaderName(
  env: Record<string, string | undefined> = process.env
): string {
  return (env.TRUSTED_IP_HEADER || DEFAULT_TRUSTED_IP_HEADER).trim().toLowerCase();
}

/** Canonical form of an IP address string, or null when it is not a valid IPv4/IPv6 address. */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  let text = value.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (parseIpv4(text)) return text;
  if (parseIpv6(text)) return text.toLowerCase();
  return null;
}

/**
 * Client IP for rate limiting. Reads ONLY the trusted header that the reverse
 * proxy overwrites on every request (`TRUSTED_IP_HEADER`, default
 * `x-client-ip`); X-Forwarded-For and X-Real-IP are never consulted because a
 * client can set them. A missing or malformed value yields 'unknown', which
 * shares one bucket with a tenth of the normal limit. In development (no
 * proxy) a missing header counts as the loopback address.
 */
export function getClientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env
): string {
  const ip = normalizeIp(request.headers.get(getTrustedIpHeaderName(env)));
  if (ip) return ip;
  if (env.NODE_ENV === 'development' && !request.headers.has(getTrustedIpHeaderName(env))) {
    return '127.0.0.1';
  }
  return 'unknown';
}

/**
 * Validate content type
 */
export function isValidContentType(
  request: Request,
  expected: string = 'application/json'
): boolean {
  const contentType = request.headers.get('content-type');
  return contentType?.includes(expected) ?? false;
}

/**
 * Validate image URL for security (shared rules with lib/security/url.ts)
 * - https only (http://localhost only in development)
 * - no credentials, no IP-literal host
 * - blocks javascript:, data:, vbscript:, file: and inline-handler patterns
 */
export function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return parseSafeHttpsUrl(url, { allowHttpLocalhost: process.env.NODE_ENV === 'development' }).ok;
}

/**
 * Sanitize image URL - returns null if invalid
 */
export function sanitizeImageUrl(url: string | undefined | null): string | null {
  if (!isValidImageUrl(url)) return null;
  return url!.trim();
}

/**
 * Create security headers for API responses
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store, max-age=0',
  };
}

// Periodic cleanup (every hour)
if (typeof setInterval !== 'undefined') {
  setInterval(() => cleanupRateLimits(), 3600000);
}
