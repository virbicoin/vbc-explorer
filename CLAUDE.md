# CLAUDE.md - VBC Explorer Project Guide

This file provides guidance to Claude Code (claude.ai/code) when working with this codebase.

## Project Overview

VBC Explorer is a modern blockchain explorer for VirBiCoin (and any EVM-compatible network) built with Next.js 16 App Router, TypeScript, and MongoDB. It includes NFT support, contract verification, DEX (decentralized exchange), Token Launchpad, and comprehensive API endpoints compatible with GeckoTerminal, CoinMarketCap, and DefiLlama.

## Tech Stack

- **Framework**: Next.js 16+ (App Router)
- **Language**: TypeScript 5.9+
- **Database**: MongoDB with Mongoose 9
- **Styling**: Tailwind CSS 4
- **Web3**: ethers.js 6, web3.js 4, viem 2, wagmi 3
- **State Management**: @tanstack/react-query 5
- **Process Manager**: PM2
- **Proxy**: proxy.ts (replaces deprecated middleware.ts)

## Project Structure

```
app/                    # Next.js App Router pages and API routes
  api/                  # API endpoints
    address/            # Address info, transactions, tokens, mining
    block/              # Block details
    blocks/             # Block listing
    blockheight/        # Current block height
    circulating_supply/ # Circulating supply (CoinGecko/CMC compatible)
    compile/            # Solidity compilation
    config/             # Client configuration
    contract/           # Contract verification & interaction
    contracts/          # Contract listing
    dex/                # DEX APIs
      cmc/              # CoinMarketCap compatible endpoints
      defillama/        # DefiLlama compatible endpoints
      geckoterminal/    # GeckoTerminal V2 compatible endpoints
      chart/            # Price chart data
      pairs/            # Trading pairs
      pools/            # Liquidity pools
      tokens/           # DEX tokens
      stats/            # DEX statistics
      external-price/   # External price data
    launchpad/          # Token Launchpad APIs
    network/            # Network/node info
    realtime/           # Real-time data
    richlist/           # Rich list
    search/             # Search APIs
    stats/              # Network statistics, gas, daily
    tokens/             # Token APIs
    total_supply/       # Total supply (CoinGecko/CMC compatible)
    transactions/       # Transaction listing & pending
    tx/                 # Transaction details
    v2/                 # Blockscout v2 compatible APIs
    web3relay/          # Web3 RPC relay
    ws/                 # WebSocket relay
    route.ts            # Etherscan-compatible API
  api-docs/             # API documentation page
  components/           # Page-specific components
  dex/                  # DEX pages (Swap, Pool, Farm, Analytics, Docs)
  launchpad/            # Token Launchpad pages
  token/[address]/      # Token detail pages
  
abi/                    # Smart contract ABIs
  MasterChefABI.ts      # MasterChef farming contract
  TokenFactoryABI.ts    # Legacy token factory
  TokenFactoryV2ABI.ts  # V2 token factory with metadata
  
components/             # Shared components
config/                 # Configuration (farming.ts)
hooks/                  # Custom React hooks
  useDexConfig.ts       # DEX configuration hook
  useDexTokens.ts       # DEX tokens hook
  useFarming.ts         # Farming hook
  useLaunchpadConfig.ts # Launchpad configuration hook
  useTokenConfig.ts     # Token configuration hook
  
lib/                    # Utility libraries
  cache/                # In-memory caching
  db/                   # Database abstraction layer
  dex/                  # DEX-specific utilities & cache service
  security/             # Input validation & rate limiting
  services/             # Business logic services
  types/                # TypeScript type definitions
  utils/                # Utility functions
  web3/                 # Web3 singleton provider
  bigint-utils.ts       # BigInt utilities
  client-config.ts      # Client-side configuration
  config.ts             # Server-side configuration
  db.ts                 # Database connection
  etherUnits.ts         # Unit conversion
  filters.ts            # Data filters
  launchpad-token-source.ts # Launchpad token data
  models.ts             # Model interfaces
  price-service.ts      # Price data service
  stats.ts              # Statistics utilities
  supply.ts             # Supply calculation
  transaction-utils.ts  # Transaction utilities
  
models/                 # Mongoose models
tools/                  # CLI tools for blockchain sync
  sync.ts               # Blockchain synchronization
  tokens.ts             # Token data sync (NFT/ERC20)
  stats.ts              # Statistics calculation
  richlist.ts           # Rich list generation
  price.ts              # Price + DEX swap sync
  register-contracts.ts # Contract registration
  optimize-indexes.ts   # Database index optimization
  add-token.ts          # Manual token addition
  
types/                  # TypeScript type definitions
logs/                   # Log files
public/                 # Static assets
```

## Performance Optimizations

### Web3 Singleton (`lib/web3/provider.ts`)
- Single Web3 instance shared across all API routes
- Avoids creating new connections for each request
- Lazy initialization for faster startup

### In-Memory Cache (`lib/cache/memory-cache.ts`)
- LRU-like cache with TTL support
- Reduces database queries and RPC calls
- Configurable memory limits (default 50MB)
- Auto-cleanup of expired entries

```typescript
import { apiCache, CACHE_TTL } from '@/lib/cache';

// Cache for 1 minute
const data = await apiCache.getOrSet('key', fetcher, CACHE_TTL.MEDIUM);
```

### DEX Cache Service (`lib/dex/cache-service.ts`)
Centralized caching for DEX/GeckoTerminal API endpoints to reduce RPC calls:
- **Token info cache**: 30 min TTL (symbol, name, decimals rarely change)
- **Pool info cache**: 10s TTL (reserves change frequently)
- **Pool stats cache**: 10s TTL (volume/tx stats)
- **VBC price cache**: 10s TTL
- **Response-level cache**: 30-60s for full API responses

Key benefits:
- Reduces RPC calls by 80%+ under load
- Batch processing with concurrency limits (2-3 pools at a time)
- Shared provider instance across all requests

```typescript
import {
  getCachedVBCPrice,
  getCachedPoolInfo,
  getCachedPoolStats,
  getCachedTokenInfo,
  getLPAddresses,
} from '@/lib/dex/cache-service';

// Get cached data (automatically fetches if not cached)
const poolInfo = await getCachedPoolInfo(poolAddress);
const vbcPrice = await getCachedVBCPrice();
```

### Next.js Optimizations (`next.config.ts`)
- `output: 'standalone'` - Smaller deployment size
- `optimizePackageImports` - Tree-shaking for large packages
- `serverExternalPackages` - Prevent bundling heavy server deps
- `compress: true` - Gzip compression enabled

### Database Indexes (`npm run optimize-indexes`)
- Compound indexes for common query patterns
- Background index creation (non-blocking)
- Run after initial setup for best performance

## Common Commands

```bash
# Development
npm run dev             # Start development server
npm run build           # Build for production
npm run start           # Start production server

# Code Quality
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint issues
npm run typecheck       # TypeScript type checking
npm run format          # Format code with Prettier
npm run format:check    # Check formatting
npm run check           # Run lint, typecheck, and format:check

# Blockchain Sync Tools
npm run sync            # Sync blockchain data
npm run tokens          # Sync token (NFT/ERC20) data
npm run stats           # Calculate statistics
npm run richlist        # Generate rich list
npm run price           # Update price + DEX swap data (Exbitron + on-chain)

# Database Management
npm run optimize-indexes # Create/optimize DB indexes
npm run create-indexes   # Create database indexes

# PM2 Process Management
pm2 restart explorer    # Restart explorer
pm2 logs explorer       # View logs
pm2 logs price          # View price sync logs
pm2 status              # Check service status
pm2 monit               # Monitor resources
```

## Price & DEX Data Architecture

### Price Sources (tools/price.ts, lib/price-service.ts)
Price APIs are tried in priority order:
1. **CoinGecko** - `https://api.coingecko.com/api/v3/simple/price`
2. **CoinMarketCap** - Requires `CMC_API_KEY` environment variable
3. **Coinpaprika** - `https://api.coinpaprika.com/v1/tickers`
4. **Exbitron** - `https://api.exbitron.digital/api/v2/peatio/public/markets`
5. **DEX Fallback** - On-chain price from LP pair reserves

Configure in `config.json` under `currency.priceApi`:
```json
"priceApi": {
  "coingecko": { "enabled": true, "id": "virbicoin" },
  "cmc": { "enabled": false, "id": "virbicoin" },
  "coinpaprika": { "enabled": true, "id": "vbc-virbicoin" },
  "exbitron": { "enabled": true, "symbol": "VBC" },
  "dex": { "enabled": true, "pairAddress": "0x..." }
}
```
- **Update Intervals**: Price every 5 minutes, DEX swaps every 15 seconds

### Price Service (lib/price-service.ts)
Centralized price data access for all API routes:
```typescript
import { getNativePrice, getPriceFromDatabase } from '@/lib/price-service';

// Get current price with source info
const priceData = await getNativePrice();
// Returns: { price: 0.000217, source: 'Market DB', timestamp: Date }
```

### DEX Swap Sync
- Syncs Swap events from Router contract to `DexSwap` collection
- Powers GeckoTerminal OHLCV, CMC trades, and chart APIs

## Security Features

### Input Validation (`lib/security/validation.ts`)
- Address/hash format validation with `sanitizeAddress()`, `sanitizeHash()`
- Pagination parameter validation with `validatePagination()`
- Regex escaping to prevent ReDoS attacks
- **NoSQL injection prevention**: Use direct lowercase matching instead of `$regex`
- **Image URL validation**: `isValidImageUrl()` for external token images
  - HTTPS-only enforcement (blocks http://)
  - Dangerous scheme blocking (javascript:, data:, vbscript:, file:)
  - XSS pattern detection (onclick=, onerror=, <script)
  - Use `sanitizeImageUrl()` wrapper that returns null for invalid URLs

### Rate Limiting
- Token bucket algorithm per client IP
- Configurable limits per endpoint (default: 100 req/min)
- Stricter limits for sensitive endpoints:
  - Contract verification: 10 req/10s
  - Contract POST/update: 10 req/min
  - Contract interact: 30 req/min
  - Blockscout API: 100 req/min
  - Token balance: 60 req/min

### Security Headers (`proxy.ts`)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (production only)
- `Content-Security-Policy` for API routes

### DEX Blacklist Filtering (`lib/dex/cache-service.ts`)
- LP pairs listed in `config.json` `blacklist.lpPairs` are excluded from all DEX APIs
- Affects `/api/dex/geckoterminal/pools`, `/api/dex/stats`, etc.
- Use for deprecated/test pools

### DEX Price Security
- **On-chain price derivation**: VBC/USDT pairs use pool reserve ratio for price calculation
- Prevents external API manipulation attacks
- TVL calculated as sum of both token reserves (50/50 pool)

### API Security
- Request body size limits
- Content-Type validation
- Source code size limit (500KB for contract verification)
- Input validation on all write operations

```typescript
import { 
  sanitizeAddress,
  sanitizeHash,
  isValidAddress,
  isValidHash,
  isValidBlockNumber,
  isValidImageUrl,
  sanitizeImageUrl,
  validatePagination,
  checkRateLimit, 
  getClientIp,
  getSecurityHeaders 
} from '@/lib/security';

// In API route - Complete example
export async function GET(request: NextRequest) {
  // 1. Rate limiting
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`endpoint:${clientIp}`, 60, 30);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  // 2. Input validation
  const address = searchParams.get('address');
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  // 3. Sanitize and use
  const sanitizedAddress = sanitizeAddress(address);
  // ... use sanitizedAddress in DB queries

  return NextResponse.json(data, { headers: getSecurityHeaders() });
}
```

## Key Implementation Details

### NFT Token Transfers (tools/tokens.ts)

When syncing NFT transfers, the unique key is `tokenAddress + tokenId + blockNumber + to`. This is crucial because:
- One transaction can emit multiple Transfer events (batch mint/burn)
- Using only `transactionHash` as key causes data loss

### Token Ownership Calculation (app/api/tokens/[address]/route.ts)

NFT ownership is calculated by:
1. Fetching all Transfer events sorted by timestamp
2. Building a `tokenOwnership` Map
3. Deleting from map when `to === ZERO_ADDR` (burn)
4. Setting owner when transfer to non-zero address
5. Final map size = actual NFT supply (excluding burned)

### Database Collections

- `blocks` - Block data
- `transactions` - Transaction data
- `contracts` - Verified contracts (ERC field: 0=contract, 2=ERC20, 721=VRC-721, 1155=VRC-1155)
- `tokens` - Token metadata
- `tokentransfers` - Token transfer events
- `tokenholders` - Token holder balances
- `accounts` - Account balances
- `markets` - Price data from multiple sources (updated by price.ts)
- `dexswaps` - DEX swap events (updated by price.ts)

### Contract Type Detection (`app/api/contracts/route.ts`)
The API infers token type from multiple sources:
1. **ERC field** - 2/20=VRC-20, 721=VRC-721, 1155=VRC-1155
2. **type field** - Normalized to VRC-XX format (ERC20 → VRC-20)
3. **Name inference** - Names containing 'nft'/'721' → VRC-721
4. **Symbol inference** - Has symbol + decimals → VRC-20
5. **tokenName field** - If set → VRC-20

All types use constants from `lib/api-response.ts`: `ContractTypes.VRC20`, etc.

### Configuration

Main config file: `config.json` (not in git, use `config.example.json` as template)

Key config sections:
- `web3Provider` - RPC endpoint
- `database` - MongoDB connection
- `dex` - DEX contract addresses
- `launchpad` - Token factory address
- `network` - Chain ID and name

## Common Issues & Solutions

### Missing NFT Token IDs
If some NFTs don't appear, run `npm run tokens` to resync. The sync tool now correctly handles multiple Transfer events per transaction.

### Type Errors with window.ethereum
Global type definitions are in `types/global.d.ts`.

### Memory Issues with Sync Tools
Memory limits are configured via `MEMORY_LIMIT_MB` env var. Adjust in npm scripts if needed.

## New Features (2026-01)

### Address Type Redirect
- `/address/[address]` automatically redirects to `/contract/` or `/token/` based on address type
- Implemented in `proxy.ts` using lightweight type check API
- API endpoint: `GET /api/address/[address]/type` returns `{ type: 'token' | 'contract' | 'wallet' }`

### Gas Tracker
- Real-time gas price tracking with slow/standard/fast/instant tiers
- API endpoint: `GET /api/stats/gas`
- Displayed on homepage

### Daily Statistics
- Historical transaction and block statistics
- API endpoint: `GET /api/stats/daily?period=7d|30d|90d`
- Displayed on `/stats` page with charts

### Network Information
- Node version, client info, and network details
- API endpoint: `GET /api/network/node`
- Displayed on `/network` page

### Contracts List
- Browse all verified and unverified contracts
- API endpoint: `GET /api/contracts`
- Page: `/contracts`

### Pending Transactions
- View pending transactions in mempool
- API endpoint: `GET /api/transactions/pending`
- Page: `/txs/pending`

### Dynamic Configuration
All hardcoded values have been moved to `config.json`:
- Network name, Chain ID, RPC URL, Explorer URL
- Currency name, symbol, decimals
- DEX contract addresses
- Social links

Components that use dynamic config:
- `AddVBCButton.tsx` - MetaMask network addition
- `api-docs/page.tsx` - API documentation
- `dex/docs/page.tsx` - DEX documentation
- `contract/verify/page.tsx` - Hardhat config examples
- `network/page.tsx` - Network information

## API Response Format

### Standard Response Format (`lib/api-response.ts`)
All paginated APIs use a unified response structure:

```typescript
// Success response
{
  "data": [...],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 100,
      "totalPages": 4
    },
    "timestamp": 1737190800000
  }
}

// Error response
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later.",
    "details": { "retryAfter": 60 }
  }
}
```

### Response Utilities
```typescript
import {
  paginatedResponse,    // Paginated data response
  successResponse,      // Non-paginated success
  errorResponse,        // Custom error
  rateLimitResponse,    // 429 rate limit
  notFoundResponse,     // 404 not found
  internalErrorResponse, // 500 server error
  ContractTypes,        // { VRC20: 'VRC-20', VRC721: 'VRC-721', ... }
  normalizeContractType // ERC20 → VRC-20 normalization
} from '@/lib/api-response';
```

### Frontend Compatibility
Frontend pages support both old and new formats:
```typescript
const data = await res.json();
const items = data.data || data.contracts || [];
const total = data.meta?.pagination?.total ?? data.total ?? 0;
```

## API Endpoints

### Token API
- `GET /api/tokens/[address]` - Token details, holders, transfers, NFT items
- Query params: `holdersPage`, `holdersLimit`, `transfersPage`, `transfersLimit`, `nftsPage`, `nftsLimit`

### Contract API
- `POST /api/contract/verify` - Verify contract source code (supports single-file and Standard JSON Input)
- `GET /api/contract/[address]` - Get contract info
- `GET /api/contract/status/[address]` - Get contract verification status

### Contract Verification API (Etherscan/Hardhat Compatible)
- `POST /api?module=contract&action=verifysourcecode` - Submit contract for verification (JSON body or form-urlencoded)
- `GET /api?module=contract&action=checkverifystatus&guid=...` - Check verification status
- `GET /api?module=contract&action=getabi&address=...` - Get contract ABI
- `GET /api?module=contract&action=getsourcecode&address=...` - Get verified source code

**Supported Compiler Versions:**
- 0.8.15 - 0.8.33 (with full commit hash mapping)
- 0.6.12 (legacy support)

**Verification Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `contractaddress` / `address` | Yes | Contract address |
| `sourceCode` | Yes* | Solidity source code (single file mode) |
| `standardJsonInput` | Yes* | Standard JSON Input (multi-file mode) |
| `compilerversion` / `compilerVersion` | Yes | Compiler version (e.g., `v0.8.30+commit.73712a01` or `0.8.30`) |
| `contractname` / `contractName` | No | Contract name (auto-detected if not provided) |
| `optimizationUsed` / `optimization` | No | Enable optimization (`1`/`0` or `true`/`false`) |
| `runs` / `optimizationRuns` | No | Optimization runs (default: 200) |
| `evmversion` / `evmVersion` | No | EVM version (default: `paris`) |
| `constructorArguements` / `constructorArguments` | No | ABI-encoded constructor arguments |

*Either `sourceCode` or `standardJsonInput` is required.

**Standard JSON Input Format:**
```json
{
  "language": "Solidity",
  "sources": {
    "MyContract.sol": {
      "content": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\n..."
    }
  },
  "settings": {
    "optimizer": { "enabled": true, "runs": 200 },
    "evmVersion": "paris"
  }
}
```

**Contract Name Format for Standard JSON Input:**
- `FileName.sol:ContractName` (e.g., `MyContract.sol:MyContract`)

### DEX API
- `GET /api/dex/pairs` - List trading pairs
- `GET /api/dex/tokens` - List tokens
- `GET /api/dex/chart/[pair]` - Price chart data
- `GET /api/dex/external-price` - External price (Exbitron + DEX fallback)

### DEX API - GeckoTerminal Compatible (Full V2 API)
All endpoints validate address parameters with `ethers.isAddress()` and sanitize query parameters.
Error responses use standard JSON:API format: `{ errors: [{ status: "404", title: "..." }] }`

| Endpoint | Parameters | Limits |
|----------|------------|--------|
| `/api/dex/geckoterminal/networks` | - | Cache: 1 hour |
| `/api/dex/geckoterminal/dexes` | - | Cache: 1 hour |
| `/api/dex/geckoterminal/pools` | - | Cache: 30s |
| `/api/dex/geckoterminal/pool/[address]` | address (validated) | Cache: 30s |
| `/api/dex/geckoterminal/token/[address]` | address (validated) | Cache: 60s |
| `/api/dex/geckoterminal/ohlcv/[pool]` | timeframe, aggregate, limit, currency | limit: 1-1000, aggregate: 1-60, type: ohlcv_request_response |
| `/api/dex/geckoterminal/trades/[pool]` | limit, trade_volume_in_usd_greater_than | limit: 1-300 |
| `/api/dex/geckoterminal/simple/price` | addresses (comma-separated) | max 30 addresses, format: { "0x...": "price" } |
| `/api/dex/geckoterminal/trending_pools` | page | page: 1-100 |
| `/api/dex/geckoterminal/new_pools` | page | page: 1-100 |
| `/api/dex/geckoterminal/search/pools` | query, page | query: 2-100 chars, page: 1-100 |
| `/api/dex/geckoterminal/info` | - | Cache: 1 hour |

### DEX API - CoinMarketCap Compatible
- `GET /api/dex/cmc/summary` - DEX summary
- `GET /api/dex/cmc/ticker` - Trading pairs with price/volume
- `GET /api/dex/cmc/assets` - Listed assets
- `GET /api/dex/cmc/trades/[pair]` - Recent trades
- `GET /api/dex/cmc/orderbook/[pair]` - AMM orderbook simulation

### DEX API - DefiLlama Compatible
- `GET /api/dex/defillama` - Protocol info with TVL
- `GET /api/dex/defillama/tvl` - TVL (plain number)
- `GET /api/dex/defillama/pools` - Pool data (yields format)
- `GET /api/dex/defillama/prices` - Token prices with confidence
- `GET /api/dex/defillama/historical` - Historical TVL (30 days)

### Statistics API
- `GET /api/stats` - Network statistics
- `GET /api/stats/gas` - Gas price tracker (slow/standard/fast/instant)
- `GET /api/stats/daily` - Daily statistics (transactions, blocks, gas)

### Network API
- `GET /api/network/node` - Node information (version, client, peers)

### Contracts API
- `GET /api/contracts` - List all contracts with pagination and filters

### Pending Transactions API
- `GET /api/transactions/pending` - Pending transactions in mempool

### Address Type API
- `GET /api/address/[address]/type` - Check if address is token, contract, or wallet

## Code Style

- Use functional components with hooks
- Prefer `async/await` over `.then()`
- Use TypeScript strict mode
- Follow ESLint rules (eslint-config-next)
- Use Tailwind CSS for styling
- Locale: Japanese (ja) for user-facing content

## Architecture Improvement Proposals

### Current Issues

1. **Code Duplication**
   - `models/index.ts` and `lib/models.ts` have duplicate interfaces
   - Token ownership calculation logic exists in both API and tools

2. **Large Files**
   - `app/api/tokens/[address]/route.ts` (~1400 lines)
   - `tools/tokens.ts` (~1200 lines)

3. **Scattered DB Access**
   - Direct `mongoose.connection.db` usage across API routes
   - No abstraction layer for database operations

4. **Type Inconsistencies**
   - DB schemas and API response types defined separately

### Proposed Architecture (Future Refactoring)

**Phase 1 & 2 Completed:**

```
lib/
  types/                    # ✅ Centralized type definitions
    index.ts                # Core types (Block, Transaction, Account, Token, etc.)
  
  db/                       # ✅ Database abstraction layer
    connection.ts           # Singleton DB connection manager
    base-repository.ts      # Base repository with common CRUD operations
    index.ts                # Barrel exports
  
  services/                 # ✅ Business logic layer
    nft.service.ts          # NFT ownership calculation (shared)
    index.ts                # Barrel exports
  
  utils/                    # ✅ Utility functions
    format.ts               # Formatting helpers (address, time, numbers)
    index.ts                # Barrel exports
    sync.service.ts         # Blockchain sync logic
    
  types/                    # Centralized type definitions
    index.ts                # Re-export all types
    token.types.ts          # Token, NFT, Holder types
    block.types.ts
    api-response.types.ts   # API response DTOs

app/
  api/
    tokens/[address]/
      route.ts              # Thin controller (use services)
      
tools/
  sync.ts                   # Use shared services
  tokens.ts                 # Use shared services
```

### Remaining Work (Phase 3-5)

```
lib/
  db/repositories/          # TODO: Entity-specific repositories
    token.repository.ts     # Token-specific queries
    block.repository.ts
    transaction.repository.ts
    holder.repository.ts
  
  services/                 # TODO: Additional services
    token.service.ts        # Token data aggregation
    sync.service.ts         # Blockchain sync logic

app/
  api/
    tokens/[address]/
      route.ts              # ✅ Now uses NFT service
      
tools/
  tokens.ts                 # ✅ Uses shared ZERO_ADDR constant
```

1. **Single Source of Truth** ✅
   - One place for type definitions (`lib/types/index.ts`)
   - One place for business logic (e.g., `lib/services/nft.service.ts`)

2. **Repository Pattern** (Partial)
   - Base repository class created (`lib/db/base-repository.ts`)
   - Entity-specific repositories TODO

3. **Service Layer** ✅
   - Business logic separated from API routes and CLI tools
   - Both API and tools import from services

4. **Utility Functions** ✅
   - Centralized formatting (`lib/utils/format.ts`)
   - Address validation, time formatting, number formatting

### Usage Examples

**Import types:**
```typescript
import { Token, Transaction, Block, ZERO_ADDRESS } from '@/lib/types';
```

**Import NFT service:**
```typescript
import { getNftOwnershipFromDb, calculateNftOwnership } from '@/lib/services';
```

**Import utilities:**
```typescript
import { formatTokenBalance, timeAgo, shortenAddress } from '@/lib/utils';
```

### Migration Status

1. ✅ **Phase 1**: Created `lib/types/` with consolidated type definitions
2. ✅ **Phase 2**: Created `lib/db/` with connection manager and base repository
3. ✅ **Phase 3**: Created `lib/services/` with NFT service
4. ✅ **Phase 4**: Refactored Token API to use services
5. 🔄 **Phase 5**: Tools partially migrated (using shared constants)

### Benefits

- **Maintainability**: Changes in one place, not multiple files
- **Testability**: Services can be unit tested independently
- **Consistency**: Same logic produces same results everywhere
- **Type Safety**: Centralized types prevent mismatches

## 関連リポジトリ

VirBiCoin エコシステムは以下の6つのリポジトリで構成されています：

| リポジトリ | 役割 | ローカルパス | URL |
|-----------|------|-------------|-----|
| **virbicoin.com** | 公式Webサイト（メインサイト） | `../virbicoin.com` | [github.com/virbicoin/virbicoin.com](https://github.com/virbicoin/virbicoin.com) |
| **vbc-stats** | ネットワーク統計ダッシュボード | `../vbc-stats` | [github.com/virbicoin/vbc-stats](https://github.com/virbicoin/vbc-stats) |
| **vbc-explorer** ← 本リポジトリ | ブロックチェーンエクスプローラー | `../vbc-explorer` | [github.com/virbicoin/vbc-explorer](https://github.com/virbicoin/vbc-explorer) |
| **go-virbicoin** | メインクライアント（Gvbc, Go実装） | `../go-virbicoin` | [github.com/virbicoin/go-virbicoin](https://github.com/virbicoin/go-virbicoin) |
| **open-virbicoin-pool** | マイニングプール | `../open-virbicoin-pool` | [github.com/virbicoin/open-virbicoin-pool](https://github.com/virbicoin/open-virbicoin-pool) |
| **vbc-rpc** | RPCノードステータス & JSON-RPCプロキシ | `../vbc-rpc` | [github.com/virbicoin/vbc-rpc](https://github.com/virbicoin/vbc-rpc) |

### 依存関係

- **vbc-explorer** → **go-virbicoin**: JSON-RPC 経由でブロックチェーンデータを取得
- **vbc-stats** → **go-virbicoin**: Gvbc ノードが eth-netstats-client プロトコルでブロック/統計データを送信
- **open-virbicoin-pool** → **go-virbicoin**: マイニングプールが Gvbc ノードから作業を取得
- **vbc-rpc** → **go-virbicoin**: RPC プロキシが Gvbc ノードにリクエストを中継
