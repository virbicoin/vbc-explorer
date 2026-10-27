/**
 * Security Module Exports
 */

export {
  isValidAddress,
  isValidHash,
  isValidBlockNumber,
  sanitizeAddress,
  sanitizeHash,
  escapeRegex,
  createAddressRegex,
  validatePagination,
  sanitizeSearchQuery,
  checkRateLimit,
  cleanupRateLimits,
  getClientIp,
  getTrustedIpHeaderName,
  normalizeIp,
  DEFAULT_TRUSTED_IP_HEADER,
  isValidContentType,
  getSecurityHeaders,
  isValidImageUrl,
  sanitizeImageUrl,
} from './validation';

export {
  DEFAULT_IPFS_GATEWAY,
  isIpLiteral,
  isPrivateIp,
  parseSafeHttpsUrl,
  resolveIpfsUrl,
} from './url';

export {
  RATE_LIMITS,
  ABUSE_THRESHOLD,
  UNKNOWN_IP_DIVISOR,
  effectiveLimit,
  enforceRateLimit,
  withRateLimit,
  runExclusive,
  getDeniedInCurrentWindow,
  resetRateLimitTracking,
  type RateLimitBucket,
} from './rate-limits';
