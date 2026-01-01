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

# Optional - API Keys
COINGECKO_API_KEY=your_api_key
COINPAPRIKA_API_KEY=your_api_key
```

### API Security

#### Rate Limiting

The explorer implements rate limiting on sensitive endpoints:

- `/api/contract/verify` - 5 requests per 15 minutes
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

### Recommended Additional Measures

- 🔲 Web Application Firewall (WAF)
- 🔲 DDoS protection (Cloudflare, etc.)
- 🔲 Container isolation for solc compilation
- 🔲 Regular security audits
- 🔲 Penetration testing
- 🔲 Security monitoring and alerting

## Changelog

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

## Security Audit Results (January 2025)

### Summary

| Status | Count | Percentage |
|--------|-------|------------|
| Protected (before) | 4 | 8.5% |
| Protected (after) | 10+ | 21%+ |
| Read-only endpoints | 25+ | 53%+ |
| Needs attention | 12 | 26% |

### Critical Fixes Applied

1. **RegExp Injection Prevention**: Replaced `new RegExp(userInput)` with sanitized address matching
2. **Arbitrary Code Execution Prevention**: Contract interact limited to whitelisted read methods
3. **Input Validation**: All user inputs (addresses, hashes, pagination) validated before use
4. **Rate Limiting**: Added to all sensitive endpoints

### Remaining Recommendations

- Add security to remaining DEX API endpoints (CMC, GeckoTerminal, DefiLlama)
- Consider adding authentication for administrative endpoints
- Implement request logging for security monitoring

## Contact

For security-related inquiries:

- GitHub: [Security Advisories](https://github.com/virbicoin/vbc-explorer/security/advisories/new)

---

This security policy is reviewed and updated quarterly.

Last Updated: January 2025
