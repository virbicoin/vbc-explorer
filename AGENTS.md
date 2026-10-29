# AGENTS.md

Practical instructions for AI coding agents working in this repository.

## Scope
- Applies to the whole workspace.
- Prefer concise, minimal changes that match existing patterns.
- Do not duplicate long docs here; follow links in the Reference section.

## Quick Start
- Requirements: Node.js 22.18+ or 24.11+ (Node 24 LTS per `.nvmrc`; Node 20 is end-of-life since 2026-04-30 and no longer satisfies Vitest 5 / Babel 8), npm >= 10.
- Install: `npm install`
- Dev server: `npm run dev`
- Quality gate: `npm run check`
- Tests: `npm run test` (Vitest; `test:watch` / `test:coverage` も利用可). DB tests use mongodb-memory-server, which downloads a MongoDB 8.0 binary on first run (`MONGOMS_SYSTEM_BINARY=/usr/bin/mongod` uses a local binary instead).
- Individual checks:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run format:check`

## Architecture Map
- App routes and pages: `app/`
- API routes: `app/api/`
- Etherscan 互換 API のドメイン別モジュール: `lib/api/blockscout/`（`app/api/route.ts` は薄いディスパッチャ）
- Shared components: `components/`
- Business logic and utilities: `lib/`
- Pure helpers with unit tests: `lib/security/`, `lib/services/`, `lib/contract/`, `lib/address/`, `lib/db/get-db.ts`, `lib/logger.ts`
- Database models and indexes: `models/index.ts` (the only place models are defined; `lib/models.ts` re-exports it; index helpers in `lib/db/indexes.ts`)
- Sync and maintenance tools: `tools/`
- Unit tests (Vitest): `tests/`
- Runtime configuration: `config.json` via `lib/config.ts`

## Coding Conventions
- TypeScript strict mode is enabled; keep types explicit and safe.
- Reuse shared types/constants from `lib/types/` (for example `ZERO_ADDRESS`).
- Prefer existing service/utility layers in `lib/services/`, `lib/utils/`, `lib/db/` before adding new logic.
- Keep App Router API handlers thin; push heavy logic into `lib/services/` or `lib/api/blockscout/`.
- Preserve response patterns from `lib/api-response.ts` for consistency.
- Server-side code (API routes, tools, DB layer) should log via `lib/logger.ts` instead of `console.*`.
- When extracting pure logic, add Vitest coverage under `tests/` and keep behavior identical.

## API Security Checklist
For new or modified API handlers in `app/api/**`:
1. Apply rate limiting at the top of the handler with `enforceRateLimit(request, '<bucket>')` or `withRateLimit('<bucket>', handler)` from `lib/security/rate-limits.ts`; add new buckets to `RATE_LIMITS` there, never inline numbers. Do not put Map-based limits in `proxy.ts` (Edge runtime).
2. Validate and sanitize all external input (address/hash/pagination/image URLs).
3. Return security headers on responses.
4. Avoid regex-based untrusted DB matching when exact/sanitized matching is possible.
5. Never fetch a chain-derived string (name, symbol, logoUrl, tokenURI, metadata contents) outside `safeFetchJson()` (`lib/security/safe-fetch.ts`): https only, DNS answers validated, no redirects, size and content-type limits. Plain `fetch()` of such URLs is forbidden.
6. The client IP comes only from `getClientIp()` (trusted header `TRUSTED_IP_HEADER`, default `X-Client-IP`, set by nginx). Never read `X-Forwarded-For` / `X-Real-IP`.
7. Render chain-derived names through `components/DisplayName.tsx`; list queries must exclude `hidden: true` documents and there is no `includeHidden` parameter on public APIs.
8. Never persist values a client asserts about a token (creator, name, supply, metadata). Launchpad registration resolves the address through `resolveFactoryToken()` (`lib/launchpad/factory.ts`: `isFactoryToken` / `getAllTokens` + `tokenInfo` via eth_call) and writes chain values only; such POSTs use the `write` bucket. `GET` handlers never write.
9. Never run solc on the request thread and never call `solc.loadRemoteVersion`. Compile only through `compileStandardJson()` (`lib/contract/compile-worker.ts`: worker thread, timeout, heap limit, queue → 503), which loads compilers from the sha256-verified cache (`lib/contract/compiler-cache.ts`; release builds only). `grep -rn "solc\." app lib` must only match those two files.
10. Every `limit` / `page` (and DataTables `start` / `length`) goes through `validatePagination()` with an explicit `maxLimit`, followed by `rejectDeepPagination()` (`page × limit` > 100,000 → 400).

## Data and Sync Notes
- Tools in `tools/` are production-relevant and use memory-limited scripts in `package.json`.
- NFT transfer sync logic must preserve multi-event correctness; avoid simplistic dedupe by tx hash only.
- Blocks are written with `upsertBlocks()` (by `number`) and transactions with `upsertTransactions()` (by `hash`) from `lib/sync/`. Never reintroduce `insertMany` with ignored E11000 errors; `Transaction.hash` stays unique.
- Replacing a height goes through `replaceBlock()` (`lib/sync/reorg.ts`), which also removes the orphan's transactions / token transfers, drops the BlockStat and rewinds the token scan. `tools/repair-chain.ts` reuses it for existing orphans.
- Names written to `tokens` / `Contract` must pass `hiddenFields()` (`lib/security/display-name.ts`) so URL-like or control-character names are flagged `hidden`.
- `tools/stats.ts` reads `RESCAN=<interval>:<range>` (range × interval blocks back from the head) or `RESCAN_FROM=<height>` (height → head); `tools/repair-chain.ts` prints the latter after a repair, and both forms exit when done.
- The Launchpad factory → `tokens` import lives in `lib/launchpad/sync.ts` (`syncLaunchpadTokens`), run by `tools/tokens.ts` and `POST /api/launchpad/sync`; it never rewrites existing names or attributions, only adds `factoryVerified` / `factory`.

## Database Models and Indexes
- Define Mongoose models only in `models/index.ts`. Never write inline `mongoose.models.X || mongoose.model('X', schema)` in routes or tools; import the model instead (`grep "mongoose.model("` must only match `models/index.ts`).
- Set `collection` explicitly to the real production collection name (`Block`, `Transaction`, `Account`, `Contract`, `BlockStat`, `Market`, `DexSwap`, `VerificationJob`, `tokens`, `tokentransfers`, `tokenholders`, `scan_progress`); `tests/db/model-collections.test.ts` enforces the allowlist.
- Declare indexes on the schema and nowhere else, and only when a real query (`find` / `findOne` / `aggregate` / `sort` keys) needs them.
- Keep `autoIndex: false`. Indexes are created by `ensureIndexes()` from `models/index.ts`, called by the data-writing tools on startup and by `npm run optimize-indexes` (`--dry-run`, `--check`). Never call `syncIndexes()` (it drops indexes) and never create indexes from the Next.js app.
- Query addresses and hashes with lowercase equality, not `$regex`/`RegExp`: writers store them lowercase and the schemas use `lowercase: true`; regex matching bypasses the indexes.
- DB tests run against mongodb-memory-server (`tests/db/`, `tests/tools/`); never point tests at a real database.

## Known Pitfalls
- Secrets must not be committed. Use `.env.local` and `${ENV_VAR}` references in `config.json`.
- DEX endpoints rely on cache and blacklist behavior from `lib/dex/cache-service.ts`; preserve that behavior when editing.
- Prefer singleton/provider patterns already implemented in `lib/web3/` and `lib/db/connection.ts`.
- Only `connectDB()` in `models/index.ts` calls `mongoose.connect`; `lib/db/connection.ts` is a wrapper over it and pool / timeout options live in `config.database.options` alone.
- The solc worker (`lib/contract/solc-worker.cjs`) is started by path from `process.cwd()`; keep it a plain CommonJS file without TypeScript, and keep `solc` in `serverExternalPackages`.

## Reference
- Primary project guide: [CLAUDE.md](CLAUDE.md)
- Setup and feature overview: [README.md](README.md)
- Security policy and hardening details: [SECURITY.md](SECURITY.md)
- Config template: [config.example.json](config.example.json)
- Environment variables: [.env.example](.env.example)
- nginx examples: [docs/nginx-explorer.conf.example](docs/nginx-explorer.conf.example) (explorer, trusted client IP), [docs/nginx-rpc.conf.example](docs/nginx-rpc.conf.example) + [docs/njs/rpc-filter.js](docs/njs/rpc-filter.js) (public RPC method filter)
