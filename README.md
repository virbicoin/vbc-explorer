<p align="center">
  <img src="public/img/explorer-logo.png" alt="VBC Explorer Logo" height="150">
</p>

<h1 align="center">VirBiCoin Explorer</h1>

<p align="center">
  <strong>Modern Real-time Blockchain Explorer for EVM-Compatible Networks</strong>
</p>

<p align="center">
  <a href="https://explorer.virbicoin.com">
    <img src="https://img.shields.io/badge/Explorer-explorer.virbicoin.com-cyan?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Explorer">
  </a>
  <a href="https://www.virbicoin.com">
    <img src="https://img.shields.io/badge/Website-virbicoin.com-green?style=for-the-badge&logo=ethereum&logoColor=white" alt="Website">
  </a>
  <a href="https://discord.virbicoin.com">
    <img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord">
  </a>
</p>

<p align="center">
  <a href="https://github.com/virbicoin/vbc-explorer/actions/workflows/lint.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/virbicoin/vbc-explorer/lint.yml?style=flat-square&label=CI" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Mongoose-9-47A248?style=flat-square&logo=mongodb&logoColor=white" alt="Mongoose">
  <img src="https://img.shields.io/badge/Node.js-22.18%2B%20%7C%2024.11%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/EIP--3091-Supported-brightgreen?style=flat-square" alt="EIP-3091">
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License: MIT">
  </a>
</p>

---

A modern, real-time blockchain explorer for any EVM-compatible network built with Next.js 16 App Router, TypeScript, and MongoDB. Features advanced NFT support, contract verification, comprehensive token analytics, built-in DEX, a cross-chain bridge, and Token Launchpad.

**This project is a fork of [ETC Explorer](https://github.com/ethereumclassic/explorer), enhanced with modern technologies and additional features.**

## ✨ Key Features

- **🔍 Advanced Search** - Search blocks, transactions, addresses, tokens, and contracts with intelligent filtering
- **💎 NFT Explorer** - Complete ERC-721 and ERC-1155 support with metadata, image galleries, and collection analytics
- **📊 Real-time Analytics** - Network statistics, gas price tracking, and blockchain performance metrics
- **⛽ Gas Tracker** - Real-time gas price tracking with slow/standard/fast/instant tiers
- **📈 Daily Statistics** - Historical transaction and block statistics with charts
- **🌐 Network Info** - Node version, client info, and network details
- **🛡️ Contract Verification** - Smart contract source code verification with Solidity compiler integration
- **📋 Contracts List** - Browse all verified and unverified contracts
- **⏳ Pending Transactions** - View pending transactions in mempool
- **💰 Token Management** - Comprehensive ERC-20, ERC-721, and ERC-1155 token tracking with holder analytics
- **📈 Rich List** - Real-time account balance tracking and wealth distribution analysis
- **📥 CSV Export** - Etherscan/BscScan-compatible transaction & token-transfer CSV downloads per address (tax-tool friendly)
- **🏷️ Address Name Tags** - Public labels for known addresses (DEX, Launchpad, Bridge, pools) with config-driven overrides
- **🔍 Decoded Input Data** - Transaction calldata decoded against verified contract ABIs (function signature + arguments)
- **🛂 Token Approval Checker** - Review and revoke ERC-20 allowances at `/approvals` (BscScan-style, wallet-connected revoke)
- **💸 Price Tracking** - Live price updates with priority fallback (CoinGecko → CoinMarketCap → Coinpaprika → WikaEx → DEX)
- **⚡ Real-time Sync** - Live blockchain synchronization with WebSocket support
- **📱 Responsive Design** - Mobile-first design optimized for all devices
- **🔗 EIP-3091 Support** - Direct URI redirection for ethereum: links
- **🔄 DEX (Swap)** - Decentralized token exchange with Uniswap V2 style AMM
- **💧 Liquidity Pools** - Provide liquidity and earn trading fees
- **🌾 Yield Farming** - Stake LP tokens to earn rewards
- **🌉 Cross-Chain Bridge** - Lock-and-mint bridge that moves the native coin 1:1 to a wrapped token on a remote chain
- **🎨 Token Launchpad V2** - No-code token creation with metadata, transfer, approve, burn, and pause features
- **⚙️ Dynamic Configuration** - All settings configurable via config.json for multi-chain support

## 💱 DEX Features

The explorer includes a built-in decentralized exchange (DEX) with the following features:

### Swap
- Token swapping with automatic price calculation
- Slippage tolerance configuration
- Price impact warnings
- Multi-hop routing support

### Liquidity Pools
- Add/remove liquidity for token pairs
- LP token management
- Real-time pool statistics
- Trading fee earnings (0.3%: 0.25% to LPs, 0.05% protocol)

### DEX API Integrations

#### GeckoTerminal Compatible (Full V2 API)
| Endpoint | Description |
|----------|-------------|
| `/api/dex/geckoterminal/networks` | Network/chain information |
| `/api/dex/geckoterminal/dexes` | DEX list |
| `/api/dex/geckoterminal/pools` | All pools with statistics |
| `/api/dex/geckoterminal/pool/[address]` | Single pool detail with tokens |
| `/api/dex/geckoterminal/token/[address]` | Token information |
| `/api/dex/geckoterminal/ohlcv/[pool]` | OHLCV candlestick data |
| `/api/dex/geckoterminal/trades/[pool]` | Recent trades/swaps |
| `/api/dex/geckoterminal/simple/price` | Batch token prices |
| `/api/dex/geckoterminal/trending_pools` | Trending pools by volume |
| `/api/dex/geckoterminal/new_pools` | Recently created pools |
| `/api/dex/geckoterminal/search/pools` | Search pools by query |
| `/api/dex/geckoterminal/info` | DEX metadata |

#### CoinMarketCap Compatible
- `/api/dex/cmc/summary`, `/api/dex/cmc/ticker`, `/api/dex/cmc/assets`

#### DefiLlama Compatible
- `/api/dex/defillama`, `/api/dex/defillama/tvl`, `/api/dex/defillama/pools`

#### Price Data
- `/api/dex/external-price` - WikaEx + DEX on-chain fallback

### Yield Farming
- Stake LP tokens to earn reward tokens
- Real-time APR calculation
- No lock-up period - withdraw anytime
- Harvest rewards at any time

### Contract Requirements

To enable DEX features, deploy and configure the following contracts:

| Contract | Description |
|----------|-------------|
| Factory | UniswapV2Factory for creating pairs |
| Router | UniswapV2Router02 for swapping |
| MasterChef | Farming rewards distribution |
| Reward Token | Token distributed as farming rewards |
| WETH/Wrapped Native | Wrapped native currency token |

Configure contract addresses in `config.json` under the `dex` section.

## 🎨 Token Launchpad

The explorer includes a Token Launchpad feature for creating and managing custom tokens:

### Create Tokens
- **No-Code Token Creation** - Create ERC-20 tokens without writing code
- **Custom Metadata** - Set logo URL, description, and website
- **External Image Support** - Use any HTTPS image URL for token logo
- **Draft Persistence** - Form inputs survive tab switches, so filled-in metadata is never silently lost
- **Configurable Supply** - Define total supply and decimals
- **Creation Fee** - Configurable fee per token creation

### Factory-Authenticated Registration (v0.8.7)

`POST /api/launchpad/register` accepts only `{ "tokenAddress": "0x..." }`. The server asks the configured TokenFactory contracts (`launchpad.factoryAddress` and `launchpad.legacyFactories`) whether they created the token — `isFactoryToken()`, or membership in `getAllTokens()` for legacy factories without it — and takes creator, name, symbol, decimals, supply, creation time and metadata from `tokenInfo()` and the token contract (`lib/launchpad/factory.ts`). Nothing from the request body is persisted. Addresses no factory knows get `404`; an already registered address returns `200` with the stored record; the creator's first holder row uses the real `balanceOf()`. `GET /api/launchpad/sync` is read-only (last sync time and result from `scan_progress`), `POST /api/launchpad/sync` runs an immediate import with a 60 s cooldown (`429`), and the periodic factory → `tokens` import runs inside `npm run tokens` (startup and hourly; `npm run tokens -- --sync-launchpad` for one shot). `npm run flag-spam-tokens -- --audit-launchpad` lists Launchpad-sourced tokens no factory knows and records `factoryVerified: false`; the token page shows a "Not factory-verified" badge for them.

### Security Features
- **HTTPS-Only Images** - Only secure HTTPS URLs allowed for token logos
- **XSS Protection** - Malicious URL patterns blocked (javascript:, data:, etc.)
- **SVG Sandboxing** - External SVG images rendered with CSP restrictions
- **Input Validation** - All token metadata validated before display

### Manage Your Tokens
- **📤 Transfer** - Send tokens to other addresses
- **✅ Approve** - Set allowances for DEX and smart contracts (with unlimited option)
- **🔥 Burn** - Permanently burn tokens to reduce supply
- **⏸️ Pause/Unpause** - Pause token transfers (owner only)
- **📝 Edit Metadata** - Update logo, description, and website after creation in a single transaction (owner only); tokens without a logo show a "No Logo" badge pointing here
- **🦊 MetaMask Integration** - One-click add tokens to MetaMask wallet

### Token Details Page
- **Overview** - Total supply, decimals, creator, and owner info
- **👥 Holders** - View all token holders with balance and percentage
- **📜 Transfers** - Complete transaction history with pagination

### Contract Requirements

Deploy a TokenFactory contract and configure the address in `config.json` under the `launchpad` section.

### Token Features
- Native `burn()` function for token burning
- `pause()` / `unpause()` functions for owner control
- On-chain metadata (logo URL, description, website)
- Ownable with ownership transfer support
- Full ERC-20 compatibility

## 🌉 Cross-Chain Bridge

The explorer includes an optional lock-and-mint bridge that moves the native coin between this chain and a remote EVM chain at a 1:1 ratio.

### How It Works

- **Deposit (native → wrapped)** - Lock the native coin in the vault contract on this chain; the relayer mints an equal amount of the wrapped token on the remote chain.
- **Withdraw (wrapped → native)** - Approve and burn the wrapped token on the remote chain; the relayer releases the locked native coin back on this chain.
- **Recipient override** - Send the bridged amount to any address, not just the connected wallet.
- The wrapped token is always backed 1:1 by the coins locked in the vault.

### Convert to Other Assets

When configured, the bridge can also deliver remote-chain assets (e.g. BNB or USDT) instead of just the wrapped token — both via a config-driven Uniswap-V2 router:

- **In-page Convert widget** - Swap already-bridged wrapped tokens into the configured outputs with live quotes, slippage presets and multi-hop routing (`route.remote.swap`).
- **One-transaction auto-convert** - A "Receive as" selector on the deposit form. The deposit goes through a lock-and-swap contract that records the desired output and a guaranteed minimum on-chain; the remote executor converts on arrival, falling back to the wrapped token if the minimum can't be met (`route.autoSwap.lockAndSwap`).

### Security

- Cross-chain mints and releases require **M-of-N validator signatures** (EIP-712), each validator independently re-verifying the source-chain event before signing.
- The off-chain relayer only relays; it cannot mint or release without a valid quorum of signatures.

### Contract Requirements

To enable the bridge, deploy and configure:

| Contract | Chain | Description |
|----------|-------|-------------|
| Vault | This chain | Locks/releases the native coin |
| Wrapped Token | Remote chain | BEP-20/ERC-20 minted against locked coins |
| Bridge | Remote chain | Mints on deposit, burns on withdraw, verifies signatures |

Set `bridge.enabled: true` and configure the `bridge` section in `config.json`. The Bridge navigation link and page appear only when the bridge is enabled. The bridge is defined as a list of routes so more assets/destinations can be added over time:

```jsonc
"bridge": {
  "enabled": true,
  "relayEtaSeconds": 180,
  "routes": [
    {
      "id": "native-bsc",
      "asset": { "kind": "native", "symbol": "TOKEN", "decimals": 18 },
      "vault": "0x…",                                  // lock vault on this chain
      "autoSwap": { "lockAndSwap": "0x…" },            // optional: one-tx auto-convert entry
      "remote": {
        "chainId": 56, "name": "BNB Smart Chain", "nativeSymbol": "BNB",
        "rpcUrl": "…", "explorer": "…",
        "bridge": "0x…", "wrappedToken": "0x…", "wrappedSymbol": "wTOKEN",
        "dexName": "PancakeSwap", "swapUrl": "…",       // optional: external DEX link
        "swap": {                                        // optional: in-page Convert widget
          "router": "0x…", "wrappedNative": "0x…",
          "outputs": [ { "symbol": "BNB", "kind": "native", "decimals": 18 } ]
        }
      }
    }
  ]
}
```

`asset.kind` is `native` or `erc20` (with a `token` address). The legacy single `vault` + `remote` shape (without `routes`) is still supported. See `config.example.json` for the full annotated template.

Deprecated or broken contracts can be hidden from the contracts list via `blacklist.contracts` (an array of `{ address, name, reason }`); their address pages remain reachable.

## 🚀 Multi-Chain Compatibility

This explorer is designed to work with any Ethereum-compatible blockchain. Easily configure it for different networks:

### Quick Setup for Other Chains

```bash
# Clone the repository
git clone https://github.com/virbicoin/vbc-explorer
cd vbc-explorer

# Install dependencies
npm install

# Copy and edit configuration
cp config.example.json config.json
# Edit config.json with your chain's settings

# Start the explorer
npm run dev
```

### Configuration Example

Edit `config.json` for your blockchain:

```json
{
  "nodeAddr": "localhost",
  "port": 8545,
  "currency": {
    "name": "Ethereum",
    "symbol": "ETH", 
    "unit": "wei",
    "gasUnit": "Gwei",
    "decimals": 18
  },
  "web3Provider": {
    "url": "http://localhost:8545"
  },
  "enableNFT": true,
  "enableContractVerification": true,
  "enableTokenTracking": true
}
```

### Supported Networks
- ✅ Your Chain (native support)
- ✅ Any EVM-compatible blockchain
- ✅ Custom gas units and currency symbols
- ✅ Configurable RPC endpoints
- ✅ Multi-chain token standards (ERC-20/721/1155)

## 📋 Core Features

### 🔍 **Advanced Explorer**
- **Real-time Blockchain Sync** - Live synchronization with WebSocket support
- **Block Explorer** - Detailed block information with transaction lists
- **Transaction Analytics** - Gas tracking, status monitoring, and transfer analysis
- **Address Analytics** - Balance history, transaction patterns, and token holdings

### 💎 **NFT & Token Support**
- **ERC-721 NFT Gallery** - Image galleries with metadata display and collection analytics
- **ERC-1155 Multi-Token** - Advanced multi-token standard support
- **ERC-20 Tracking** - Complete token analytics with holder distribution
- **Token Metadata** - Automatic metadata loading and IPFS support
- **Collection Statistics** - Floor prices, volumes, and trading analytics

### 🛡️ **Smart Contract Features**  
- **Contract Verification** - Solidity source code verification and publishing
- **Contract Interaction** - Direct smart contract interaction interface
- **Bytecode Analysis** - Contract bytecode inspection and analysis
- **ABI Support** - Automatic ABI detection and function calling

### 📊 **Analytics & Statistics**
- **Network Statistics** - Hashrate, difficulty, and network health metrics  
- **Rich List** - Real-time wealth distribution and account rankings
- **Price Tracking** - Multi-API price feeds with historical data
- **Gas Analytics** - Gas price tracking with unit customization (Gniku/niku)
- **Halving Countdown** - Live countdown to the next block reward reduction with era progress
- **Performance Metrics** - Transaction throughput and network performance

### 🔗 **Advanced Integration**
- **EIP-3091 URI Support** - ethereum: link handling for seamless wallet integration
- **REST API** - Complete API for external integrations
- **Multi-language Support** - Configurable currency units and symbols
- **Mobile Responsive** - Optimized experience across all devices

### 🔎 **SEO & Discoverability**
- **Per-entity metadata** - Server-rendered titles, descriptions and canonical URLs for every block, transaction, address and token, enriched off the render path with live data (token name/symbol, tx value, address balance)
- **Dynamic Open Graph images** - Branded 1200×630 link-preview cards generated per entity (`summary_large_image`)
- **Structured data (JSON-LD)** - BreadcrumbList on entity pages; WebSite (with a sitelinks search action) and Organization site-wide
- **Sitemap & robots.txt** - Generated `sitemap.xml` and `robots.txt`, custom `noindex` 404, and shareable `/search?q=` URLs
- **Config-driven & generic** - All names derive from `config.json`, so SEO works on any chain with no hardcoded coin names

## 🛠️ Tech Stack

### Frontend
- **Next.js 16+** - App Router with React Server Components
- **React 19+** - Latest React with Concurrent Features  
- **TypeScript 7+** - Native (Go-based) compiler with full type safety
- **Tailwind CSS v4+** - Utility-first styling with custom design system
- **Heroicons** - Beautiful SVG icon library

### Backend & API
- **Next.js API Routes** - Serverless API endpoints
- **Node.js 22.18+ / 24.11+** - Runtime environment (Node 24 LTS recommended, see `.nvmrc`; Node 20 reached end-of-life on 2026-04-30)
- **Web3.js v4+** - Ethereum blockchain interaction
- **MongoDB 8+** - Document database for scalable data storage
- **Mongoose 9+** - ODM for MongoDB with schema validation

### Development & Tooling
- **TypeScript** - Static type checking and IntelliSense
- **ESLint** - Code linting with custom rules
- **Prettier** - Automated code formatting  
- **Vitest** - Unit tests for pure logic plus MongoDB tests via mongodb-memory-server (`npm run test`)
- **tsx** - TypeScript execution for tools and scripts (ts-node replacement for TypeScript 7)

### Deployment & Production
- **Docker** - Containerized deployment
- **PM2** - Production process management
- **Next.js Build** - Optimized production builds

### Key Directories

- **`app/`** - Next.js App Router with page components and API routes
- **`lib/`** - Shared utilities, database connections, and configuration
- **`models/`** - MongoDB schemas and data models  
- **`tools/`** - Background services for blockchain synchronization
- **`public/`** - Static assets including images, CSS, and client libraries
    
## System Architecture

```mermaid
graph TB
    subgraph "Frontend Layer"
        A[Next.js App Router]
        B[React Components]
        C[TypeScript]
        D[Tailwind CSS]
    end
    
    subgraph "API Layer"
        E[Next.js API Routes]
        F[Data Fetching]
        G[Real-time Updates]
    end
    
    subgraph "Data Processing Layer"
        H[Sync Service]
        I[Stats Service]
        J[Price Service]
        K[Tokens Service]
        L[Richlist Service]
    end
    
    subgraph "Database Layer"
        M[MongoDB]
        N[Mongoose ODM]
        O[Data Models]
    end
    
    subgraph "Blockchain Layer"
        P[EVM Node]
        Q[Web3.js]
        R[RPC Connection]
    end
    
    subgraph "External Services"
        S[Price APIs]
        T[NFT Metadata]
        U[Contract Verification]
    end
    
    A --> E
    B --> E
    C --> E
    D --> A
    
    E --> F
    F --> G
    
    F --> H
    F --> I
    F --> J
    F --> K
    F --> L
    
    H --> N
    I --> N
    J --> N
    K --> N
    L --> N
    
    N --> M
    O --> N
    
    H --> Q
    I --> Q
    J --> Q
    K --> Q
    L --> Q
    
    Q --> R
    R --> P
    
    J --> S
    K --> T
    L --> U
    
    style A fill:#1e40af
    style B fill:#1e40af
    style C fill:#1e3a8a
    style D fill:#0ea5e9
    style M fill:#059669
    style P fill:#ea580c
```

## Data Flow Architecture

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Sync
    participant Database
    participant Blockchain
    
    User->>Frontend: Access Explorer
    Frontend->>API: Request Data
    API->>Database: Query Stored Data
    Database-->>API: Return Data
    API-->>Frontend: Send Response
    Frontend-->>User: Display Information
    
    loop Real-time Sync
        Sync->>Blockchain: Poll New Blocks
        Blockchain-->>Sync: Block Data
        Sync->>Database: Store Block Data
        Sync->>Database: Update Statistics
        Sync->>Database: Process Transactions
        Sync->>Database: Update Token Balances
        Sync->>Database: Update Rich List
    end
    
    loop Price Updates
        Sync->>External APIs: Fetch Price Data
        External APIs-->>Sync: Price Information
        Sync->>Database: Update Price Data
    end
```

## Project Structure

```
/
|-- app
|    |-- api
|    |   |-- address/         # Address info, transactions, tokens, mining
|    |   |-- block/           # Block details
|    |   |-- blocks/          # Block listing
|    |   |-- blockheight/     # Current block height
|    |   |-- circulating_supply/  # Circulating supply
|    |   |-- compile/         # Solidity compilation
|    |   |-- config/          # Client config API
|    |   |-- contract/        # Contract verification & interaction
|    |   |-- contracts/       # Contract listing
|    |   |-- dex/             # DEX APIs (core, CMC, DefiLlama, GeckoTerminal)
|    |   |-- launchpad/       # Token Launchpad APIs
|    |   |-- network/         # Network/node info
|    |   |-- realtime/        # Real-time data
|    |   |-- richlist/        # Rich list API
|    |   |-- search/          # Search APIs
|    |   |-- stats/           # Network statistics, gas, daily stats
|    |   |-- tokens/          # Token APIs
|    |   |-- total_supply/    # Total supply
|    |   |-- transactions/    # Transaction listing & pending
|    |   |-- tx/              # Transaction details
|    |   |-- v2/              # Blockscout v2 compatible APIs
|    |   |-- web3relay/       # Web3 RPC relay
|    |   |-- ws/              # WebSocket relay
|    |   |-- route.ts         # Etherscan-compatible API
|    |-- api-docs/            # API documentation page
|    |-- components/          # Page-specific components
|    |-- address/             # Address pages
|    |-- block/               # Block pages
|    |-- blocks/              # Blocks list page
|    |-- contract/            # Contract verification pages
|    |-- contracts/           # Contracts list page
|    |-- dex/                 # DEX pages (Swap, Pool, Farm, Analytics, Docs)
|    |-- ethereum/            # EIP-3091 redirect handler
|    |-- launchpad/           # Token Launchpad pages
|    |-- network/             # Network info page
|    |-- richlist/            # Rich list pages
|    |-- search/              # Search results page
|    |-- stats/               # Statistics page
|    |-- token/               # Token detail pages
|    |-- tokens/              # Tokens list page
|    |-- transactions/        # Transactions list page
|    |-- tx/                  # Transaction detail pages
|    |-- txs/                 # Pending transactions page
|    |-- page.tsx             # Homepage
|    |-- layout.tsx           # Root layout
|    |-- globals.css          # Global styles
|-- abi/                      # Smart contract ABIs
|-- components/               # Shared React components
|-- config/                   # Configuration files (farming.ts)
|-- hooks/                    # Custom React hooks
|-- lib/
|    |-- cache/               # In-memory caching
|    |-- db/                  # Database abstraction layer
|    |-- dex/                 # DEX utilities & cache service
|    |-- security/            # Input validation & rate limiting
|    |-- services/            # Business logic services
|    |-- types/               # TypeScript type definitions
|    |-- utils/               # Utility functions
|    |-- web3/                # Web3 singleton provider
|    |-- bigint-utils.ts      # BigInt utilities
|    |-- client-config.ts     # Client-side config
|    |-- config.ts            # Server-side config
|    |-- db.ts                # Database connection
|    |-- etherUnits.ts        # Unit conversion
|    |-- filters.ts           # Data filters
|    |-- launchpad-token-source.ts  # Launchpad token data
|    |-- models.ts            # Model interfaces
|    |-- price-service.ts     # Price data service
|    |-- stats.ts             # Statistics utilities
|    |-- supply.ts            # Supply calculation
|    |-- transaction-utils.ts # Transaction utilities
|-- models/
|    |-- index.ts             # Mongoose models
|-- tools/
|    |-- sync.ts              # Blockchain synchronization
|    |-- stats.ts             # Statistics calculation
|    |-- price.ts             # Price & DEX swap sync
|    |-- tokens.ts            # Token data sync (NFT/ERC20)
|    |-- richlist.ts          # Rich list generation
|    |-- register-contracts.ts  # Contract registration
|    |-- optimize-indexes.ts  # Create/check schema indexes (--dry-run, --check)
|    |-- repair-chain.ts      # Verify the stored chain / replace orphaned blocks (--check, --sample, --fix)
|    |-- flag-spam-tokens.ts  # Hide tokens and contracts whose names look like URLs (backfill)
|    |-- add-token.ts         # Manual token addition
|-- types/
|    |-- global.d.ts          # Global type declarations
|-- logs/                     # Log files
|-- public/
|    |-- img/                 # Static images
|-- .github/                  # GitHub workflows
|-- package.json
|-- ecosystem.config.json     # PM2 configuration
|-- config.json               # Main configuration (not in git)
|-- config.example.json       # Configuration template
|-- proxy.ts                  # Request proxy with security headers
|-- next.config.ts
|-- tsconfig.json
|-- tsconfig.tools.json       # TypeScript config for CLI tools
|-- eslint.config.mjs
|-- Dockerfile
|-- docker-compose.yml
|-- README.md
|-- CLAUDE.md                 # AI assistant guide
|-- SECURITY.md               # Security policy
|-- LICENSE
```

## Database Models

All models are defined once in `models/index.ts` (`lib/models.ts` only re-exports it). Collection names are explicit and match the production database: `Block`, `Transaction`, `Account`, `Contract`, `BlockStat`, `Market`, `DexSwap`, `VerificationJob`, `tokens`, `tokentransfers`, `tokenholders`, `scan_progress`.

### Block
Stores block information (real-time sync via tools/sync.ts):
- `number`: Block number (unique identifier)
- `hash`: Block hash (32-byte hex string)
- `parentHash`: Parent block hash
- `miner`: Miner address (20-byte address)
- `timestamp`: Block timestamp (Unix timestamp)
- `difficulty`: Block difficulty (BigInt as string)
- `gasUsed`: Gas used by all transactions in the block
- `gasLimit`: Maximum gas limit for the block
- `transactions`: Array of transaction hashes included in the block
- `size`: Block size in bytes
- `nonce`: Proof-of-work nonce

### Transaction
Stores transaction information (real-time sync via tools/sync.ts):
- `hash`: Transaction hash (unique identifier)
- `from`: Sender address (20-byte address)
- `to`: Recipient address (20-byte address, null for contract creation)
- `value`: Transaction value in wei (BigInt as string)
- `blockNumber`: Block number containing the transaction
- `transactionIndex`: Position within the block
- `gasUsed`: Actual gas used by the transaction
- `gasPrice`: Gas price in wei
- `timestamp`: Transaction timestamp (inherited from block)
- `status`: Transaction status (1 = success, 0 = failed)
- `contractAddress`: Created contract address (for contract creation txs)
- `input`: Transaction input data (hex string)

### BlockStat
Stores aggregated block statistics (updated via tools/stats.ts):
- `number`: Block number (reference to Block)
- `blockTime`: Time between this block and previous block (seconds)
- `difficulty`: Block difficulty (BigInt as string)
- `hashrate`: Estimated network hashrate at block time
- `txCount`: Number of transactions in the block
- `gasUsed`: Total gas used by the block
- `gasLimit`: Gas limit of the block
- `timestamp`: Block timestamp
- `miner`: Miner address
- `avgGasPrice`: Average gas price of transactions in block

### Account
Stores account balance information (updated via tools/richlist.ts):
- `address`: Account address (unique 20-byte address)
- `balance`: Account balance in wei (BigInt as string)
- `type`: Account type ('contract' | 'external')
- `blockNumber`: Last updated block number
- `txCount`: Total transaction count for this address
- `lastSeen`: Last transaction timestamp
- `firstSeen`: First transaction timestamp
- `isContract`: Boolean flag for contract accounts

### Token
Stores comprehensive token information (managed via tools/tokens.ts):
- `address`: Token contract address (unique identifier)
- `name`: Token name (e.g., "My Token")
- `symbol`: Token symbol (e.g., "MTK")
- `decimals`: Token decimals (typically 18 for ERC-20)
- `totalSupply`: Total token supply (BigInt as string)
- `type`: Token standard ('ERC-20' | 'ERC-721' | 'ERC-1155')
- `verified`: Contract verification status
- `metadata`: Additional token metadata (JSON object)
- `holders`: Number of token holders
- `transfers`: Total number of transfers
- `createdAt`: Token creation timestamp
- `updatedAt`: Last metadata update timestamp

### Contract
Stores verified contract information (via contract verification API):
- `address`: Contract address (unique identifier)
- `contractName`: Contract name from source code
- `compilerVersion`: Solidity compiler version used
- `optimization`: Compilation optimization settings
- `sourceCode`: Complete verified source code
- `abi`: Contract ABI (JSON array)
- `bytecode`: Contract bytecode (hex string)
- `verified`: Verification status and timestamp
- `verifiedAt`: Verification completion timestamp
- `verifier`: Address that submitted verification
- `constructorArgs`: Constructor arguments used during deployment

### Price
Stores native currency price data (updated via tools/price.ts):
- `timestamp`: Price timestamp
- `price`: Price in USD
- `volume24h`: 24-hour trading volume
- `marketCap`: Market capitalization
- `change24h`: 24-hour price change percentage
- `source`: Price data source (e.g., "coingecko", "coinmarketcap")
- `currency`: Price currency (typically "USD")

### Database Indexes

Indexes are declared on the Mongoose schemas in `models/index.ts` and created **explicitly**: `autoIndex` stays disabled, the Next.js app never touches indexes, and every data-writing tool (`sync` in all modes, `stats`, `richlist`, `tokens`, `price`, `rescan-contracts`, `register-contracts`, `add-token`) calls `ensureIndexes()` right after connecting. Existing indexes are never dropped, a unique index is skipped (and reported with the key and counts) when the collection holds duplicate keys, and a failure never stops the tool. Set `SKIP_INDEX_SYNC=1` to disable the startup check.

```bash
npm run optimize-indexes              # create every missing schema index (manual run)
npm run optimize-indexes -- --dry-run # show what would be created, change nothing
npm run optimize-indexes -- --check   # exit 1 when any schema index is missing
```

Every index is backed by a real query:

| Collection | Index | Used by |
|-----------|-------|---------|
| Block | `{ number: 1 }` unique | sync upsert and range sync, block pages, latest-block lookups |
| Block | `{ hash: 1 }` unique | block lookup by hash (v2 blocks API, transaction details) |
| Block | `{ miner: 1, number: -1 }` | mined blocks per address (address API, blockscout `getminedblocks`, search) |
| Block | `{ timestamp: -1 }` | daily block counts (`/api/stats/daily`), blockscout `getblocknobytime` |
| Transaction | `{ hash: 1 }` unique | transaction lookups; sync relies on the duplicate-key error for de-duplication |
| Transaction | `{ blockNumber: -1, transactionIndex: -1 }` | latest transactions, transactions of a block |
| Transaction | `{ from: 1, blockNumber: -1, transactionIndex: -1 }`, `{ to: 1, blockNumber: -1, transactionIndex: -1 }` | address transaction history (address API, v2, blockscout, CSV export) |
| Transaction | `{ creates: 1, blockNumber: -1 }` sparse | contract creation lookup (`/api/contract/status`, blockscout `getcontractcreation`) |
| Transaction | `{ timestamp: -1 }` | daily / 24h transaction counts (`/api/stats/daily`, v2 stats) |
| Account | `{ address: 1 }` unique, `{ balance: -1 }` | address pages, richlist |
| Contract | `{ address: 1 }` unique | contract pages, verification |
| BlockStat | `{ number: 1 }` unique | statistics upsert |
| Market | `{ timestamp: -1 }` | latest price |
| DexSwap | `{ hash: 1, pair: 1 }` unique, `{ pair: 1, timestamp: -1 }`, `{ pair: 1, blockNumber: -1 }`, `{ timestamp: -1 }` | swap sync, OHLCV / trades / 24h DEX stats |
| VerificationJob | `{ guid: 1 }` unique | verification status polling |
| tokens | `{ address: 1 }` unique | token pages, token sync upsert |
| tokentransfers | `{ tokenAddress: 1, timestamp: -1 }`, `{ from: 1, timestamp: -1 }`, `{ to: 1, timestamp: -1 }`, `{ transactionHash: 1 }`, `{ tokenAddress: 1, tokenId: 1, blockNumber: 1, to: 1 }` | token transfer history, address token transfers, transaction details, NFT sync upsert key |
| tokenholders | `{ tokenAddress: 1, holderAddress: 1 }` unique, `{ tokenAddress: 1, rank: 1 }`, `{ holderAddress: 1 }` | holder ranking, tokens held by an address, holder upsert |
| scan_progress | `{ scanType: 1 }` unique | token scan progress |

Rules for contributors: define models only in `models/index.ts` (no inline `mongoose.model()`), set `collection` explicitly to the real collection name, declare indexes in the schema, keep `autoIndex: false`, query addresses and hashes with lowercase equality instead of `$regex`, and never call `syncIndexes()` (it drops indexes that are not in the schema).

### Chain Integrity (Reorg Handling)

The block listener (`tools/sync.ts`) is reorg-aware (`lib/sync/`):

- Blocks are **upserted by `number`** and transactions **by `hash`** (`bulkWrite`); a transaction re-included in another block is moved, never dropped. `insertMany` with ignored duplicate-key errors is gone.
- Before a new block N is stored its `parentHash` is compared with the stored block N-1. On a mismatch the listener walks back to the last height where DB and node agree (at most `maxReorgDepth`, default 64) and replaces every height above it: the orphan's transactions and token transfers are deleted, the canonical block and transactions are upserted, the `BlockStat` of the height is dropped (stats recompute it) and the token scan is rewound. A reorg deeper than `maxReorgDepth` is logged and recorded in `scan_progress` (`reorg-pending`) for the repair tool.
- Every poll also re-verifies the last `confirmations` heights (default 12) against the node, so a reorg that happened between polls is caught too.
- The listener position is persisted in `scan_progress` (`sync`) and restored on restart.
- Configure in `config.json` (`"sync": { "confirmations": 12, "maxReorgDepth": 64 }`) or with `SYNC_CONFIRMATIONS` / `SYNC_MAX_REORG_DEPTH`.

Repair an existing database (orphaned blocks left by older versions):

```bash
npm run repair-chain -- --check            # gaps + parentHash mismatches, exit 1 when mismatches exist (~2 min for 3M blocks)
npm run repair-chain -- --sample 1000      # compare 1000 random heights with the node
npm run repair-chain -- --fix --dry-run    # list the heights / hashes that would be replaced
npm run repair-chain -- --fix              # replace orphans (resumable), then re-check; exit 0 only when 0 mismatches remain
```

After `--fix`: recompute statistics from the lowest replaced height with `RESCAN_FROM=<minReplaced> npm run stats` (the tool prints the command). The legacy form `RESCAN=<interval>:<range>` scans `range × interval` blocks back from the head, so the equivalent is `RESCAN=100:<ceil((head − minReplaced) / 100) + 10>`; the tool prints that too. The token scan re-indexes transfers automatically, and richlist balances come from the node (no action). Run it against the local node only; it issues about two RPC calls per replaced block. Back up `Block`, `Transaction` and `BlockStat` first.

## 🔒 Security

### Environment Variables

Secrets live in environment files in the project root, never in `config.json`, `ecosystem.config.json` or pm2's saved environment:

```bash
# Copy the example and fill in your values
cp .env.example .env

# Edit (DO NOT commit .env or .env.local)
vi .env
```

- `.env` is read first, `.env.local` overrides it, and a variable that is already set in the environment wins over both. Production uses `.env`.
- Next.js and the CLI tools read the same files: every `tools/*.ts` starts with `import '../lib/env'`, which loads them with `process.loadEnvFile()` before anything else runs. `pm2 start ecosystem.config.json` from the project root is enough; no `export`, no `--update-env`.
- `MONGODB_URI` is required and has no default: `connectDB()` stops with `MONGODB_URI is not set` instead of connecting to an unauthenticated `localhost` (`lib/db/uri.ts`).
- Percent-encode reserved characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `#` → `%23`).
- Only the host and database name of the URI are ever logged; credentials are not.

**Required environment variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string (a user with `readWrite` on the database) | `mongodb://explorer:<percent-encoded-password>@localhost:27017/explorerDB?authSource=explorerDB` |

**Optional environment variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `WEB3_PROVIDER_URL` | Web3 RPC endpoint | `http://localhost:8545` |
| `NODE_ENV` | Environment mode | `development` |
| `TRUSTED_IP_HEADER` | Header that carries the real client IP (set by nginx) | `X-Client-IP` |
| `SOLC_CACHE_DIR` | Directory of the sha256-verified Solidity compilers | `~/.cache/vbc-solc` |

### Using Environment Variables in config.json

You can reference environment variables in `config.json` using `${VAR_NAME}` syntax:

```json
{
  "database": {
    "uri": "${MONGODB_URI}"
  }
}
```

An unset variable resolves to an empty string with a warning. For `database.uri` an empty value is an error: the process stops with `MONGODB_URI is not set` rather than falling back to a default.

### Security Best Practices

1. **Never commit credentials** - Use `.env` / `.env.local` for sensitive values and keep them out of `config.json`, `ecosystem.config.json` and pm2's environment
2. **Configure CORS** - Restrict origins in production
3. **Enable rate limiting** - Protect API endpoints from abuse
4. **Use HTTPS** - Enable Strict-Transport-Security in production
5. **Regular audits** - Run `npm audit` periodically

### Rate Limiting and the Client IP

Limits are keyed on the **client IP taken from one trusted header only** (`TRUSTED_IP_HEADER`, default `X-Client-IP`), which the reverse proxy must set from Cloudflare's `CF-Connecting-IP` and overwrite on every request. `X-Forwarded-For` and `X-Real-IP` are never read, so a client cannot choose its bucket. Requests without a valid trusted IP share one `unknown` bucket with a tenth of the normal limit. Buckets live in `lib/security/rate-limits.ts`:

| Bucket | Limit | Routes |
|--------|-------|--------|
| `api` | 100/min | every read API |
| `verify` | 5/min | `/api/compile`, `/api/contract/verify`, v2 verification, Etherscan `verifysourcecode` (compiles queue in the solc worker, see below) |
| `write` | 10/min | `POST /api/launchpad/register`, `POST /api/launchpad/sync` (chain-authenticated writes) |
| `interact` | 30/min | `/api/contract/interact` |
| `tokenMetadata` | 10/min | `/api/tokens/[address]?tokenId=` (reads tokenURI, fetches metadata) |
| `launchpad` / `relay` / `contractWrite` | 30 / 60 / 10 per min | Launchpad reads, `/api/web3relay`, `POST /api/contract/[address]` |

Exceeding a limit returns `429` with `Retry-After`; every denial is logged and 20 denials from one IP within a minute produce one warning line (a seed for a crowdsec scenario). See [docs/nginx-explorer.conf.example](docs/nginx-explorer.conf.example) for the nginx side (header rewrite, optional `real_ip`, `limit_req` as a second line of defence).

### SSRF Protection (NFT metadata)

The only code that fetches a URL coming from the chain (`tokenURI`) is `safeFetchJson()` in `lib/security/safe-fetch.ts`: https only (`ipfs://` is rewritten to `images.ipfsGateway`, default `https://ipfs.io/ipfs/`), no IP-literal hosts, every DNS answer checked against private / link-local / loopback / CGNAT / multicast ranges (IPv4, IPv6, mapped forms), the socket pinned to the validated address, no redirects, `application/json` only, 256 KiB cap, 5 s timeout, every rejection logged with the contract address. `tokenURI` is only read for ERC-721 / ERC-1155 contracts (DB classification, ERC-165 when unknown) and the metadata is reduced to `name`, `description`, `image` and `attributes` with length caps. `next/image` only optimizes the explorer host, the IPFS gateway and `images.allowedHosts`; chain-derived images are rendered `unoptimized`.

### Hidden (spam) Tokens

Tokens and contracts whose name or symbol looks like a URL, contains control / zero-width / bidi characters or HTML, or is too long are flagged `hidden` when they are written (sync, token scan, Launchpad registration). Records whose address has no contract code at all (`eth_getCode` is empty: an externally owned account registered as a token by the old Launchpad API, a typo, a self-destructed contract) are hidden by the `--audit-code` pass with `hiddenReason: 'no-code'`, and new records are never created for such addresses (the scanner, the Launchpad sync and `POST /api/launchpad/register`, which answers `404 NO_CODE`, all check the code first). List APIs skip hidden entries, detail pages show a badge worded after the reason with the shortened address instead of the name, and names are always rendered through `components/DisplayName.tsx` (control characters removed, length capped, never linkified). Backfill or manage flags with:

```bash
npm run flag-spam-tokens -- --dry-run                 # list what would change
npm run flag-spam-tokens                              # classify every Contract and Token
npm run flag-spam-tokens -- --address 0x... --hide    # hide one address (reason: manual)
npm run flag-spam-tokens -- --address 0x... --unhide  # clear a flag
npm run flag-spam-tokens -- --unhide-all              # clear every flag
npm run flag-spam-tokens -- --audit-launchpad         # Launchpad-sourced tokens no factory knows → factoryVerified: false
npm run flag-spam-tokens -- --audit-code --dry-run    # addresses without contract code (eth_getCode); omit --dry-run to hide them
```

`--audit-code` never deletes anything and never hides an address that has token transfers in the database (a self-destructed contract looks the same to `eth_getCode`); those are listed as "needs review". Already hidden records keep their reason, and the automatic name pass never clears a `no-code` or `manual` flag.

### Solidity Compiler Isolation (v0.8.7)

Contract verification compiles in a `worker_threads` worker (`lib/contract/compile-worker.ts`, `lib/contract/solc-worker.cjs`), never on the request thread: one compile at a time (`compiler.concurrency`), at most five waiting (`compiler.maxQueue`, then `503` + `Retry-After`), a 60 s timeout (`compiler.timeoutMs`; the worker is terminated), a 1024 MB heap limit (`compiler.maxOldGenerationSizeMb`), 500 KB input and 20 MB output caps. Compilers come only from `lib/contract/compiler-cache.ts`: a release build is downloaded from `https://binaries.soliditylang.org/bin` (`list.json`: 15 s, 2 MB), its sha256 is compared with the one published in `list.json`, and only then is it stored as `<cacheDir>/<version>.js` next to `<version>.sha256` (default `~/.cache/vbc-solc`; `compiler.cacheDir` or `SOLC_CACHE_DIR`). The hash is checked again on every read. Nightly builds, versions outside `releases` and versions outside the optional `compiler.allowedVersions` list are refused; `solc.loadRemoteVersion` is not used anywhere. Every compile logs version, duration and result. `/api/compile` only looks up stored verification data (it never compiled). Settings live in the `compiler` section of `config.json` (see `config.example.json`).

### Pagination Limits (v0.8.7)

Every route that accepts `limit` / `page` (including DataTables `start` / `length` on `/api/richlist`) goes through `validatePagination()` in `lib/security/validation.ts`: `limit` is clamped to the route's maximum (100 for lists, 300 for GeckoTerminal trades, 1000 for OHLCV), a `page` below 1 or non-numeric becomes 1, and `page × limit` above 100,000 (`DEFAULT_MAX_OFFSET`) is refused with `400`, because such skips scan the collection even with indexes.

### Public RPC Method Filter (nginx njs)

The public JSON-RPC hostnames are fronted by nginx. [docs/njs/rpc-filter.js](docs/njs/rpc-filter.js) inspects every POST body (single call or batch) and answers `403` with a JSON-RPC error for methods starting with `trace_`, `parity_`, `debug_`, `personal_`, `admin_` or `miner_`, `400` for non-JSON bodies or non-string methods and `413` for bodies above the buffer; everything else is forwarded unchanged to the node. [docs/nginx-rpc.conf.example](docs/nginx-rpc.conf.example) shows the vhost wiring (`js_import`, `/_rpc_post`, `/_rpc`, `limit_req`); the node's own `--jsonrpc-apis` is not changed. The classifier is unit-tested in `tests/ops/rpc-filter.test.ts`.

### Security Features (v0.8.7)

- ✅ **Factory-authenticated Launchpad** - registration accepts only tokens the TokenFactory contracts vouch for; creator and metadata come from the chain
- ✅ **Compiler isolation** - solc runs in a worker thread with timeout and heap limits, from a sha256-verified local cache (no nightly builds)
- ✅ **Pagination caps** - every `limit` / `page` clamped by `validatePagination()`; deep pages refused

- ✅ **Input Validation** - All addresses, hashes, and pagination parameters validated
- ✅ **Rate Limiting** - Token bucket per client IP from the proxy-set `X-Client-IP` header only; per-purpose buckets, `429` + `Retry-After`
- ✅ **SSRF-safe metadata fetch** - tokenURI metadata only through `safeFetchJson()` (https, public addresses, no redirects, size/content-type limits)
- ✅ **Spam-name hiding** - URL-like / control-character names flagged `hidden`, excluded from lists, rendered safely
- ✅ **Reorg-aware sync** - orphaned blocks are replaced, transactions upserted by hash; `repair-chain` verifies the stored chain
- ✅ **Security Headers** - X-Content-Type-Options, X-Frame-Options, X-XSS-Protection
- ✅ **ReDoS Protection** - Safe RegExp patterns with input sanitization
- ✅ **Method Whitelist** - Contract interaction limited to read-only methods
- ✅ **Content-Type Validation** - API endpoints validate request content types

For detailed security information, see [SECURITY.md](SECURITY.md).

## Quick Start with PM2 (Recommended)

### Prerequisites

- **Node.js 22.18+ or 24.11+** (Node 24 LTS recommended, see `.nvmrc`) and npm 10+
- **MongoDB 6.0+** (8.0 recommended) running on localhost:27017 with authentication enabled (see [Database Setup](#database-setup))
- **EVM Node** running with RPC enabled (e.g., localhost:8545)
- **PM2** installed globally: `npm install -g pm2`

### Installation

1. **Clone and setup**
```bash
git clone https://github.com/virbicoin/vbc-explorer
cd vbc-explorer
npm install
```

2. **Configure environment**
```bash
# Credentials: MONGODB_URI (required) and other secrets. Read by Next.js and by the tools.
cp .env.example .env
vi .env

# Chain, DEX, Launchpad and compiler settings (keep "uri": "${MONGODB_URI}")
cp config.example.json config.json
vi config.json
```

3. **Start all services with PM2**
```bash
# Start all services (Web + Data sync) from the project root: the processes read .env themselves
pm2 start ecosystem.config.json

# Check status
pm2 status

# View logs
pm2 logs
```

Indexes are created automatically the first time the sync tools start (`Block.number` and `Block.hash` take a few minutes on a large chain). To create or verify them by hand:

```bash
npm run optimize-indexes            # create missing indexes
npm run optimize-indexes -- --check # exit 0 when every index exists
```

4. **Access the explorer**
```
http://localhost:3000
```

### PM2 Management Commands

```bash
# Start all services
pm2 start ecosystem.config.json

# Stop all services
pm2 stop ecosystem.config.json

# Restart all services
pm2 restart ecosystem.config.json

# View status
pm2 status

# View logs
pm2 logs                    # All logs
pm2 logs explorer           # Web service only
pm2 logs sync               # Sync service only

# Monitor resources
pm2 monit

# Delete all services
pm2 delete ecosystem.config.json

# Setup auto-restart (production)
pm2 startup
pm2 save
```

Credentials are not part of `ecosystem.config.json` and must not be added to pm2's environment: every app reads `.env` from the project root on start. `pm2 restart <app> --update-env` is never needed for `MONGODB_URI`; after changing `.env`, `pm2 restart <app>` is enough.

### Individual Service Management

```bash
# Start specific services only
pm2 start ecosystem.config.json --only explorer
pm2 start ecosystem.config.json --only sync
pm2 start ecosystem.config.json --only stats

# Restart specific service
pm2 restart explorer
pm2 restart sync
pm2 restart stats
```

## Local Installation (Development)

### Prerequisites

- **Node.js 22.18+ or 24.11+** (Node 24 LTS recommended, see `.nvmrc`) and npm 10+
- **MongoDB 6.0+** with authentication enabled
- **EVM Node** running with RPC enabled (e.g., localhost:8545)
- **Minimum 4GB RAM** and **20GB storage** for full blockchain data

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd explorer
```

2. **Install dependencies**
```bash
npm install
```

3. **Create the database user** (MongoDB with `security.authorization: enabled`, see [Database Setup](#database-setup))
```bash
# As the MongoDB administrator; mongosh prompts for the passwords, nothing is typed on the command line
mongosh -u admin --authenticationDatabase admin
use explorerDB
db.createUser({
  user: "explorer",
  pwd: passwordPrompt(),
  roles: [{ role: "readWrite", db: "explorerDB" }]
})
exit
```
Then put the connection string into `.env`: `MONGODB_URI=mongodb://explorer:<percent-encoded-password>@localhost:27017/explorerDB?authSource=explorerDB`.

4. **Set up configuration**
```bash
# Copy and customize configuration
cp config.example.json config.json
# Edit config.json for your blockchain node settings
```

5. **Create database indexes** (optional: the sync tools do this on startup)
```bash
npm run optimize-indexes            # create the indexes defined in models/index.ts
npm run optimize-indexes -- --check # verify (exit 1 if any index is missing)
```

6. **Start EVM node** (ensure RPC is enabled)
```bash
# Verify node is running and accessible
curl -X POST -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     http://localhost:8545
```

7. **Start the development server**
```bash
npm run dev
```

8. **Initialize blockchain data** (in a separate terminal)
```bash
# Start all data synchronization services
npm run all

# Or start services individually
npm run sync    # Blockchain synchronization
npm run stats   # Network statistics
npm run richlist # Account richlist
npm run tokens  # Token tracking
npm run price   # Price tracking
```

The explorer will be available at `http://localhost:3000`

### Alternative: Docker Setup

```bash
# Start with Docker Compose
docker-compose up -d

# The explorer will be available at http://localhost:3000
# MongoDB will be accessible on localhost:27017
```

## Data Management Tools

### PM2 Management

```bash
# Start all services
pm2 start ecosystem.config.json

# Start individual services
pm2 start ecosystem.config.json --only sync     # Blockchain sync only
pm2 start ecosystem.config.json --only stats    # Statistics calculation only
pm2 start ecosystem.config.json --only richlist # Richlist calculation only
pm2 start ecosystem.config.json --only tokens   # Token tracking only
pm2 start ecosystem.config.json --only price    # Price monitoring only
pm2 start ecosystem.config.json --only explorer # Web application only

# Stop services
pm2 stop all
pm2 stop sync

# Restart services
pm2 restart all
pm2 restart sync

# Check service status
pm2 status

# View logs
pm2 logs sync
pm2 logs stats
pm2 logs richlist
pm2 logs tokens
pm2 logs price
pm2 logs explorer

# Monitor processes
pm2 monit

# Delete services
pm2 delete all
pm2 delete sync

# Perform initial sync
SYNCALL=true pm2 start ecosystem.config.json --only sync

# Rescan statistics
RESCAN=100:10000 pm2 start ecosystem.config.json --only stats
```

### NPM Script Usage

```bash
# Data service management
npm run all          # Start all services
npm run sync         # Blockchain synchronization
npm run stats        # Network statistics
npm run richlist     # Rich list calculation
npm run tokens       # Token and NFT tracking
npm run price        # Price monitoring

# Database indexes (defined in models/index.ts, created automatically by the tools above)
npm run optimize-indexes              # Create missing indexes
npm run optimize-indexes -- --dry-run # Show what would be created
npm run optimize-indexes -- --check   # Exit 1 if any index is missing

# Chain integrity and spam tokens
npm run repair-chain -- --check       # Verify parentHash links (exit 1 on mismatches)
npm run repair-chain -- --fix         # Replace orphaned blocks with the node's canonical blocks
npm run flag-spam-tokens -- --dry-run # Classify token/contract names (URL-like names are hidden)
npm run flag-spam-tokens -- --audit-launchpad # Launchpad tokens no factory knows → factoryVerified: false
npm run flag-spam-tokens -- --audit-code      # Hide token/contract records whose address has no code

# PM2 management
npm run pm2:start
npm run pm2:stop
npm run pm2:restart
npm run pm2:status
npm run pm2:logs
npm run pm2:monitor

# Development
npm run dev
npm run build
npm run lint
npm run lint:fix
npm run type-check
```

### Direct Execution

```bash
# Blockchain synchronization
npx tsx --tsconfig tsconfig.tools.json tools/sync.ts sync

# Statistics calculation
npx tsx --tsconfig tsconfig.tools.json tools/sync.ts stats

# Richlist calculation
npx tsx --tsconfig tsconfig.tools.json tools/sync.ts richlist

# Token tracking
npx tsx --tsconfig tsconfig.tools.json tools/sync.ts tokens

# Price tracking
npx tsx --tsconfig tsconfig.tools.json tools/price.ts

# Database indexes
npx tsx --tsconfig tsconfig.tools.json tools/optimize-indexes.ts --check

# Chain integrity / spam tokens
npx tsx --tsconfig tsconfig.tools.json tools/repair-chain.ts --check
npx tsx --tsconfig tsconfig.tools.json tools/flag-spam-tokens.ts --dry-run

# Environment variable configuration
RESCAN=100:10000 npx tsx --tsconfig tsconfig.tools.json tools/sync.ts stats  # Statistics rescan
SYNCALL=true npx tsx --tsconfig tsconfig.tools.json tools/sync.ts sync       # Full block sync
```

## Configuration

### Configuration (config.json)

All configuration is now centralized in `config.json`. The following settings are available:

### Application Configuration (config.json)

```json
{
  "nodeAddr": "localhost",
  "port": 8545,
  "wsPort": 8546,
  "bulkSize": 50,
  "syncAll": true,
  "quiet": false,
  "useRichList": true,
  "startBlock": 0,
  "endBlock": null,
  "maxRetries": 3,
  "retryDelay": 1000,
  "logLevel": "info",
  "enableNFT": true,
  "enableContractVerification": true,
  "enableTokenTracking": true,
  "apiRateLimit": 100,
  "webSocketEnabled": true,
  "currency": {
    "name": "Ethereum",
    "symbol": "ETH",
    "unit": "wei",
    "gasUnit": "Gwei",
    "decimals": 18,
    "priceApi": {
      "coingecko": {
        "enabled": true,
        "id": "ethereum"
      },
      "cmc": {
        "enabled": false,
        "id": "ethereum"
      },
      "coinpaprika": {
        "enabled": true,
        "id": "eth-ethereum"
      },
      "wikaex": {
        "enabled": true,
        "symbol": "ETH"
      }
    }
  },
  "web3Provider": {
    "url": "http://localhost:8545"
  },
  "miners": {
    "0x0000000000000000000000000000000000000000": "Unknown",
    "0x1111111111111111111111111111111111111111": "Example Pool"
  },
  "features": {
    "nft": {
      "enabled": true,
      "metadataProviders": ["ipfs", "http"],
      "imageFallback": true,
      "cacheEnabled": true
    },
    "contractVerification": {
      "enabled": true,
      "compilerVersions": ["0.8.30", "0.8.29", "0.8.28", "0.8.27", "0.8.26", "0.8.25", "0.8.24", "0.8.23", "0.8.22", "0.8.21", "0.8.20", "0.8.19", "0.8.18", "0.8.17", "0.8.16", "0.8.15", "0.8.14", "0.8.13", "0.8.12", "0.8.11", "0.8.10", "0.8.9", "0.8.8", "0.8.7", "0.8.6", "0.8.5", "0.8.4", "0.8.3", "0.8.2", "0.8.1", "0.8.0"],
      "optimizationEnabled": true,
      "maxSourceSize": 50000
    },
    "richlist": {
      "enabled": true,
      "updateInterval": 3600,
      "minBalance": "1000000000000000000"
    },
    "statistics": {
      "enabled": true,
      "updateInterval": 300,
      "blockRange": 100
    }
  },
  "api": {
    "rateLimit": {
      "windowMs": 900000,
      "max": 100
    },
    "cors": {
      "origin": ["https://your-explorer-domain.com", "http://localhost:3000"],
      "credentials": true
    }
  },
  "database": {
    "uri": "${MONGODB_URI}",
    "options": {
      "maxPoolSize": 20,
      "serverSelectionTimeoutMS": 15000,
      "socketTimeoutMS": 60000,
      "connectTimeoutMS": 15000,
      "bufferCommands": false,
      "autoIndex": false,
      "autoCreate": false
    }
  },
  "compiler": {
    "cacheDir": "~/.cache/vbc-solc",
    "concurrency": 1,
    "maxQueue": 5,
    "timeoutMs": 60000,
    "maxOldGenerationSizeMb": 1024,
    "allowedVersions": null
  },
  "logging": {
    "level": "info",
    "file": {
      "enabled": true,
      "maxSize": "10m",
      "maxFiles": 5
    },
    "console": {
      "enabled": true,
      "colorize": true
    }
  },
  "explorer": {
    "name": "Blockchain Explorer",
    "description": "Real-time blockchain explorer",
    "version": "0.6.0",
    "url": "https://your-explorer-domain.com",
    "apiUrl": "https://your-explorer-domain.com/api"
  }
}
```

## Database Setup

### MongoDB Authentication (Required in Production)

Production runs MongoDB with `security.authorization: enabled`. The application connects as a user with `readWrite` on `explorerDB` (the `MONGODB_URI` in `.env`); administrative work (user management, `serverStatus`, profiling) is done with a separate admin account whose password stays with the server administrator and is never stored in the repository, in `config.json` or in pm2.

1. **Create the admin user** (before enabling authorization; `passwordPrompt()` asks for the password instead of putting it on the command line or in the shell history)
```bash
mongosh
> use admin
> db.createUser({
    user: "admin",
    pwd: passwordPrompt(),
    roles: ["userAdminAnyDatabase", "backup", "clusterMonitor"]
  })
```

2. **Create the application user**
```bash
> use explorerDB
> db.createUser({ user: "explorer", pwd: passwordPrompt(), roles: [{ role: "readWrite", db: "explorerDB" }] })
```
`readWrite` is enough for the explorer, the sync tools, `mongodump` and `mongorestore`. It cannot run the `profile` command (`db.getProfilingStatus()`), so profiling and `serverStatus` are checked with the admin user.

3. **Enable authentication**
```yaml
# /etc/mongod.conf
security:
  authorization: enabled
```
Then `systemctl restart mongod` (a short outage: stop the writers first with `pm2 stop sync stats richlist tokens price`).

4. **Put the URI into `.env`** (percent-encode the password) and restart the pm2 apps from the project root. `config.json` keeps `"uri": "${MONGODB_URI}"`.
```bash
MONGODB_URI=mongodb://explorer:<percent-encoded-password>@localhost:27017/explorerDB?authSource=explorerDB
```

### Running mongosh with the Application Credentials

Load `.env` into the shell and let mongosh connect from the variable, so the password never appears on the command line or in `ps`:
```bash
set -a; . ./.env; set +a
mongosh --nodb --quiet --eval 'const db = connect(process.env.MONGODB_URI); printjson(db.runCommand({ ping: 1 }))'
```

### Backup and Restore

`mongodump` and `mongorestore` read the URI from a config file, so it is not visible in the process list (`--uri mongodb://user:password@...` on the command line would be). The application user is sufficient for both.
```bash
# Backup (as the deploy user; the YAML holds a single line: uri: mongodb://...)
umask 077
printf 'uri: %s\n' "$(sed -n 's/^MONGODB_URI=//p' .env)" > /tmp/md.yaml
mongodump --config /tmp/md.yaml --gzip --out "$HOME/backup/explorerDB-$(date +%F)"
rm -f /tmp/md.yaml

# Restore (stop the writers first: pm2 stop sync stats tokens)
umask 077
printf 'uri: %s\n' "$(sed -n 's/^MONGODB_URI=//p' .env)" > /tmp/md.yaml
mongorestore --config /tmp/md.yaml --gzip --drop "$HOME/backup/explorerDB-<date>/explorerDB"
rm -f /tmp/md.yaml
npm run optimize-indexes -- --check   # the dump carries the indexes; verify they are all there
pm2 start sync stats tokens
```

## Running the Application

### Development Mode

```bash
# Start the development server
npm run dev

# Start data services (in separate terminals or background)
npm run all          # Start all services
npm run sync         # Blockchain synchronization
npm run stats        # Network statistics calculation  
npm run richlist     # Rich list calculation
npm run tokens       # Token and NFT tracking
npm run price        # Price monitoring
```

### Production Mode with PM2

```bash
# Build and start with PM2
npm run build
pm2 start ecosystem.config.json

# Check status
pm2 status

# View logs
pm2 logs

# Monitor resources
pm2 monit
```

### Docker Deployment

```bash
# Build and run with Docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## API Endpoints

### Blockscout/Etherscan Compatible API

The explorer provides a Blockscout/Etherscan compatible API endpoint at `/api`. All requests use query parameters in the format `?module=<module>&action=<action>&...params`.

**Base URL:** `https://your-explorer.com/api`

**Response Format:**
```json
{
  "status": "1",       // "1" for success, "0" for error
  "message": "OK",     // Status message
  "result": "..."      // Response data
}
```

#### Account Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `balance` | Get address balance (wei) | `address` |
| `balancemulti` | Get multiple balances (max 20) | `address` (comma separated) |
| `txlist` | Get transaction list | `address`, `page`, `offset`, `sort` |
| `txlistinternal` | Get internal transactions | `address` or `txhash`, `page`, `offset` |
| `tokentx` | Get token transfers | `address`, `contractaddress`, `page`, `offset` |
| `tokenbalance` | Get specific token balance | `address`, `contractaddress` |
| `getminedblocks` | Get blocks mined by address | `address`, `page`, `offset` |

**Examples:**
```bash
# Get balance
curl "https://explorer.example.com/api?module=account&action=balance&address=0x950302976387b43e042aea242ae8dab8e5c204d1"

# Get multiple balances
curl "https://explorer.example.com/api?module=account&action=balancemulti&address=0xaddr1,0xaddr2,0xaddr3"

# Get transaction list
curl "https://explorer.example.com/api?module=account&action=txlist&address=0x...&page=1&offset=10&sort=desc"

# Get token balance for specific token
curl "https://explorer.example.com/api?module=account&action=tokenbalance&address=0x...&contractaddress=0x..."

# Get mined blocks
curl "https://explorer.example.com/api?module=account&action=getminedblocks&address=0x..."
```

#### Block Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `getblockreward` | Get block reward info | `blockno` |
| `getblocknobytime` | Get block by timestamp | `timestamp`, `closest` (before/after) |

**Examples:**
```bash
# Get block reward
curl "https://explorer.example.com/api?module=block&action=getblockreward&blockno=1234567"

# Get block by timestamp
curl "https://explorer.example.com/api?module=block&action=getblocknobytime&timestamp=1609459200&closest=before"
```

#### Transaction Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `gettxinfo` | Get transaction details | `txhash` |
| `gettxreceiptstatus` | Get transaction status | `txhash` |

**Examples:**
```bash
# Get transaction info
curl "https://explorer.example.com/api?module=transaction&action=gettxinfo&txhash=0x..."

# Get transaction status
curl "https://explorer.example.com/api?module=transaction&action=gettxreceiptstatus&txhash=0x..."
```

#### Token Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `gettoken` / `tokeninfo` | Get token information | `contractaddress` |
| `gettokenholders` | Get token holders list | `contractaddress`, `page`, `offset` |
| `tokenlist` | Get all tokens list | `page`, `offset` |

**Examples:**
```bash
# Get token info
curl "https://explorer.example.com/api?module=token&action=gettoken&contractaddress=0x..."

# Get token holders
curl "https://explorer.example.com/api?module=token&action=gettokenholders&contractaddress=0x...&page=1&offset=10"

# Get all tokens
curl "https://explorer.example.com/api?module=token&action=tokenlist&page=1&offset=100"
```

#### Stats Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `ethsupply` / `coinsupply` | Get total coin supply (wei) | - |
| `tokensupply` | Get token total supply | `contractaddress` |
| `ethprice` / `coinprice` | Get coin price (placeholder) | - |
| `chainsize` | Get chain size statistics | - |
| `dailytx` | Get daily transaction count | `startdate`, `enddate`, `sort` |

**Examples:**
```bash
# Get native coin supply
curl "https://explorer.example.com/api?module=stats&action=ethsupply"

# Get token supply
curl "https://explorer.example.com/api?module=stats&action=tokensupply&contractaddress=0x..."

# Get chain size
curl "https://explorer.example.com/api?module=stats&action=chainsize"

# Get daily transactions (last 30 days)
curl "https://explorer.example.com/api?module=stats&action=dailytx&startdate=2025-01-01&enddate=2025-01-31"
```

#### Contract Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `getabi` | Get contract ABI | `address` |
| `getsourcecode` | Get contract source code | `address` |
| `getcontractcreation` | Get contract creation info | `contractaddresses` (max 5, comma separated) |
| `verifysourcecode` | Submit contract for verification | See below |
| `checkverifystatus` | Check verification status | `guid` |

**Examples:**
```bash
# Get contract ABI (verified contracts only)
curl "https://explorer.example.com/api?module=contract&action=getabi&address=0x..."

# Get contract source code
curl "https://explorer.example.com/api?module=contract&action=getsourcecode&address=0x..."

# Get contract creation info
curl "https://explorer.example.com/api?module=contract&action=getcontractcreation&contractaddresses=0x...,0x..."

# Submit contract for verification (form-urlencoded)
curl -X POST "https://explorer.example.com/api" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "module=contract&action=verifysourcecode&contractaddress=0x...&sourceCode=...&contractname=MyContract&compilerversion=v0.8.30%2Bcommit.73712a01&optimizationUsed=1&runs=200"

# Submit contract for verification (JSON body)
curl -X POST "https://explorer.example.com/api?module=contract&action=verifysourcecode" \
  -H "Content-Type: application/json" \
  -d '{
    "contractaddress": "0x...",
    "sourceCode": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\n...",
    "contractname": "MyContract",
    "compilerversion": "v0.8.30+commit.73712a01",
    "optimizationUsed": "1",
    "runs": "200",
    "evmversion": "paris"
  }'

# Check verification status
curl "https://explorer.example.com/api?module=contract&action=checkverifystatus&guid=<guid>"
```

**Verification Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `contractaddress` | Yes | Contract address to verify |
| `sourceCode` | Yes | Solidity source code |
| `contractname` | Yes | Contract name |
| `compilerversion` | Yes | Compiler version (e.g., `v0.8.30+commit.73712a01`) |
| `optimizationUsed` | No | `1` for enabled, `0` for disabled (default: `0`) |
| `runs` | No | Optimization runs (default: `200`) |
| `evmversion` | No | EVM version (default: `paris`) |
| `constructorArguements` | No | ABI-encoded constructor arguments |
| `licenseType` | No | SPDX license identifier |

**Supported Compiler Versions:**
- 0.8.15 - 0.8.33
- 0.6.12 (legacy support)

#### Logs Module

| Action | Description | Parameters |
|--------|-------------|------------|
| `getLogs` | Get event logs | `address`, `fromBlock`, `toBlock`, `topic0-3`, `page`, `offset` |

**Examples:**
```bash
# Get logs for contract
curl "https://explorer.example.com/api?module=logs&action=getLogs&address=0x...&fromBlock=0&toBlock=latest"

# Get logs with topic filter
curl "https://explorer.example.com/api?module=logs&action=getLogs&address=0x...&topic0=0xddf252..."
```

#### Proxy Module (JSON-RPC)

| Action | Description | Parameters |
|--------|-------------|------------|
| `eth_blockNumber` | Get current block number (hex) | - |
| `eth_getBlockByNumber` | Get block by number | `tag`, `boolean` |
| `eth_getTransactionByHash` | Get transaction by hash | `txhash` |
| `eth_getTransactionReceipt` | Get transaction receipt | `txhash` |
| `eth_call` | Execute contract call | `to`, `data`, `tag` |
| `eth_getCode` | Get contract bytecode | `address`, `tag` |
| `eth_gasPrice` | Get current gas price (hex) | - |
| `eth_estimateGas` | Estimate gas for transaction | `to`, `data`, `value`, `from` |

**Examples:**
```bash
# Get current block number
curl "https://explorer.example.com/api?module=proxy&action=eth_blockNumber"

# Get block by number
curl "https://explorer.example.com/api?module=proxy&action=eth_getBlockByNumber&tag=latest&boolean=true"

# Get transaction by hash
curl "https://explorer.example.com/api?module=proxy&action=eth_getTransactionByHash&txhash=0x..."

# Get transaction receipt
curl "https://explorer.example.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=0x..."

# Execute contract call
curl "https://explorer.example.com/api?module=proxy&action=eth_call&to=0x...&data=0x..."

# Get contract code
curl "https://explorer.example.com/api?module=proxy&action=eth_getCode&address=0x..."

# Get gas price
curl "https://explorer.example.com/api?module=proxy&action=eth_gasPrice"

# Estimate gas
curl "https://explorer.example.com/api?module=proxy&action=eth_estimateGas&to=0x...&value=0x0"
```

### Supply APIs (CoinGecko / CoinMarketCap Compatible)

These endpoints return plain text numbers only, as required by CoinGecko and CoinMarketCap.

#### Total Supply
```
GET /api/total_supply
```
Returns the total supply of VBC as a plain text number.

**Response:** `354921680` (plain text, no JSON)

**Calculation:** `(Block Height × Block Reward) + Pre-mine Amount`

**Debug Mode:** Add `?debug=true` to get detailed JSON response:
```json
{
  "blockNumber": "3115210",
  "blockReward": 8,
  "premineAmount": 330000000,
  "totalSupply": 354921680,
  "circulatingSupply": 354921679.5,
  "excludedAddresses": [
    {
      "address": "0x0000000000000000000000000000000000000000",
      "label": "Burn Address",
      "balance": "0.5"
    }
  ]
}
```

#### Circulating Supply
```
GET /api/circulating_supply
```
Returns the circulating supply of VBC as a plain text number.

**Response:** `354921679` (plain text, no JSON)

**Calculation:** `Total Supply - (Sum of Excluded Wallet Balances)`

**Excluded Addresses:** Configured in `config.json` under `supply.excludedAddresses`

#### Configuration (config.json)
```json
{
  "supply": {
    "blockReward": 8,
    "premineAmount": 330000000,
    "excludedAddresses": [
      {
        "address": "0x0000000000000000000000000000000000000000",
        "label": "Burn Address"
      },
      {
        "address": "0x12A656c2DeE0EA2685398d52AcF78974fCD67B27",
        "label": "MasterChef Contract"
      }
    ],
    "cacheDuration": 60
  }
}
```

### Core Statistics APIs
- `GET /api/stats` - Basic network statistics (blocks, transactions, difficulty)
- `GET /api/stats-enhanced` - Extended statistics with network hashrate and mining data
- `GET /api/stats/gas` - Gas price tracker (slow/standard/fast/instant tiers)
- `GET /api/stats/daily` - Daily statistics (transactions, blocks, gas) with period parameter

### Network APIs
- `GET /api/network/node` - Node information (version, client, peers, sync status)

### Contract List APIs
- `GET /api/contracts` - List all contracts with pagination and filters (verified, type)

### Pending Transaction APIs
- `GET /api/transactions/pending` - Pending transactions in mempool

### Address Type APIs
- `GET /api/address/[address]/type` - Check if address is token, contract, or wallet

### Blockchain Data APIs
- `GET /api/blocks` - Latest 15 blocks with pagination
- `GET /api/blocks/[number]` - Specific block details by number
- `GET /api/transactions` - Latest 15 transactions 
- `GET /api/transactions/[txhash]` - Transaction details by hash
- `GET /api/tx/[hash]` - Alternative transaction endpoint
- `GET /api/blockheight` - Current blockchain height

### Address and Account APIs
- `GET /api/address/[address]` - Address details, balance, and transaction history
- `GET /api/accounts/[address]` - Account information and metadata
- `GET /api/richlist?page=1&limit=50` - Wealth distribution and top addresses

### Token and NFT APIs
- `GET /api/tokens` - List all tracked tokens (ERC-20, ERC-721, ERC-1155)
- `GET /api/tokens/[address]` - Token details, metadata, and holder information
- `GET /api/nft/[address]` - NFT collection details and metadata
- `GET /api/nft/[address]/metadata/[tokenId]` - Individual NFT metadata and image URLs

### Contract APIs
- `GET /api/contract/status/[address]` - Contract verification status
- `GET /api/contract/[address]` - Contract details and ABI
- `POST /api/contract/verify` - Submit contract source code for verification
- `POST /api/contract/interact` - Execute contract function calls

#### REST API Contract Verification (`POST /api/contract/verify`)

This endpoint provides a direct REST API for contract verification, supporting both single-file and Standard JSON Input formats.

**Request Body:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `address` | Yes | Contract address to verify |
| `sourceCode` | Yes* | Solidity source code (single file mode) |
| `standardJsonInput` | Yes* | Standard JSON Input (multi-file mode) |
| `compilerVersion` | Yes | Compiler version (e.g., `0.8.30`) |
| `contractName` | No | Contract name (auto-detected if not provided) |
| `optimization` | No | Enable optimization (default: `false`) |
| `optimizationRuns` | No | Optimization runs (default: `200`) |
| `evmVersion` | No | EVM version (default: `paris`) |
| `constructorArguments` | No | ABI-encoded constructor arguments |

*Either `sourceCode` or `standardJsonInput` is required.

**Single File Mode Example:**
```bash
curl -X POST "https://explorer.example.com/api/contract/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x...",
    "sourceCode": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\n\ncontract MyContract {\n    string public message;\n    constructor(string memory _message) {\n        message = _message;\n    }\n}",
    "compilerVersion": "0.8.30",
    "contractName": "MyContract",
    "optimization": true,
    "optimizationRuns": 200,
    "evmVersion": "paris"
  }'
```

**Standard JSON Input Mode Example:**
```bash
curl -X POST "https://explorer.example.com/api/contract/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x...",
    "standardJsonInput": "{\"language\":\"Solidity\",\"sources\":{\"MyContract.sol\":{\"content\":\"// SPDX-License-Identifier: MIT\\npragma solidity 0.8.30;\\n\\ncontract MyContract { ... }\"}},\"settings\":{\"optimizer\":{\"enabled\":true,\"runs\":200},\"evmVersion\":\"paris\"}}",
    "contractName": "MyContract.sol:MyContract",
    "compilerVersion": "0.8.30"
  }'
```

**Success Response:**
```json
{
  "verified": true,
  "contract": {
    "address": "0x...",
    "contractName": "MyContract",
    "compilerVersion": "0.8.30",
    "optimization": true,
    "sourceCode": "...",
    "abi": "[...]"
  },
  "message": "Contract successfully verified"
}
```

**Error Response:**
```json
{
  "verified": false,
  "message": "Bytecode mismatch - verification failed",
  "details": {
    "similarity": "95.00%",
    "note": "Compiled with solc 0.8.30 (EVM: paris, optimizer: enabled, runs: 200)"
  }
}
```

### Search APIs
- `GET /api/search/blocks-by-miner?miner=[address]` - Blocks mined by specific address

### Utility APIs
- `POST /api/web3relay` - Web3 RPC relay for blockchain queries

### WebSocket Endpoints
- `ws://localhost:3000/api/ws` - Real-time updates

### Enhanced Statistics Response
`GET /api/stats-enhanced` returns:
```json
{
  "latestBlock": 215221,
  "avgBlockTime": "13.41",
  "networkHashrate": "7.12 GH/s",
  "networkDifficulty": "95.46 GH",
  "totalTransactions": 4878,
  "avgGasPrice": "21000",
  "activeMiners": 1,
  "isConnected": true,
  "lastBlockTime": "2h ago"
}
```

## Advanced Features

### Real-time WebSocket Support
The system supports WebSocket connections for real-time updates:
- Block notifications
- Transaction confirmations
- Network statistics updates
- NFT transfer notifications

### NFT Support
Complete NFT functionality:
- ERC-721 and ERC-1155 token tracking
- Metadata retrieval and caching
- Image loading and fallback handling
- Token holder tracking
- Transfer history with proper TokenID display

### Contract Verification
Smart contract verification system:
- Source code compilation with multiple Solidity versions (release builds from a sha256-verified local cache, compiled in a worker thread — see [Solidity Compiler Isolation](#solidity-compiler-isolation-v087))
- Bytecode comparison
- ABI generation
- Contract interaction interface
- Verification status tracking

### Data Export
Export functionality for backup and analysis:
```bash
# Export blocks
npm run export:blocks -- --start=1000 --end=2000

# Export transactions
npm run export:transactions -- --date=2024-01-01

# Export statistics
npm run export:stats -- --format=csv

# Export tokens
npm run export:tokens -- --type=ERC-721
```



## Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
```bash
# Check MongoDB status
sudo systemctl status mongod

# Restart MongoDB
sudo systemctl restart mongod
```

2. **EVM Node Connection Error**
```bash
# Test RPC connection - Get current block number
curl -X POST -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     http://localhost:8545

# Expected response (normal):
# {"jsonrpc":"2.0","id":1,"result":"0x39c01"}
# 
# Error response (connection failed):
# curl: (7) Failed to connect to localhost port 8545: Connection refused
```

3. **PM2 Service Issues**
```bash
# Check PM2 status
pm2 status

# View detailed logs
pm2 logs --lines 100

# Restart specific service
pm2 restart explorer
```

4. **Memory Issues (1GB RAM)**
```bash
# Check memory usage
pm2 monit

# Restart with memory optimization
pm2 restart ecosystem.config.json
```

5. **Database Connection Issues**
```bash
# The web app and the tools read MONGODB_URI from .env; without it they stop with
# "MONGODB_URI is not set" (there is no default URI)
grep -c '^MONGODB_URI=' .env

# Authenticate with the application credentials; the password stays out of the command line
set -a; . ./.env; set +a
mongosh --nodb --quiet --eval 'const db = connect(process.env.MONGODB_URI); printjson(db.runCommand({ ping: 1 }))'

# Authentication failures recorded by the server
grep -a -c 'Authentication failed' /var/log/mongodb/mongod.log
```

6. **EVM Node Connection Issues**
```bash
# Check node status and block height
curl -X POST -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     http://localhost:8545

# Expected response (normal):
# {"jsonrpc":"2.0","id":1,"result":"0x39c01"}

# Check node synchronization
curl -X POST -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' \
     http://localhost:8545

# Expected response (synchronized):
# {"jsonrpc":"2.0","id":1,"result":false}
# 
# Expected response (syncing):
# {"jsonrpc":"2.0","id":1,"result":{"startingBlock":"0x0","currentBlock":"0x1000","highestBlock":"0x39c01"}}
# 
# Note: "result":false means the node is fully synchronized and up to date
```


7. **Performance Issues (slow queries, high mongod CPU)**
```bash
# Verify that every schema index exists (exit 1 lists the missing ones)
npm run optimize-indexes -- --check

# Create the missing ones (safe to re-run; never drops an index)
npm run optimize-indexes

# Confirm a block lookup uses the index: the plan must contain IXSCAN
# (or EXPRESS_IXSCAN on MongoDB 8) and totalDocsExamined must be 1
set -a; . ./.env; set +a
mongosh --nodb --quiet --eval '
  const db = connect(process.env.MONGODB_URI);
  const s = db.Block.find({ number: 1 }).explain("executionStats");
  printjson(s.queryPlanner.winningPlan);
  print("totalDocsExamined:", s.executionStats.totalDocsExamined);'

# Slow-query log lines stop increasing once the indexes exist
grep -a -c "Slow query" /var/log/mongodb/mongod.log

# Monitor memory usage
pm2 monit
htop
```

8. **Data Synchronization Issues**
```bash
# Force resync from specific block
SYNCALL=true npm run sync

# Rescan statistics
RESCAN=100:10000 npm run stats
# ... or from a block height up to the head (what repair-chain prints; RESCAN_INTERVAL=10 for a finer grid)
RESCAN_FROM=2298155 npm run stats

# Check sync status
pm2 logs sync | tail -50
```

9. **Orphaned blocks (parentHash mismatches, stale transactions)**
```bash
# Count broken links in the stored chain (exit 1 when any exist)
npm run repair-chain -- --check

# Preview, then replace the orphans with the node's canonical blocks (back up Block/Transaction/BlockStat first)
npm run repair-chain -- --fix --dry-run
npm run repair-chain -- --fix

# Recompute statistics from the lowest replaced height to the head (the tool prints the exact command)
RESCAN_FROM=<minReplaced> npm run stats

# Reorgs the live sync could not resolve are recorded here
set -a; . ./.env; set +a
mongosh --nodb --quiet --eval 'const db = connect(process.env.MONGODB_URI); db.scan_progress.find({ scanType: "reorg-pending" }).forEach(printjson)'
```

10. **Spam tokens with URL-like names, or token records at addresses without code**
```bash
npm run flag-spam-tokens -- --dry-run              # list what would be hidden (URL-like names)
npm run flag-spam-tokens                           # write the hidden flags
npm run flag-spam-tokens -- --audit-code --dry-run # addresses with no contract code (eth_getCode)
npm run flag-spam-tokens -- --audit-code           # hide them (hiddenReason: no-code)
```

### Performance Optimization

For low-resource environments (1GB RAM):

1. **Reduce batch sizes in config.json**
```bash
# Edit config.json and reduce bulkSize and other batch settings
```

2. **Enable swap**
```bash
# Create swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

3. **Monitor resources**
```bash
pm2 monit
```

4. **Adjust bulkSize**: Increase bulkSize for large data processing
5. **Indexes**: Created automatically from the schemas by the sync tools; verify with `npm run optimize-indexes -- --check` (see [Database Indexes](#database-indexes))
6. **Memory**: Ensure sufficient memory for large blockchains
7. **Network**: Ensure high-speed connection to EVM node
8. **Caching**: Implement Redis caching for frequently accessed data
9. **CDN**: Use CDN for static assets and images

## Security

1. MongoDB runs with authorization enabled; the application user has `readWrite` only and the credentials live in `.env` (see [Database Setup](#database-setup))
2. Properly restrict RPC access to EVM node
3. Set appropriate permissions for log files
4. Implement proper firewall settings in production
5. Validate contract verification inputs
6. Implement rate limiting for API endpoints

## Development

### Adding New Data Sources
To add new data sources, create a new sync module:
```typescript
// tools/custom-sync.ts
import Web3 from 'web3';
import mongoose from 'mongoose';

class CustomSync {
  constructor(config: any) {
    this.web3 = new Web3(config.nodeAddr);
    this.config = config;
  }

  async sync(): Promise<void> {
    // Implementation
  }
}

export default CustomSync;
```

### Custom Statistics
To add custom statistics, extend the stats calculator:
```typescript
// tools/custom-stats.ts
class CustomStats {
  async calculate(): Promise<void> {
    // Custom calculation logic
  }
}
```

### NFT Metadata Providers
Implement custom metadata providers:
```typescript
// lib/metadata-provider.ts
interface MetadataProvider {
  getMetadata(tokenId: number): Promise<TokenMetadata>;
  getImageUrl(tokenId: number): Promise<string>;
}
```

## Deployment

### Production Setup
1. Use PM2 for process management
2. Configure log rotation
3. Set up monitoring and alerting
4. Back up with `mongodump --config` (see [Backup and Restore](#backup-and-restore))
5. Configure CDN for static assets
6. Set up Redis for caching

### Docker Support
```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Configuration
All configuration is now centralized in `config.json`. See the Configuration section above for details.

## Migration Guide

### From JavaScript to TypeScript
1. Rename `.js` files to `.ts`
2. Add type definitions
3. Update import/export statements
4. Configure `tsconfig.json`

### From Pages Router to App Router
1. Move pages to `app/` directory
2. Update routing structure
3. Implement server components
4. Update API routes

### Database Schema Updates
```typescript
// Add new fields to existing collections
await db.collection('tokens').updateMany({}, {
  $set: {
    type: 'ERC-20',
    verified: false,
    metadata: null
  }
});
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Community** - For blockchain network support
- **Next.js Team** - For the amazing React framework
- **MongoDB Team** - For the robust database solution
- **Web3.js Team** - For blockchain interaction libraries

These tools enable the EVM Explorer to track the latest blockchain data in real-time, manage NFT collections, verify smart contracts, and provide comprehensive statistical information for the EVM-compatible network.
