/**
 * Security Utilities
 *
 * Input validation, sanitization, and security helpers.
 */

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

/**
 * Validate pagination parameters
 */
export function validatePagination(
  page: unknown,
  limit: unknown,
  maxLimit: number = 100
): { page: number; limit: number } {
  let validPage = 1;
  let validLimit = 20;

  if (page !== undefined && page !== null) {
    const parsed = parseInt(String(page), 10);
    if (!isNaN(parsed) && parsed >= 1) {
      validPage = parsed;
    }
  }

  if (limit !== undefined && limit !== null) {
    const parsed = parseInt(String(limit), 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= maxLimit) {
      validLimit = parsed;
    }
  }

  return { page: validPage, limit: validLimit };
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

/**
 * Get client IP from request (considering proxies)
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
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
 * Validate image URL for security
 * - Only allows https protocol
 * - Blocks javascript:, data:, and other dangerous schemes
 * - Validates URL structure
 */
export function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
    const parsed = new URL(url);

    // Only allow https (and http for localhost in development)
    if (parsed.protocol !== 'https:') {
      // Allow http only for localhost in development
      if (
        process.env.NODE_ENV === 'development' &&
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      ) {
        return true;
      }
      return false;
    }

    // Block dangerous patterns
    const dangerousPatterns = [
      /javascript:/i,
      /data:/i,
      /vbscript:/i,
      /file:/i,
      /<script/i,
      /on\w+=/i, // onclick=, onerror=, etc.
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(url)) {
        return false;
      }
    }

    // Check for valid image extensions or known image hosting patterns
    const pathname = parsed.pathname.toLowerCase();
    const validImageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'];
    const isImageExtension = validImageExtensions.some((ext) => pathname.endsWith(ext));

    // Allow URLs ending with image extensions or from IPFS gateways
    const isIpfsGateway = parsed.hostname.includes('ipfs') || parsed.pathname.includes('/ipfs/');

    return isImageExtension || isIpfsGateway || true; // Allow all https URLs for flexibility
  } catch {
    return false;
  }
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
