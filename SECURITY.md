# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.7.x   | :white_check_mark: |
| < 0.7   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within VBC Explorer, please report it responsibly:

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Report via [GitHub Security Advisories](https://github.com/virbicoin/vbc-explorer/security/advisories/new)
3. Include detailed information about the vulnerability
4. Allow up to 48 hours for an initial response

## Security Best Practices

### Environment Configuration

#### Database Credentials

**NEVER** commit database credentials to version control. Use environment variables:

```bash
# .env.local (DO NOT COMMIT)
MONGODB_URI=mongodb://user:password@localhost:27017/explorerDB?authSource=explorerDB
```

Update your `config.json` to reference environment variables:

```json
{
  "database": {
    "uri": "${MONGODB_URI}"
  }
}
```

The application will automatically resolve `${MONGODB_URI}` from environment variables.

#### Sensitive Configuration

Create a `.env.local` file for sensitive values:

```bash
# Required
MONGODB_URI=mongodb://...

# Optional - API Keys for Price Data
CMC_API_KEY=your_coinmarketcap_api_key
```

### API Security

#### Rate Limiting

The explorer implements rate limiting on sensitive endpoints:

- `/api/contract/verify` - 5 requests per 15 minutes
- `/api/contracts` - 60 requests per minute
- `/api/address/*` - 100 requests per 15 minutes
- `/api/tokens/*` - 100 requests per 15 minutes

Configure rate limits in `config.json`:

```json
{
  "api": {
    "rateLimit": {
      "windowMs": 900000,
      "max": 100
    }
  }
}
```

#### CORS Configuration

Configure allowed origins for production:

```json
{
  "api": {
    "cors": {
      "origin": ["https://your-domain.com"],
      "credentials": true
    }
  }
}
```

### Input Validation

The explorer uses comprehensive input validation through `lib/security/validation.ts`:

- **Address validation** - Ethereum address format verification
- **Hash validation** - Transaction/block hash verification
- **Pagination limits** - Maximum 10,000 records per request
- **String sanitization** - XSS prevention through HTML entity encoding
- **Safe RegExp** - Protection against ReDoS attacks
- **Image URL validation** - External image URL security for Launchpad tokens

### Image URL Security

Token images from Launchpad (TokenFactory) support external URLs with strict security:

```typescript
// lib/security/validation.ts
isValidImageUrl(url: string): boolean
sanitizeImageUrl(url: string): string | null
```

**Security measures:**
- HTTPS protocol required (HTTP only for localhost in development)
- Blocked schemes: `javascript:`, `data:`, `vbscript:`, `file:`
- XSS pattern detection: `<script`, `onclick=`, `onerror=`, etc.
- Next.js CSP: `script-src 'none'; sandbox;` for SVG images

### Security Headers

The following security headers are automatically applied via `middleware.ts`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-XSS-Protection` | `1; mode=block` | XSS filter |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer info |
| `Permissions-Policy` | Restricted | Limit browser features |
| `Strict-Transport-Security` | `max-age=31536000` | Enforce HTTPS (production) |
| `Content-Security-Policy` | Configured | XSS prevention (API routes) |

### Smart Contract Verification

Contract verification includes:

- **Size limits** - Maximum 500KB source code
- **Rate limiting** - 5 verifications per 15 minutes
- **Content-Type validation** - JSON only
- **Solc compiler sandboxing** (recommended)

### WebSocket Security

When using WebSocket relay (`/api/ws`):

- Validate all incoming method calls
- Implement connection timeouts
- Monitor for abuse patterns

### Deployment Checklist

Before deploying to production:

- [ ] Remove all hardcoded credentials from `config.json`
- [ ] Set `MONGODB_URI` via environment variable
- [ ] Configure production CORS origins
- [ ] Enable HTTPS (Strict-Transport-Security)
- [ ] Review rate limit settings
- [ ] Run `npm audit` and address vulnerabilities
- [ ] Disable debug logging in production
- [ ] Set `NODE_ENV=production`

### Dependency Security

Regularly audit dependencies:

```bash
# Check for vulnerabilities
npm audit

# Fix automatically (where possible)
npm audit fix

# Review detailed report
npm audit --json
```

### Known Vulnerabilities

#### Low Severity

- **solc** (via tmp package) - Temporary file arbitrary write
  - CVE: GHSA-52f5-9888-hmc6
  - Mitigation: Run compilation in isolated environment
  - Status: Monitoring for upstream fix

## Security Features

### Implemented

- ✅ Input validation and sanitization
- ✅ Rate limiting on sensitive endpoints
- ✅ Security headers via middleware
- ✅ Safe RegExp patterns (ReDoS protection)
- ✅ Pagination limits
- ✅ Environment variable support for secrets
- ✅ CORS configuration
- ✅ Content-Type validation

### API Response Format Security

API responses follow a standardized format defined in `lib/api-response.ts`:

```typescript
// Successful paginated response
{
  data: [...],
  meta: {
    pagination: { total, page, limit, pages, hasMore },
    timestamp: string
  }
}

// Error response
{
  error: {
    code: "ERROR_CODE",
    message: "Human readable message"
  },
  meta: { timestamp: string }
}
```

**Security benefits:**
- Consistent error handling prevents information leakage
- Pagination limits prevent excessive data exposure
- Timestamps aid in audit logging

### Recommended Additional Measures

- 🔲 Web Application Firewall (WAF)
- 🔲 DDoS protection (Cloudflare, etc.)
- 🔲 Container isolation for solc compilation
- 🔲 Regular security audits
- 🔲 Penetration testing
- 🔲 Security monitoring and alerting

## Changelog

### v0.7.8 (January 2026)

- **API Response Standardization**: Unified response format across all API endpoints
  - New `lib/api-response.ts` with `paginatedResponse()`, `errorResponse()` utilities
  - Consistent pagination metadata: `{ total, page, limit, pages, hasMore }`
  - Error responses include structured error codes and messages
  - Frontend compatibility maintained for both old and new formats

- **Contract Type Detection Improvement**: Enhanced type inference from database
  - Multi-source inference: ERC field → type field → name keywords → symbol/decimals
  - `normalizeContractType()` converts inconsistent formats (ERC20/VRC20 → VRC-20)
  - Keywords detection: "NFT", "ERC721", "VRC-721" in name/symbol

- **DEX Blacklist LP Filtering**: Blacklisted LP pairs now properly filtered
  - `getBlacklistedLPAddresses()` function in `lib/dex/cache-service.ts`
  - Respects `blacklist.lpPairs` from `config.json`

### v0.7.7 (January 2026)

- **External Image URL Security**: Added comprehensive URL validation for Launchpad token images
  - `isValidImageUrl()` - Validates and sanitizes external image URLs
  - HTTPS protocol enforcement (HTTP only allowed for localhost in development)
  - Blocks dangerous schemes: `javascript:`, `data:`, `vbscript:`, `file:`
  - XSS pattern detection: `<script`, `onclick=`, `onerror=`, etc.
  - Applied to all TokenIcon components across DEX pages
- **Next.js Image Security**: Updated `remotePatterns` to allow any HTTPS domain
  - CSP maintained: `default-src 'self'; script-src 'none'; sandbox;`
  - SVG images rendered with `sandbox` attribute
- **TokenFactory Integration Fix**: Corrected `factoryAddress` reference in API routes
  - `/api/dex/tokens` - Now correctly fetches logoUrl from TokenFactory
  - `/api/dex/pairs` - Fixed logoURI retrieval for Launchpad tokens

### v0.7.6 (January 2026)

- **Security Audit Completed**: Comprehensive review of DEX, Launchpad, and core API routes
- **Critical Fix**: NoSQL injection vulnerability in `/api/launchpad/register`
  - Replaced unsafe `$regex` with direct lowercase address matching
- **Critical Fix**: Unauthenticated contract POST endpoint
  - Added input validation (address format verification)
  - Added rate limiting (10 requests/minute per IP)
  - Added request body validation
- **Enhancement**: DEX API price calculation security
  - VBC/USDT pairs now use on-chain DEX price instead of external API
  - Prevents price manipulation via external API compromise
- **Enhancement**: GeckoTerminal/DefiLlama API improvements
  - TVL calculation now correctly sums both token reserves
  - `base_token_price_usd` uses pool-derived pricing for accuracy
  - Added farming APR calculation from MasterChef contract

### v0.7.5 (January 2025)

- **Security Audit Completed**: Comprehensive review of all 47 API routes
- Fixed RegExp injection vulnerabilities in:
  - `/api/search/blocks-by-miner` (miner address)
  - `/api/tokens/[address]/balance` (token/wallet address)
- Enhanced `/api/contract/interact`:
  - Added method whitelist (read-only methods only)
  - Added ABI validation and size limits
  - Implemented rate limiting
- Added input validation to `/api/tx/[hash]`:
  - Transaction hash format validation
  - Rate limiting
- Added input validation to `/api/block/[number]`:
  - Block number format validation
  - Rate limiting
- Enhanced main Blockscout API (`/api?module=...`):
  - Added rate limiting (100 req/min)
  - Validated all address, hash, and pagination parameters
  - Added module/action name validation
- Updated documentation:
  - Added security FAQs to `/dex/docs`
  - Added security section to `/api-docs`

### v0.7.4

- Added comprehensive input validation
- Implemented rate limiting
- Added security headers middleware
- Created security documentation
- Updated config.example.json to use environment variables

## Security Audit Results (January 2026)

### Summary

| Status | Count | Percentage |
|--------|-------|------------|
| Protected endpoints | 40+ | 80%+ |
| Read-only endpoints | 25+ | 53%+ |
| Rate-limited endpoints | 15+ | 32%+ |
| Image URL validated | All DEX pages | 100% |

### Critical Fixes Applied

1. **NoSQL Injection Prevention**: Replaced `new RegExp(userInput)` with direct lowercase matching
2. **Contract API Protection**: Added authentication, validation, and rate limiting
3. **DEX Price Security**: On-chain price derivation prevents external API manipulation
4. **Input Validation**: All user inputs (addresses, hashes, pagination) validated before use
5. **Rate Limiting**: Added to all sensitive endpoints including contract verification and registration
6. **External Image URL Security**: Comprehensive validation for Launchpad token images
   - HTTPS enforcement
   - Dangerous scheme blocking (javascript:, data:, vbscript:, file:)
   - XSS pattern detection

### API Security Matrix

| Endpoint Category | Validation | Rate Limit | Auth | Notes |
|-------------------|------------|------------|------|-------|
| `/api/address/*` | ✅ | ✅ | - | Address format validated |
| `/api/block/*` | ✅ | ✅ | - | Block number validated |
| `/api/tx/*` | ✅ | ✅ | - | Hash format validated |
| `/api/contract/*` | ✅ | ✅ | - | All inputs validated |
| `/api/tokens/*` | ✅ | ✅ | - | Address validated |
| `/api/launchpad/*` | ✅ | ✅ | - | NoSQL injection fixed |
| `/api/dex/geckoterminal/*` | ✅ | - | - | Read-only, address validated |
| `/api/dex/cmc/*` | ✅ | - | - | Read-only |
| `/api/dex/defillama/*` | ✅ | - | - | Read-only |

### Remaining Recommendations

- Consider adding rate limiting to DEX API endpoints for DoS protection
- Implement request logging for security monitoring
- Regular dependency audits with `npm audit`

---

Last Updated: January 2026
