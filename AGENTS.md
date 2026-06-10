# AGENTS.md

Practical instructions for AI coding agents working in this repository.

## Scope
- Applies to the whole workspace.
- Prefer concise, minimal changes that match existing patterns.
- Do not duplicate long docs here; follow links in the Reference section.

## Quick Start
- Requirements: Node.js >= 20, npm >= 8.
- Install: `npm install`
- Dev server: `npm run dev`
- Quality gate: `npm run check`
- Tests: `npm run test` (Vitest; `test:watch` / `test:coverage` も利用可)
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
- Database models: `models/`
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
1. Apply rate limiting using helpers from `lib/security/`.
2. Validate and sanitize all external input (address/hash/pagination/image URLs).
3. Return security headers on responses.
4. Avoid regex-based untrusted DB matching when exact/sanitized matching is possible.

## Data and Sync Notes
- Tools in `tools/` are production-relevant and use memory-limited scripts in `package.json`.
- NFT transfer sync logic must preserve multi-event correctness; avoid simplistic dedupe by tx hash only.

## Known Pitfalls
- Secrets must not be committed. Use `.env.local` and `${ENV_VAR}` references in `config.json`.
- DEX endpoints rely on cache and blacklist behavior from `lib/dex/cache-service.ts`; preserve that behavior when editing.
- Prefer singleton/provider patterns already implemented in `lib/web3/` and `lib/db/connection.ts`.

## Reference
- Primary project guide: [CLAUDE.md](CLAUDE.md)
- Setup and feature overview: [README.md](README.md)
- Security policy and hardening details: [SECURITY.md](SECURITY.md)
- Config template: [config.example.json](config.example.json)
- Environment variables: [.env.example](.env.example)
