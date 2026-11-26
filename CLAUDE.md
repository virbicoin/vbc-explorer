# CLAUDE.md - VBC Explorer プロジェクトガイド

このファイルは、Claude Code（claude.ai/code）が本コードベースで作業する際のガイドです。

## プロジェクト概要

VBC Explorer は、VirBiCoin 向けに作られたモダンなブロックチェーンエクスプローラーです。**ETH・ETC やそのフォークコインでもそのまま動く汎用プロジェクト**なので、チェーン固有の値（ネットワーク名・通貨記号・ラップドトークン名・RPC ポート・チェーン ID・報酬スケジュール・フォーク名・premine）はすべて `config.json` に置き、コードには Ethereum 互換の既定値だけを書く（本番の設定で値が埋まっていて表に出ない直書きも不具合として扱う）。Next.js 16 App Router・TypeScript・MongoDB で構築しています。

主な機能は次のとおりです。

- NFT の表示・管理
- スマートコントラクトの検証
- DEX（分散型取引所）と Token Launchpad
- GeckoTerminal / CoinMarketCap / DefiLlama 互換の API エンドポイント

## 技術スタック

- **ランタイム**: Node.js 22.18+ または 24.11+（`.nvmrc` は 24 LTS、本番 TK04 は 24.22.3（2026-11-26 時点、MongoDB 8.0.38）。Node 20 は 2026-04-30 に EOL で、Vitest 5 / Babel 8 の engines も満たさない）
- **フレームワーク**: Next.js 16+（App Router）
- **言語**: TypeScript 7+（Go ネイティブ版 tsc。JS コンパイラ API は同梱されない）
- **データベース**: MongoDB（Mongoose 9）
- **スタイリング**: Tailwind CSS 4
- **Web3**: ethers.js 6, web3.js 4, viem 2, wagmi 3
- **状態管理**: @tanstack/react-query 5
- **テスト**: Vitest 5（DB テストは mongodb-memory-server / MongoDB 8.0）
- **Lint/型**: ESLint 10（flat config: @babel/eslint-parser + @next/eslint-plugin-next + react-hooks）。型検査は tsc（TS7）が担当
- **CLI ツールランナー**: tsx（esbuild ベース。ts-node は TS7 非対応のため置き換え）
- **プロセスマネージャー**: PM2
- **プロキシ**: proxy.ts（非推奨の middleware.ts を置き換え）

### TypeScript 7（ネイティブ版）移行メモ（2026-07）

TypeScript 7 は Go 実装のネイティブコンパイラで、`typescript` パッケージは JS コンパイラ API
（`ts.createProgram` / `ts.transpileModule` など）を同梱しなくなった。これに伴う構成変更:

- **typecheck**: `tsc --noEmit`（tsgo）が全体を数秒で検査。`npm run typecheck:tools` が
  `tsconfig.tools.json`（`module`/`moduleResolution: nodenext`。旧 `node10` は TS7 で削除）で
  tools/ を検査し、`npm run check` に組み込み済み
- **lint**: typescript-eslint / @eslint-react は JS API 依存のため撤去（canary も TS7 未対応）。
  TS/TSX の構文解析は `@babel/eslint-parser`＋`@babel/preset-typescript`（Babel 8、型情報なし）。
  `.tsx` は `@babel/plugin-syntax-jsx` を明示（Babel 8 は自動で JSX を有効化しない）。
  `no-undef` など tsc が担保するルールは off。`@typescript-eslint/no-explicit-any` 等の
  型依存ルールは失われた（typescript-eslint が TS7 対応したら復帰を検討）
- **CLI ツール**: ts-node は JS API 依存のため tsx へ移行（`tsx --tsconfig tsconfig.tools.json`）。
  tsx は実行時に型検査しないため、型担保は `typecheck:tools` が代替
- **Next.js ビルド**: `@typescript/native-preview` を devDependencies に入れることで、Next 16.2 が
  tsgo 利用を検出しビルド内型チェックを安全にスキップする（型検査は `npm run check` 側で実施）。
  これを外すと `next build` が「TypeScript 未インストール」誤検出でクラッシュするので注意

## プロジェクト構造

```
app/                    # Next.js App Router のページと API ルート
  api/                  # API エンドポイント
    address/            # アドレス情報、トランザクション、トークン、マイニング
    block/              # ブロック詳細
    blocks/             # ブロック一覧
    blockheight/        # 現在のブロック高
    circulating_supply/ # 循環供給量（CoinGecko/CMC 互換）
    compile/            # Solidity コンパイル
    config/             # クライアント設定
    contract/           # コントラクト検証・操作
    contracts/          # コントラクト一覧
    dex/                # DEX API
      cmc/              # CoinMarketCap 互換エンドポイント
      defillama/        # DefiLlama 互換エンドポイント
      geckoterminal/    # GeckoTerminal V2 互換エンドポイント
      chart/            # 価格チャートデータ
      pairs/            # 取引ペア
      pools/            # 流動性プール
      tokens/           # DEX トークン
      stats/            # DEX 統計
      external-price/   # 外部価格データ
    launchpad/          # Token Launchpad API
    network/            # ネットワーク/ノード情報
    realtime/           # リアルタイムデータ
    richlist/           # リッチリスト
    search/             # 検索 API
    stats/              # ネットワーク統計、ガス、日次
    tokens/             # トークン API
    total_supply/       # 総供給量（CoinGecko/CMC 互換）
    transactions/       # トランザクション一覧・保留中
    tx/                 # トランザクション詳細
    v2/                 # Blockscout v2 互換 API
    web3relay/          # Web3 RPC リレー
    ws/                 # WebSocket リレー
    route.ts            # Etherscan 互換 API
  api-docs/             # API ドキュメントページ
  components/           # ページ固有のコンポーネント
  dex/                  # DEX ページ（Swap, Pool, Farm, Analytics, Docs）
  launchpad/            # Token Launchpad ページ
  token/[address]/      # トークン詳細ページ
  
abi/                    # スマートコントラクト ABI
  MasterChefABI.ts      # MasterChef ファーミングコントラクト
  TokenFactoryABI.ts    # 旧トークンファクトリ
  TokenFactoryV2ABI.ts  # メタデータ付き V2 トークンファクトリ
  
components/             # 共有コンポーネント
config/                 # 設定（farming.ts）
hooks/                  # カスタム React フック
  useDexConfig.ts       # DEX 設定フック
  useDexTokens.ts       # DEX トークンフック
  useFarming.ts         # ファーミングフック
  useLaunchpadConfig.ts # Launchpad 設定フック
  useTokenConfig.ts     # トークン設定フック
  
lib/                    # ユーティリティライブラリ
  cache/                # インメモリキャッシュ
  db/                   # データベース抽象化レイヤー（get-db.ts, indexes.ts, uri.ts: MONGODB_URI 解決・既定なし, count.ts: estimatedDocumentCount）
  dex/                  # DEX 固有ユーティリティ & キャッシュサービス
  security/             # 入力検証（validation.ts, url.ts, pagination.ts）・レート制限（rate-limits.ts）・SSRF 安全 fetch（safe-fetch.ts）・表示名判定（display-name.ts）
  sync/                 # リオーグ対応の同期共通モジュール（normalize / reorg / chain-check / web3-node）
  launchpad/            # Launchpad ファクトリー照会（factory.ts: eth_call でチェーン認証）と tokens への同期（sync.ts）
  contract/             # solc 補助（solc-utils.ts）・検証済みコンパイラキャッシュ（compiler-cache.ts）・worker_threads コンパイル（compile-worker.ts, solc-worker.cjs）
  services/             # ビジネスロジックサービス
  types/                # TypeScript 型定義
  utils/                # ユーティリティ関数
  web3/                 # Web3 シングルトンプロバイダ
  bigint-utils.ts       # BigInt ユーティリティ
  client-config.ts      # クライアント側設定
  config.ts             # サーバー側設定
  db.ts                 # データベース接続
  env.ts                # .env / .env.local の読み込み（tools の最初の import。資格情報はログに出さない）
  etherUnits.ts         # 単位変換
  filters.ts            # データフィルタ
  launchpad-token-source.ts # Launchpad トークンデータ
  models.ts             # モデルインターフェース
  price-service.ts      # 価格データサービス
  reward-schedule.ts    # ブロック報酬スケジュールの計算（純粋モジュール、クライアント/サーバー共用。値は config.json の rewards、サーバーは getRewardSchedule()）
  stats.ts              # 統計ユーティリティ
  supply.ts             # 供給量計算
  transaction-utils.ts  # トランザクションユーティリティ
  
models/                 # Mongoose モデル（index.ts が唯一の定義場所。インデックス定義もここ）
tools/                  # ブロックチェーン同期用 CLI ツール
  sync.ts               # ブロックチェーン同期
  tokens.ts             # トークンデータ同期（NFT/ERC20）
  stats.ts              # 統計計算（RESCAN=<interval>:<range> / RESCAN_FROM=<height> で再計算）
  richlist.ts           # リッチリスト生成
  price.ts              # 価格 + DEX スワップ同期
  register-contracts.ts # コントラクト登録
  optimize-indexes.ts   # スキーマ定義インデックスの作成/確認（--dry-run / --check）
  repair-chain.ts       # 保存済みチェーンの検査と孤児ブロックの置換（--check / --sample / --fix）
  backfill-uncle-rewards.ts # 保存済みブロックのアンクル発行量（Block.uncleReward）の埋め戻し
  flag-spam-tokens.ts   # URL 名トークン/コントラクトの hidden フラグ付与（バックフィル）、--audit-launchpad でファクトリー外トークンの列挙
  add-token.ts          # 手動トークン追加
  
types/                  # TypeScript 型定義
logs/                   # ログファイル
public/                 # 静的アセット
```

## パフォーマンス最適化

### Web3 シングルトン（`lib/web3/provider.ts`）
- すべての API ルートで単一の Web3 インスタンスを共有
- リクエストごとに新しい接続を作成するのを回避
- 高速起動のための遅延初期化

### インメモリキャッシュ（`lib/cache/memory-cache.ts`）
- TTL 対応の LRU 風キャッシュ
- データベースクエリと RPC 呼び出しを削減
- メモリ上限を設定可能（デフォルト 50MB）
- 期限切れエントリの自動クリーンアップ

```typescript
import { apiCache, CACHE_TTL } from '@/lib/cache';

// 1 分間キャッシュ
const data = await apiCache.getOrSet('key', fetcher, CACHE_TTL.MEDIUM);
```

### DEX キャッシュサービス（`lib/dex/cache-service.ts`）
DEX と GeckoTerminal の API 向けにキャッシュを一元管理し、RPC 呼び出しを減らします。キャッシュの種類は次のとおりです。
- **トークン情報キャッシュ**: TTL 30 分（symbol, name, decimals はほぼ変化しない）
- **プール情報キャッシュ**: TTL 10 秒（リザーブは頻繁に変化）
- **プール統計キャッシュ**: TTL 10 秒（出来高/トランザクション統計）
- **VBC 価格キャッシュ**: TTL 10 秒
- **レスポンス単位キャッシュ**: API レスポンス全体を 30〜60 秒

主な利点:
- 高負荷時に RPC 呼び出しを 80% 以上削減
- 並列数制限付きのバッチ処理（一度に 2〜3 プール）
- 全リクエストでプロバイダインスタンスを共有

```typescript
import {
  getCachedVBCPrice,
  getCachedPoolInfo,
  getCachedPoolStats,
  getCachedTokenInfo,
  getLPAddresses,
} from '@/lib/dex/cache-service';

// キャッシュ済みデータを取得（未キャッシュなら自動で取得）
const poolInfo = await getCachedPoolInfo(poolAddress);
const vbcPrice = await getCachedVBCPrice();
```

### Next.js 最適化（`next.config.ts`）
- `output: 'standalone'` は使っていない（本番はチェックアウトで `next start`）。`outputFileTracingIncludes` は standalone / サーバーレスで出力するときのための設定
- `env` ブロックは置かない（`MONGODB_URI` がビルド成果物に平文で埋め込まれていた。サーバーは実行時の `process.env` を読む）
- `optimizePackageImports` - 大きなパッケージのツリーシェイキング
- `serverExternalPackages` - 重いサーバー依存のバンドルを防止
- `compress: true` - Gzip 圧縮を有効化

### データベースインデックス（`npm run optimize-indexes`）
- インデックスは `models/index.ts` のスキーマ定義が唯一の真実。`autoIndex: false` のまま、書き込みツールが起動時に `ensureIndexes()` で明示的に作成する（Web は触らない）
- `npm run optimize-indexes` は同じ関数を呼ぶラッパー。`-- --dry-run` で作成予定、`-- --check` で不足検査（不足があれば exit 1）
- 既存インデックスは削除しない（`syncIndexes()` は使わない）。unique は重複チェック後に張り、重複があればそのインデックスだけ見送って報告する
- 詳細は「新機能（2026-10）: DB インデックス管理とモデル一本化」を参照

## よく使うコマンド

```bash
# 開発
npm run dev             # 開発サーバーを起動
npm run build           # 本番ビルド
npm run start           # 本番サーバーを起動

# コード品質
npm run lint            # ESLint を実行
npm run lint:fix        # ESLint の問題を修正
npm run typecheck       # TypeScript 型チェック
npm run format          # Prettier でコード整形
npm run format:check    # 整形チェック
npm run check           # lint, typecheck, format:check を実行

# テスト
npm run test            # Vitest でユニットテストを実行
npm run test:watch      # ウォッチモードでテストを実行
npm run test:coverage   # カバレッジ付きでテストを実行

# ブロックチェーン同期ツール
npm run sync            # ブロックチェーンデータを同期
npm run tokens          # トークン（NFT/ERC20）データを同期
npm run stats           # 統計を計算
npm run richlist        # リッチリストを生成
npm run price           # 価格 + DEX スワップデータを更新（価格 API / DEX プール）
npm run internal-txs    # 内部取引をコールトレースから索引（--once / --from <block> / --status）

# データベース管理
npm run optimize-indexes              # スキーマ定義のインデックスを作成（不足分のみ、削除なし）
npm run optimize-indexes -- --dry-run # 作成予定を表示（変更なし）
npm run optimize-indexes -- --check   # 不足があれば一覧を出して exit 1
npm run repair-chain -- --check       # 保存済みチェーンの parentHash 連結検査（不一致で exit 1）
npm run repair-chain -- --fix         # 孤児ブロックをノードの正規ブロックで置換（--dry-run あり）
npm run backfill-uncle-rewards -- --dry-run # アンクル発行量が未記録のブロックを数える（引数なしで書き込み）
npm run backfill-verification-settings -- --dry-run # 検証済みで設定が未記録の記録に、保存済みの standard JSON の設定を入れる（引数なしで書き込み）
npm run flag-spam-tokens -- --dry-run # URL 名トークンの hidden 判定を表示（引数なしで書き込み）
npm run flag-spam-tokens -- --audit-launchpad # ファクトリーが知らない Launchpad トークンを列挙し factoryVerified を記録
npm run flag-spam-tokens -- --audit-code --dry-run # コードのないアドレス（eth_getCode が 0x）の token / Contract を列挙（--dry-run なしで hidden: no-code）

# バックアップ（URI は YAML 経由で渡し、コマンド行や ps に出さない。アプリ用ユーザーで可）
umask 077; printf 'uri: %s\n' "$(sed -n 's/^MONGODB_URI=//p' .env)" > /tmp/md.yaml && mongodump --config /tmp/md.yaml --gzip --out "$HOME/backup/explorerDB-$(date +%F)"; rm -f /tmp/md.yaml
RESCAN_FROM=<height> npm run stats    # 指定高さから先端まで BlockStat を再計算（repair-chain が案内する形）

# PM2 プロセス管理
pm2 restart explorer    # explorer を再起動
pm2 logs explorer       # ログを表示
pm2 logs price          # 価格同期のログを表示
pm2 logs internal-txs   # 内部取引の索引のログを表示
pm2 status              # サービス状態を確認
pm2 monit               # リソースを監視
```

## 価格 & DEX データアーキテクチャ

### 価格ソース（tools/price.ts, lib/price-service.ts）
価格は次の API を上から順に試し、最初に取得できた値を使います。
1. **CoinGecko** - `https://api.coingecko.com/api/v3/simple/price`
2. **CoinMarketCap** - 環境変数 `CMC_API_KEY` が必要
3. **Coinpaprika** - `https://api.coinpaprika.com/v1/tickers`
4. **DEX** - ラップドネイティブ / ステーブルコインのプールのリザーブから算出するオンチェーン価格（`lib/dex/native-price.ts`）

`config.json` の `currency.priceApi` で設定します:
```json
"priceApi": {
  "coingecko": { "enabled": false, "id": "virbicoin" },
  "cmc": { "enabled": false, "id": "virbicoin" },
  "coinpaprika": { "enabled": false, "id": "vbc-virbicoin" },
  "dex": { "enabled": true }
}
```
- **更新間隔**: 価格は 5 分ごと、DEX スワップは 15 秒ごと
- **VBC は DEX が唯一の出どころ**: 外部 API には VBC の価格が無い（CoinGecko は未掲載、Coinpaprika は登録されているが 2026-05-29 から非アクティブ）ので、上の例のように API を止めて DEX だけにする
- **WikaEx は削除済み（2026-11、ユーザーの判断）**: 価格の取得先・設定・文書から WikaEx を消した。取得先に戻さない。`Market` の出どころ不明の旧データ（2026-05-28〜10-01、32,182 行）はほぼその取引所の値。ユーザーの判断で残している（今の画面と API は最新の行と 24 時間前の行しか読まない）
- **DEX 価格の前提**: `dex.wrappedNative` と `dex.tokens.usdt`（または `priceApi.dex.stablecoinAddress`）が設定されていること。プールは `priceApi.dex.pairAddress`、無ければ `dex.lpTokens` / `dex.farmPools` から探す。プールが空のときは価格を保存しない（0 や無限大を書かない）。BTC 建ては取れないので `quoteBTC` は 0
- **`getReserves()` は 2 値で宣言する**: この DEX のペアは `(reserve0, reserve1)` の 2 値を返す。Uniswap V2 の 3 値（`uint112, uint112, uint32`）で宣言すると復号に失敗し、価格が一切取れなくなる（2026-10 から価格が 0 になっていた原因）。宣言は `PAIR_VIEW_ABI` を使う
- **出どころの記録**: `Market` の各行に `source`（`dex` / `coingecko` など）を保存し、`/api/dex/external-price` の `source.price` は `priceSourceLabel()` で返す

### 価格サービス（lib/price-service.ts）
すべての API ルートから価格データを取得するための共通モジュールです。
```typescript
import { getNativePrice, getPriceFromDatabase } from '@/lib/price-service';

// ソース情報付きの現在価格を取得
const priceData = await getNativePrice();
// 戻り値: PriceData | null — { symbol: 'VBC', priceUSD: 0.000809, priceBTC: 0, timestamp: <ms>, source: 'database', origin: 'dex' }
// 表示用の出どころ名は priceSourceLabel(priceData)（'DEX' / 'CoinGecko' / 'Market DB' など）
```

### DEX スワップ同期
- Router コントラクトの Swap イベントを `DexSwap` コレクションに同期
- GeckoTerminal の OHLCV、CMC trades、チャート API を支える

## セキュリティ機能

### 入力検証（`lib/security/validation.ts`）
- `sanitizeAddress()`, `sanitizeHash()` によるアドレス/ハッシュ形式の検証
- `validatePagination()` によるページネーションパラメータの検証
- ReDoS 攻撃を防ぐための正規表現エスケープ
- **NoSQL インジェクション対策**: `$regex` の代わりに小文字での直接マッチングを使用
- **画像 URL 検証**: 外部トークン画像向けの `isValidImageUrl()`
  - HTTPS のみ許可（http:// をブロック）
  - 危険なスキームのブロック（javascript:, data:, vbscript:, file:）
  - XSS パターン検出（onclick=, onerror=, <script）
  - 無効な URL に対して null を返す `sanitizeImageUrl()` ラッパーを使用

### レート制限（`lib/security/rate-limits.ts`）
- クライアント IP は `getClientIp()` が **信頼ヘッダ 1 本**（`TRUSTED_IP_HEADER`、既定 `X-Client-IP`。nginx が Cloudflare の `CF-Connecting-IP` から付け直す）だけから取る。`X-Forwarded-For` / `X-Real-IP` は読まない（クライアントが詐称できるため）。不正・欠落なら `unknown` バケット（上限 1/10）
- バケットは `RATE_LIMITS` に集約（キーは `バケット名:ip`）: `api` 100/分、`verify` 5/分（コンパイル自体はワーカーキューが直列化するので mutex は持たない）、`interact` 30/分、`tokenMetadata`（`/api/tokens/[address]?tokenId=`）10/分、`write` 10/分（`POST /api/launchpad/register` と `POST /api/launchpad/sync`）、`launchpad` 30/分、`relay` 60/分。CSV export は従来の独自上限
- 各 route.ts の先頭で `enforceRateLimit(request, 'api')` か `withRateLimit('verify', handler)` を呼ぶ。超過は 429 + `Retry-After`、`logger.warn` で記録。同一 IP が 1 分に 20 回 429 になると警告 1 行（crowdsec の種）。`proxy.ts`（Edge）には Map ベースの制限を置かない
- nginx 側の設定例は `docs/nginx-explorer.conf.example`

### セキュリティヘッダ（`proxy.ts`）
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security`（本番のみ）
- API ルート向けの `Content-Security-Policy`

### DEX ブラックリストフィルタリング（`lib/dex/cache-service.ts`）
- `config.json` の `blacklist.lpPairs` に列挙した LP ペアは、すべての DEX API から除外
- `/api/dex/geckoterminal/pools`、`/api/dex/stats` などに影響
- 非推奨/テスト用プールに使用

### トークン一覧のブラックリスト（`/api/tokens`）
- `config.json` の `blacklist` で `/api/tokens`（および `/tokens` ページ）の表示を制御
  - `symbols`: シンボル一致で除外（例: `TEST`/`FIX`/`FIX2`）。同名で複数アドレスがあるテスト/ジャンクトークンを一括で隠す
  - `tokens`: アドレス一致で除外
  - `lpPairs`: LP ペアアドレスで除外
- Launchpad トークンは現行 + `launchpad.legacyFactories` の TokenFactory から取得し、`tokenholders` 未登録でも供給があれば表示

### DEX 価格セキュリティ
- **オンチェーン価格導出**: VBC/USDT ペアはプールのリザーブ比率で価格を計算
- 外部 API の操作による攻撃を防止
- TVL は両トークンのリザーブ合計として計算（50/50 プール）

### API セキュリティ
- リクエストボディサイズの上限
- Content-Type の検証
- ソースコードサイズの上限（コントラクト検証で 500KB）
- すべての書き込み操作に対する入力検証

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

// API ルート内 - 完全な例
export async function GET(request: NextRequest) {
  // 1. レート制限
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`endpoint:${clientIp}`, 60, 30);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  // 2. 入力検証
  const address = searchParams.get('address');
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  // 3. サニタイズして使用
  const sanitizedAddress = sanitizeAddress(address);
  // ... DB クエリで sanitizedAddress を使用

  return NextResponse.json(data, { headers: getSecurityHeaders() });
}
```

## 主要な実装の詳細

### NFT トークン転送（tools/tokens.ts）

NFT 転送の同期では、`tokenAddress + tokenId + blockNumber + to` を一意キーとして使います。これは次の理由から重要です。
- 1 つのトランザクションが複数の Transfer イベントを発行することがある（バッチ mint/burn）
- `transactionHash` だけをキーにすると、データが失われてしまう

### トークン所有者の計算（app/api/tokens/[address]/route.ts）

NFT の所有者は次のように計算されます:
1. すべての Transfer イベントをタイムスタンプ順に取得
2. `tokenOwnership` Map を構築
3. `to === ZERO_ADDR`（burn）のときに Map から削除
4. 非ゼロアドレスへの転送時に所有者を設定
5. 最終的な Map のサイズ = 実際の NFT 供給量（burn 済みを除く）

### データベースコレクション

- `blocks` - ブロックデータ
- `transactions` - トランザクションデータ
- `contracts` - 検証済みコントラクト（ERC フィールド: 0=コントラクト, 2=ERC20, 721=VRC-721, 1155=VRC-1155）
- `tokens` - トークンメタデータ（モデル `Token`）
- `tokentransfers` - トークン転送イベント（モデル `TokenTransfer`。フィールドは tokenAddress / transactionHash / from / to / value / tokenId（NFT のみ） / logIndex（VRC-20・VRC-1155。イベント 1 件につき 1 文書） / blockNumber / timestamp(Date)。VRC-1155 は `tokenType: 'VRC-1155'`・`batchIndex`・`operator` も持ち、`tokenId` は 10 進文字列）
- `InternalTransaction` - 内部取引（コールトレースの各フレーム。`tools/internal-txs.ts` が書く）
- `tokenholders` - トークン保有者残高（モデル `TokenHolder`）
- `scan_progress` - 進捗マーカー（モデル `ScanProgress`）: `tokens`（tools/tokens.ts）、`sync`（リスナー位置）、`reorg-pending`（maxReorgDepth 超のリオーグ範囲。`meta` に from/to）、`repair`（repair-chain の再開位置）、`internal-transactions` と `erc1155`（範囲索引器。`generation` / `inFlightTo` / `skipped` を持つ）
- `Account` - アカウント残高
- `Market` - 複数ソースからの価格データ（price.ts が更新）
- `DexSwap` - DEX スワップイベント（price.ts が更新）
- `VerificationJob` - Etherscan 互換検証 API のジョブ

コレクション名はすべて `models/index.ts` の `{ collection }` で明示し、本番の実在名と一致させる（`tests/db/model-collections.test.ts` が allowlist で検証）。

### コントラクトタイプ判定（`app/api/contracts/route.ts`）
API は、次の複数の手がかりからトークンの種類を推定します。
1. **ERC フィールド** - 2/20=VRC-20, 721=VRC-721, 1155=VRC-1155
2. **type フィールド** - VRC-XX 形式に正規化（ERC20 → VRC-20）
3. **名前からの推定** - 'nft'/'721' を含む名前 → VRC-721
4. **シンボルからの推定** - symbol + decimals あり → VRC-20
5. **tokenName フィールド** - 設定あり → VRC-20

すべてのタイプは `lib/api-response.ts` の定数を使用: `ContractTypes.VRC20` など。

### 設定

メイン設定ファイル: `config.json`（git 管理外。`config.example.json` をテンプレートとして使用）

秘密情報は `.env`（または `.env.local`。後者が優先。どちらも git 管理外）に置く。`MONGODB_URI` は必須で既定値はない（未設定なら `connectDB()` が `MissingMongoUriError` で止まる）。Next.js も tools も同じファイルを読む（tools は `lib/env.ts` を最初に import する）。`config.json` の `database.uri` は `${MONGODB_URI}` のまま。本番の MongoDB は 2026-10-30 から認証あり（アプリ用ユーザーは explorerDB の readWrite。管理ユーザーのパスワードはサーバー管理者の手元にあり、リポジトリには置かない）。

主な設定セクション:
- `web3Provider` - RPC エンドポイント
- `database` - MongoDB 接続
- `dex` - DEX コントラクトアドレス
- `launchpad` - トークンファクトリアドレス
- `network` - チェーン ID と名称

## よくある問題と解決策

### NFT トークン ID の欠落
一部の NFT が表示されないときは、`npm run tokens` を実行して再同期してください。同期ツールは、1 つのトランザクションに複数の Transfer イベントが含まれる場合も正しく処理します。

### トークンアイコンが表示されない（旧ドメイン 502）
Launchpad トークン（例: STEN/VBCAT）のアイコンが消える場合、オンチェーンの `logoUrl()` が旧エクスプローラードメイン `explorer.digitalregion.jp`（現在は HTTP 502）を指していることが原因です。`/api/tokens` は次の方針でこれを解決します。

- **アイコン解決順序**: `config.json` の `tokenIcons`（シンボル一致）→ DEX 設定のアドレス一致 → オンチェーン `logoUrl()`
- **旧ドメインの正規化**: DB・オンチェーン由来の `logoUrl` は `normalizeLegacyLogoUrl()`（`lib/utils/format.ts`）で現行ドメイン（`config.explorer.url` のホスト）へ書き換え。旧ドメインと新ドメインは同じ画像パス（`/img/STEN.svg` 等）を提供するため、ホスト名のみ差し替えればよい
- **設定駆動（ハードコードしない）**: アイコンのベース URL は `config.explorer.url`、書き換え対象の旧ドメインは `config.explorer.legacyUrls`（フルURLの配列）から取得。`normalizeLegacyLogoUrl()` はネットワーク非依存の純粋関数で、`legacyUrls` が空なら no-op。VirBiCoin では `config.json` に `"legacyUrls": ["https://explorer.digitalregion.jp"]` を設定（旧ドメインが HTTP 502 のため）
- 恒久的にアイコンを差し替えたい場合は `config.json` の `tokenIcons` にシンボルとパスを追加
- **Launchpad ページも同様に正規化（2026-07）**: `/launchpad`（TokenList/MyTokens/トークン管理ページ）はチェーンを直接読むため、クライアント側でも `normalizeLegacyLogoUrl()` を表示時に適用。`explorer.url` / `explorer.legacyUrls` は `/api/config/client` が公開し、`useLaunchpadConfig` が `explorerHost` / `legacyExplorerHosts` として提供

### Launchpad の登録はファクトリー認証（2026-10）
`POST /api/launchpad/register` はリクエスト本文の creator / name / metadata を一切使わず、ファクトリーがそのアドレスを作ったとチェーンが答えた場合だけ登録する（詳細は「第 3 次修正」節）。ファクトリー外で作られたトークンは Launchpad 一覧には出ず、通常の tokens 一覧には従来どおり出る（意図した動作）。

### Launchpad トークンの metadata が空になる問題（2026-07 対策済み）
作成フォームはタブ切替でアンマウントされ state が消えるため、metadata（ロゴ等）を入れたのに素の `createToken` で作成してしまう事故が起きうる（実例: SSBC）。対策:

- **フォームドラフト**: 入力値を sessionStorage に保存しタブ切替後に復元（`CreateTokenForm.tsx` の `DRAFT_KEY`）
- **後から設定可能**: トークン管理ページ（`/launchpad/token/[address]`）の Edit Metadata は owner 限定の `setAllMetadata()` を 1 トランザクションで呼ぶ（旧実装は setLogoUrl/setDescription/setWebsite を連続発火し、複数フィールド変更時に最後の 1 つしか追跡されなかった）。twitter/telegram/discord は `getMetadata()` の現在値を透過
- MyTokens には logoUrl 未設定トークンに「No Logo」チップを表示（Manage → Edit Metadata へ誘導）

### window.ethereum の型エラー
グローバル型定義は `types/global.d.ts` にあります。

### 同期ツールのメモリ問題
メモリ上限は `MEMORY_LIMIT_MB` 環境変数で設定します。必要に応じて npm スクリプト内で調整してください。

## 新機能（2026-06-15）: SEO・メタデータ・構造化データ

エンティティページとサイト全体の SEO を体系的に整備。**すべての名称は config（`config.json`）由来で、コイン固有名はソース（コメント・テスト固定値を含む）にハードコードしない**（マルチチェーン前提）。

### per-entity メタデータ（`lib/seo.ts`）
- `block/[number]`・`tx/[hash]`・`address/[address]`・`token/[address]` をサーバーコンポーネント化し `generateMetadata` を付与。各 `page.tsx` は薄いサーバーラッパーで、巨大なクライアント本体は同ディレクトリの `*Client.tsx` に退避（`params` Promise をそのまま転送＝挙動不変）。
- `lib/seo.ts` は純関数のビルダー（`buildBlock/Tx/Address/TokenMetadata`、`buildEntityMetadata`、`formatNativeAmount`、`shortenHex`）。title/description/canonical/OG/Twitter を生成。ユニットテストは `tests/lib/seo.test.ts`。
- ルート `layout.tsx` に `metadataBase`（`config.explorer.url` 由来）＋サイト既定 OG/Twitter。

### スニペットのライブ強化（`lib/seo-data.ts`）
- token は実名/シンボル（`Name (SYMBOL)`）、block は miner＋日付、tx は値/from/to/status、address は残高を description に付与。
- DB アクセスは共有ヘルパー `cachedDbLookup`：**`tryGetDb()` で非ブロッキング・throw しない・正/不在のみキャッシュ**（`generateMetadata` を絶対にハングさせない）。未取得時はパラメータ由来へフォールバック（加点のみ）。

### OG 画像（`lib/og.tsx` ＋ 各ルートの `opengraph-image.tsx`）
- `next/og` でエンティティ別 1200×630 カードを動的生成（ブランド名・種別・主値・ネットワーク/ドメイン）。token カードは実名表示。Twitter は `summary_large_image`。

### 構造化データ（`app/components/JsonLd.tsx`）
- エンティティページに BreadcrumbList、サイト全体（root layout）に WebSite（SearchAction → `/search?q=`）＋ Organization（`sameAs` は `config.social` 由来）。`<` をエスケープして `</script>` ブレイクアウトを防止。
- `/search` は `?q=` を読んで自動検索（`Suspense`＋`useSearchParams`）＝共有可能な検索URL。

### サイト全体
- `app/robots.ts`（`/api/` を Disallow＋sitemap 参照）、`app/sitemap.ts`（主要ハブの絶対URL）。
- ハブページ（blocks/transactions/tokens/contracts/richlist/stats/network）と `/api-docs` にセグメント `layout.tsx` で固有メタデータ。
- `app/not-found.tsx`：カスタム 404＋`robots: noindex`。

### 耐障害性・汎用化
- `proxy.ts` の `/address` タイプ判定 fetch に AbortController（2s）を追加 → DB 停止時も `/address` がハングしない（従来 ~15s）。
- DEX サブシステム（`geckoterminal/info`・`pool`、`dex` ページ、`useFarming` のウォレット追加 `nativeCurrency`）の真のハードコード固有名を config 由来に。クライアントは `lib/client-config`（`getNetworkName`/`getCurrencyConfig`）または `useDexConfig`（`currency` フィールド追加）から取得。設定済みの本番では出力は不変。

## 新機能（2026-11）: 内部取引と VRC-1155 の同期

それまで `txlistinternal` / `token1155tx` / v2 の内部取引は常に空だった。本番（TK04）の全 46,470 取引をトレースした結果、内部取引は 11,059 件（値の移動 1,079 件、計約 4,628,000 VBC）、コントラクトが作ったコントラクトが 44 件（うち 23 件は Contract にも tokens にも無く、VRC-20 が 6 件・旧ファクトリーの LP が 2 件含まれていた）。VRC-1155 のイベントはチェーン上にまだ無い（2026-11-26 時点）。

### 設計ルール（必ず守る）
- **内部取引はノードのコールトレース（Parity 形式の `trace_transaction`）からだけ作る。** 取得先は `config.json` の `traces.url`（または `TRACE_RPC_URL`）。Ovbc は trace API を IPC ソケットにだけ開くので、TK04 では `/home/aoi/.local/share/openvirbicoin/jsonrpc.ipc` を指す。公開 RPC（8329）の `--jsonrpc-apis` は変えない（手引きのとおり）
- **保存するのは最上位の call 以外の全フレーム**（Blockscout と同じ。最上位の create は作られたアドレスを持つので残す）。`index` はトレース内の位置、`error` はそのフレーム自身のエラー、`reverted` は自分か外側のフレームが失敗したら true（効果が残っていない）。v2 の `success` と Etherscan の `isError` は `reverted` から出す
- **Etherscan / Blockscout 形式の `txlistinternal` は値が動いた call と create / create2 / selfdestruct だけ**（本家と同じ）。v2 の一覧は値 0 の staticcall / delegatecall も含む全フレーム
- **書き込みはブロック範囲ごとの丸ごと置き換え**（`indexInternalTransactions()`）。DB の取引のブロックハッシュとトレースのブロックハッシュが違うブロックからは書かない。進捗は `lib/sync/range-scan.ts`（`claimRange()` → 書き込み → `completeRange()`、`generation` が変わっていたら記録しない）。`replaceBlock()` は孤児の内部取引を消し、`rewindRangeScans(height)` で範囲索引器を巻き戻す。この仕組みを迂回して `lastScannedBlock` を直接書き換えない（CLI の `--from` は `resetRangeScan()`）
- 索引器は確定部分（DB の先端 − `sync.confirmations` − 1）までしか進まない。トレースできない取引は 3 回やり直してから `skipped` に記録して進む（接続エラーは記録せず待って再試行）
- **VRC-1155 は TransferSingle / TransferBatch のログ（トピック指定の `eth_getLogs`）から見つける。** 受け入れるのは ERC-165 `supportsInterface(0xd9b67a26)` が true でコードがあるコントラクトだけ。別の規格で登録済みのトークンは混ぜない。移動は id ごとに 1 文書、`tokenId` は 10 進文字列（uint256）で、ドライバー経由で書く・読む（Mongoose の Number へのキャストを通さない）
- **トークン登録の判定は `registerTokenContract()`（tools/tokens.ts）だけ**。取引が作ったコントラクト（ブロック走査）とコントラクトが作ったコントラクト（`adoptContractsCreatedByContracts()`、`InternalTransaction.createdContract` から）の両方がここを通る。ペア（token0 / token1 を返す）は LP として名前を付け直す
- `tokens -- --rescan` は `tokens` の進捗だけを消す（以前は `ScanProgress.deleteMany({})` で sync などの進捗まで消していた）

### 実装の要点
- `lib/sync/internal-transactions.ts`: `internalTransactionsFromTraces()`（変換）、`createTraceSource(url)`（IPC / http / ws、30 秒でタイムアウト、失敗したら次回つなぎ直す）、`indexInternalTransactions(source, from, to, { concurrency, maxTransactions, skip })`
- `lib/sync/range-scan.ts`: 範囲索引器の進捗（`internal-transactions` / `erc1155`）。`tools/internal-txs.ts`: `indexToConfirmedHead()`（常駐ループの本体、テスト可能）と CLI。作られたコントラクトは `lib/sync/contracts.ts` の `registerContract()`（tools/sync.ts から移した。取引が作ったコントラクトと同じ処理）で Contract に入る
- `lib/sync/erc1155.ts`: `erc1155TransfersFromLog()`、`erc1155Balances()`、`syncErc1155Range()`（登録・置き換え・保有者の再計算）、`syncErc1155ToConfirmedHead()`。`tools/tokens.ts` が起動時と 1 分ごとに呼ぶ（`--sync-erc1155` で 1 回）
- API: `getInternalTransactions()` / `transferKindFilter()`（account.ts）、v2 の `internalTransactionItem()` / `internalErrorFlags()`（common.ts）、`lib/api/erc1155.ts`。画面: 取引ページの Internal Transactions（既定は値の移動だけ、全件に切り替え可）、アドレスページの「Internal Txns」タブ（`components/InternalTransactionsTab.tsx`）
- テスト: `tests/sync/internal-transactions.test.ts`（本番の実トレース `tests/fixtures/ovbc-traces.json`）、`tests/sync/erc1155.test.ts`、`tests/sync/reorg.test.ts`、`tests/api/internal-and-1155.test.ts`

### 本番反映時の注意
- 反映前に mongodump（`Contract`・`tokens`・`tokentransfers`・`tokenholders`・`scan_progress` に書く）。`config.json` に `"traces": { "url": "/home/aoi/.local/share/openvirbicoin/jsonrpc.ipc" }` を足す（ovbc の再起動・設定変更は不要）
- `pm2 start ecosystem.config.json --only internal-txs && pm2 save`。`sync` は再起動する（`replaceBlock()` の内部取引の削除と巻き戻しを有効にするため）。`tokens` と `explorer` も再起動する
- 確認: `npm run internal-txs -- --status` の `lastScannedBlock` が先端 − 13 付近、`documents` が約 11,000、`skipped` が空。`txlistinternal&txhash=<スワップの取引>` に値の移動が出る、`/api/v2/transactions/<hash>` の `has_error_in_internal_transactions` が true / false（null でない）
- ロールバック: 前の commit に戻してビルドし、`pm2 delete internal-txs`。`InternalTransaction` コレクションは旧コードが読まないので残してよい

## 修正（2026-11）: アンクル報酬を含む供給量・Next.js 16.4.6（v0.8.9）

Next.js を 16.4.6 に更新（16.4.4 以下に中程度の勧告 7 件）。`npm audit` に残る zod（web3 4.x → web3-validator が zod 3 系を要求し、修正は zod 4.6.6 以降のみ）は web3 側の対応待ち。2026-11-26 時点でも web3 4.16.0 / web3-validator 2.0.6 は zod ^3.21.4 のままで、`npm audit` の high 19 件はすべてこの経路（`npm audit fix --force` が示す web3 4.0.3 への格下げはしない）。同日、使っていなかった devDependency `postinstall`（2016 年の元プロジェクトから残っていたもの。glob / minimatch の勧告の経路）を外し、brace-expansion を範囲内の修正版にした（v0.8.10）。

`/api/total_supply` などの供給量がアンクル報酬とネフュー報酬を数えておらず、2026-11-24 時点で実際の発行量より 4% 以上少なかった（11 月以降はアンクルがほぼ毎ブロック付き、1 ブロックあたり約 7 VBC が上乗せで発行されている）ことへの対策。

### 設計ルール（必ず守る）
- **新規発行はブロック報酬とアンクル報酬だけ**。供給量 = premine + `calculateTotalMiningRewardWei(schedule, head)`（ブロック 1..head）+ `Block.uncleReward` の合計。式は `lib/reward-schedule.ts`（`getUncleRewardWei` = (uncle + 8 − block) / 8 × 報酬、`flatUncleRewardFrom` 以降は報酬 / 32（ETC の ECIP-1017）、`getNephewRewardWei` = 報酬 / 32、`calculateUncleIssuanceWei`）。VirBiCoin では go-virbicoin の `accumulateRewards` と同じで、本番ブロックの採掘者残高の増分と 1 wei まで一致することを確認済み
- **報酬スケジュールをコードに書かない**。値は `config.json` の `rewards`（`blockReward` = 適用開始ブロック → 報酬の表。OpenEthereum の chainspec の `blockReward` と同じ形で、16 進のブロック番号・wei も読める。`flatUncleRewardFrom`、`forkNames`）。サーバーは `getRewardSchedule()`（lib/config.ts）、画面は `/api/config/client` の `rewards` を `parseRewardSchedule()` に渡す。`rewards` が無ければ Ethereum のスケジュール（5 / 3 / 2 / 0）で、起動時に警告を出す。書き方の例（Ethereum・ETC・VirBiCoin）は README の「Block reward schedule」
- **供給量をルートごとに計算しない**。`lib/supply.ts` の `calculateTotalSupply()` / `calculateTotalSupplyWei()` / `calculateCirculatingSupplyWei()` を使う（`/api/v2/stats`、blockscout `ethsupply` も同じ値）。wei で返す API は wei 版を使い、`Math.floor` で端数を落とさない
- **採掘報酬を固定値で書かない**。mining API（`/api/address/[address]/mining`）と blockscout `getblockreward` は報酬スケジュール＋手数料（保存済み Transaction の gasUsed × gasPrice）＋ネフュー報酬で計算する。`getblockreward` の `blockReward` は Etherscan と同じく静的報酬＋手数料＋uncle inclusion reward
- `Block.uncleReward` は wei の 10 進文字列で、アンクルを持つブロックにだけ付く（スパース索引 `{ uncleReward: 1 }`）。アンクルの高さはブロックに含まれないので `ChainNode.getUncle()` でノードに問い合わせる（`lib/sync/uncle-rewards.ts`）
- `replaceBlock()` は**削除より前に**アンクルを取得し、失敗したら何も書かずに throw する（高さを半端に置き換えない）。一括同期（`tools/sync.ts`）は失敗時にフィールドなしで保存して warn し、埋め戻しツールが後で埋める。`upsertBlocks()` はアンクルのないブロックで `uncleReward` を `$unset` し、アンクルはあるが値のない文書では既存値を残す
- 埋め戻し（`npm run backfill-uncle-rewards`）はブロックごとにノードの正規ブロックと照合し、孤児ブロックには値を付けず失敗として報告する。書き込みは number と hash の両方で絞る

### 本番反映時の注意
- 反映前に mongodump。反映後、最初に起動したツールが `{ uncleReward: 1 }` のスパース索引を作る（`npm run optimize-indexes -- --check` で確認）
- `npm run repair-chain -- --check` が 0 → `npm run backfill-uncle-rewards -- --dry-run` で対象件数と量を確認 → 本実行（アンクル付きブロック 1 件あたり RPC 約 2 回。ローカルノードに対して実行する）。終了コード 1 なら `--from 0` で再実行
- `/api/total_supply?debug=true` の `uncleRewardsBackfill.lastScannedBlock` が先端近くまで進み、`uncleRewards` が 0 でないこと。CoinGecko / CMC に出る総供給量はアンクル分（数 %）増える
- ロールバック: 前の commit に戻せばよい（`uncleReward` フィールドとスパース索引は残っても旧コードは読まない）

## 新機能（2026-10）: 第 4 次修正 — .env 読み込み・全件カウント・nginx 例・README・token 整理（v0.8.8）

第 3 次の本番反映と運用タスク E-1〜E-4（njs フィルター、MongoDB 認証、crowdsec、mongod ログローテーション）で見つかった残件への対応。リポジトリ側はタスク A〜E、運用側（本番サーバー）はタスク F。

### 設計ルール（必ず守る）
- **tools は `.env` を自分で読む**。`tools/*.ts` の最初の import は `import '../lib/env';`（`process.loadEnvFile()` で `.env.local` → `.env` の順に読む。環境 > .env.local > .env で、既にある変数は上書きしない。ファイルがなければ何もしない）。dotenv は追加しない。ログに出すのはファイル名と MONGODB_URI のホスト・DB 名だけ（ユーザー名・パスワードは出さない）
- **既定の MongoDB URI を復活させない**。URI は `lib/db/uri.ts` の `resolveMongoUri()`（環境変数 → config.json の `${VAR}` 置換）だけが決め、空なら `MissingMongoUriError` で止まる（無認証の localhost へ接続しない）。`config.json` の `${MONGODB_URI}` が空に解決された場合も同じエラー。エラーメッセージに URI を含めない。資格情報を `ecosystem.config.json`・pm2 の env・README・コミット・ログ・チャットに出さない
- **フィルターなしの `countDocuments` を書かない**。総件数は `countAll()`（`lib/db/count.ts`、`estimatedDocumentCount`）。フィルター付きの `countDocuments(filter)` はそのまま（`estimatedDocumentCount` はフィルターを受け付けない）。ESLint の `no-restricted-syntax` が app/ lib/ models/ tools/ で引数なし・空オブジェクトの `countDocuments` をエラーにする。`/api/v2/blocks` の `hasNextPage` は `limit + 1` 件取得で判定
- **token レコードを削除しない**。コードのないアドレス（`eth_getCode` が `0x`）は `hidden: true, hiddenReason: 'no-code'` で非表示。tokentransfers が 1 件でもあるアドレス（selfdestruct の可能性）は自動で非表示にせず「要確認」として出す。`manual` と `no-code` は名前判定の自動パスで上書きしない（`STICKY_HIDDEN_REASONS`）
- **コードのないアドレスを token として作らない**。`POST /api/launchpad/register` は DB 照会・ファクトリー照会の前に `eth_getCode` を見て 404（`code: NO_CODE`。既存レコードがあっても 200 を返さない）、`registerFactoryToken()` は `skipped`、`tools/tokens.ts` は ERC-20 / VRC-721 / LP の作成前に確認
- `docs/njs/rpc-filter.js` の禁止プレフィックスや判定は変えない（本番と sha256 一致）。変える場合は本番への反映手順（cp → `nginx -t` → reload）を同じ PR に書く
- バックアップ・復元・mongosh の手順は資格情報をコマンド行に出さない形で書く（`mongodump --config <uri を書いた YAML>`、`set -a; . .env; set +a` → `mongosh --nodb --eval 'const db = connect(process.env.MONGODB_URI); …'`）。`-p password` の例は書かない。管理ユーザーのパスワードの置き場所は「サーバー管理者の手元」とだけ書く

### 実装の要点
- `lib/env.ts`: `loadEnvFiles({ cwd, files, log })`（import 時に実行）、`describeMongoUri()`（ホスト・DB・認証有無のみ）。`lib/db/uri.ts`: `resolveMongoUri()`、`MissingMongoUriError` / `InvalidMongoUriError`。`models/index.ts` の `connectDB()` は設定エラーを再 throw し、同期的に失敗した Promise をキャッシュしない（次の呼び出しで再試行できる）。`lib/config.ts` の `getMongoDBURI()` も空なら throw
- `lib/db/count.ts`: `countAll(model | collection)`。置換箇所: `/api/v2/blocks`（`limit + 1` 方式）、`/api/v2/stats`（Transaction / Account）、`/api/richlist`（Account）、`lib/stats.ts`（Account）、`lib/api/blockscout/handlers.ts` の getChainSize（Block / Transaction）、`tools/register-contracts.ts`
- `lib/security/display-name.ts`: `HiddenReason` に `'no-code'`、`hiddenNameLabel()` / `hiddenReasonDescription()`（理由別のバッジ文言）。`components/DisplayName.tsx` は `hiddenReason` を受け取り、token / address / contract ページが API の値を渡す
- `lib/launchpad/factory.ts`: `FactoryClient.getCode()`、`isContractCode()` / `hasContractCode()`。`lib/launchpad/sync.ts`: `RegistrationStatus` に `'skipped'`、`LaunchpadSyncResult.skipped`
- `tools/flag-spam-tokens.ts`: `--audit-code [--dry-run]`（`auditNoCode(dryRun, { getCode, batchSize })`。10 件ずつ、エラーは数えて続行、`needsReview` を別出し。本番の 6 件は旧 register API が creator の EOA 等を name Unknown / symbol UNKNOWN / totalSupply 0 で保存したもの）
- `docs/nginx-rpc.conf.example`: 本番と同じ構成（http 文脈の `js_import` / `limit_req_zone`、`location /` の OPTIONS → 204 / POST → `rewrite ^ /_rpc_post last` / GET → 4000、`/_rpc_post`、`/_rpc` に `subrequest_output_buffer_size 8m`）と検証コマンド（大きな応答の `cmp`、80 並列のレート制限）。`docs/nginx-explorer.conf.example` は real_ip を `snippets/cloudflare-real-ip.conf` の include で記述（Cloudflare の帯が増えたら crowdsec の whitelist と同時に更新）
- テスト: `tests/lib/env.test.ts`、`tests/db/db-connect.test.ts`（URI なしで reject）、`tests/tools/optimize-indexes.test.ts`（作業ディレクトリの `.env` から読む / 未設定で停止）、`tests/api/v2-blocks-stats.test.ts`、`tests/tools/flag-spam-tokens-audit-code.test.ts`、`tests/api/launchpad-register.test.ts`（404 `NO_CODE`、sync の `skipped`）、`tests/security/display-name.test.ts`（理由別文言）

### 本番反映時の注意
- 反映前に mongodump（上記の `--config` YAML 経由。アプリ用ユーザーで取れる）。`git pull --ff-only origin main` → `npm ci --include=dev` → `npm run check` → `npm test` → `npm run build`（NODE_ENV を export したシェルで `npm ci` を走らせない）
- pm2 の保存環境に残っている `MONGODB_URI`（2026-10-30 の応急処置）を外す: MONGODB_URI を export していないシェルで `pm2 delete sync stats richlist tokens price && pm2 start ecosystem.config.json --only sync,stats,richlist,tokens,price && pm2 restart explorer && pm2 save`。6 アプリが「MongoDB connected successfully」、`pm2 jlist` の pm2_env に MONGODB_URI がない、mongod.log の Authentication failed が増えないこと。`env -u MONGODB_URI npm run optimize-indexes -- --check` が 0。`/home/aoi/backup/pm2-restart-with-env.sh` は不要になる（削除するか「不要」と注記）
- `/api/v2/blocks?limit=10` を 10 回計測して全部 100 ms 未満。`/api/v2/stats` と `/api/richlist` の応答形は従来どおり
- `npm run flag-spam-tokens -- --audit-code --dry-run` で 6 件（name が Unknown の token）を確認してから本実行。`/api/tokens` から消え、それらへの register が 404 になること
- nginx: 本番の vhost と `docs/nginx-rpc.conf.example` の diff が server_name・証明書・ログ・ブロック数だけであることを確認（本番の設定変更は不要）。README のバックアップ手順をそのまま実行して成功すること
- 運用タスク F（F-1 crowdsec のデータファイル不整合、F-2 ovbc の `--jsonrpc-apis` 縮小＝再起動を伴うので要承認、F-3 Cloudflare 経由の遮断＝方針決定と API トークンが先、F-4 apt 保留更新・`pm2 reset rpc`）はユーザーが本番で実施する。推奨順は F-1 → F-4 → F-2 → F-3
- ロールバック: 前の commit に戻してビルド・再起動。旧コードは `.env` を読まないので pm2-restart-with-env.sh でツールアプリを起動する。hidden にした token は `flag-spam-tokens -- --address 0x... --unhide` で戻せる

## 新機能（2026-10）: 第 3 次修正 — Launchpad 認証・solc 分離・ページング・運用（v0.8.7）

第 2 次の調査で残った課題への対応。リポジトリ側はタスク A〜D、運用側（本番サーバー）はタスク E。

### 設計ルール（必ず守る）
- **クライアントが申告した値（creator、名前、供給量、メタデータ）をそのまま永続化しない**。Launchpad の登録は `resolveFactoryToken()`（`lib/launchpad/factory.ts`）でファクトリー（`launchpad.factoryAddress` ＋ `legacyFactories`）に `isFactoryToken()`（無い旧ファクトリーは `getAllTokens()` の包含）を eth_call し、`tokenInfo()` と token 本体の `totalSupply()` / `balanceOf(creator)` から値を取る。どのファクトリーも知らなければ 404
- **GET に書き込みの副作用を持たせない**。`GET /api/launchpad/sync` は `scan_progress`（`scanType: 'launchpad-sync'`）の最終同期時刻と結果を返すだけ。同期は `POST`（`write` バケット＋ 60 秒クールダウン → 429）か `tools/tokens.ts`（起動時＋毎時、`--sync-launchpad`）が `lib/launchpad/sync.ts` の `syncLaunchpadTokens()` を呼ぶ
- **solc をリクエストスレッドで実行しない。`solc.loadRemoteVersion` を使わない。sha256 を照合していないファイルを実行しない。nightly を許可しない**。コンパイルは `compileStandardJson()`（`lib/contract/compile-worker.ts`）のみ: worker_threads（`lib/contract/solc-worker.cjs`、`solc/wrapper` の `setupMethods`）、`resourceLimits.maxOldGenerationSizeMb` 1024、タイムアウト 60 秒で `worker.terminate()`、入力 500 KB・出力 20 MB、同時 1・待ち 5（超過は `CompileQueueFullError` → 503 + `Retry-After`）。コンパイラは `getCompiler()`（`lib/contract/compiler-cache.ts`）が `https://binaries.soliditylang.org/bin/list.json`（15 秒・2 MB）の `releases` にある版だけを取得し、`list.json` の sha256 と一致したときだけ `<cacheDir>/<version>.js` ＋ `<version>.sha256` に保存（読み出し時も再検証、同時ダウンロード 1、同一版は Promise 共有）。`grep -rn "solc\." app lib` はこの 2 ファイル以外で 0 件
- **ワーカー分離を「同時実行 1 のセマフォ」で代替しない**。`verify` バケットの `exclusive` は外した（`runExclusive` 自体は残る）
- **`limit` / `page` を読むルートは必ず `validatePagination(page, limit, maxLimit, { defaultLimit })`** を通し、`rejectDeepPagination()`（`page × limit` > 100,000 → 400）を続ける。DataTables の `start` / `length`（`/api/richlist` POST）も同じ
- DB 接続は `models/index.ts` の `connectDB()` だけが `mongoose.connect` を呼ぶ。`lib/db/connection.ts` はそのラッパー（プール設定は `config.database.options` の 1 箇所）
- 攻撃元 IP の遮断、ovbc / MongoDB の再起動、`--jsonrpc-apis` の縮小はコードでやらない（運用で判断）

### 実装の要点
- `lib/launchpad/factory.ts`: `FactoryClient`（`call(to, data)`、既定は `lib/web3/provider.ts` の Web3 シングルトン。revert / JSON-RPC エラーは '0x'、接続失敗は `FactoryRpcError` → 503）、`getLaunchpadFactories()`、`resolveFactoryToken()`、`describeFactoryToken()`、`listFactoryTokens()`、`readBalanceOf()`。ABI は ethers `Interface` の human-readable 断片
- `lib/launchpad/sync.ts`: `registerFactoryToken()`（新規はチェーン値＋ `hiddenFields()` ＋ `factory` / `factoryVerified: true`、creator の実残高で TokenHolder。既存は `factoryVerified` / `factory` を付けるだけで名前や帰属は書き換えない）、`syncLaunchpadTokens()`、`getLaunchpadSyncStatus()`
- `tokens` に `factory`（小文字）と `factoryVerified`（true / false / 未設定）を追加。`/api/tokens/[address]` は `source` / `factory` / `factoryVerified` を返し、`TokenDetailClient` は `source === 'launchpad' && factoryVerified === false` で「ファクトリー外」バッジ。`npm run flag-spam-tokens -- --audit-launchpad [--dry-run]` が Launchpad 由来トークンをファクトリーに照会して記録する（非表示にするかは別判断）
- `CreateTokenForm.tsx` は `tokenAddress` だけを送り、404 なら「トークンのデプロイがまだ確定していません」と表示して 12 秒間隔で最大 3 回再試行
- `config.compiler`（`cacheDir` 既定 `~/.cache/vbc-solc`、`SOLC_CACHE_DIR` で上書き / `concurrency` / `maxQueue` / `timeoutMs` / `maxOldGenerationSizeMb` / `allowedVersions`）を `lib/config.ts` の `getCompilerConfig()` が既定値付きで返す。`next.config.ts` は `outputFileTracingIncludes` でワーカーと `solc` を standalone に含める。`/api/compile` はコンパイルしない（検証データの参照）
- `tools/stats.ts`: `RESCAN_FROM=<height>`（`RESCAN_INTERVAL` で間隔）を追加。RESCAN 系は完了時に exit、BlockStat は `bulkWrite` の upsert で再計算（insertMany ＋ E11000 無視は撤去）。`tools/repair-chain.ts` は `RESCAN_FROM=<minReplaced> npm run stats` と等価な `RESCAN=100:<ceil((head − minReplaced) / 100) + 10>` を案内（`lib/sync/chain-check.ts` の `rescanHint()`）
- 運用タスク E-1 の収録物: `docs/njs/rpc-filter.js`（禁止プレフィックス `trace_` / `parity_` / `debug_` / `personal_` / `admin_` / `miner_` を先頭の定数に集約。バッチ対応、本文未バッファ 413、JSON 不正 400 / -32700、method 非文字列 400 / -32600、禁止 403 / -32601、許可は `r.subrequest('/_rpc')` で透過）と `docs/nginx-rpc.conf.example`。純粋関数 `classify()` は `tests/ops/rpc-filter.test.ts` で Node から検証
- テスト: `tests/launchpad/{fake-factory,factory.test}.ts`（偽ファクトリー世界＋モック JSON-RPC ノード）、`tests/api/launchpad-register.test.ts`、`tests/contract/{compiler-cache,compile-worker}.test.ts`（フィクスチャサーバーと同梱 `node_modules/solc/soljson.js`）、`tests/security/validation.test.ts`（limit 丸め・page 正規化・maxOffset）、`tests/sync/chain-check.test.ts`（`rescanHint`）、`tests/db/db-connect.test.ts`

### 本番反映時の注意
- `config.json` に `compiler` セクションを追加し、キャッシュディレクトリ（既定 `~/.cache/vbc-solc`）を explorer の実行ユーザー所有で作る。初回の検証リクエストで対象版をダウンロードする（外向き https が必要）
- 反映後の確認: 任意アドレスの `POST /api/launchpad/register` が 404、ファクトリー製の既存トークンは 200、`GET /api/launchpad/sync` 前後で `tokens` / `tokenholders` の件数が不変。検証 API を 3 並列で送りながら `/api/v2/blocks` が 200 ms 未満、キャッシュに `<version>.js` と `<version>.sha256`。`/api/richlist?limit=100000` が 100 件、`page=0` が 1 ページ目、深いページが 400。`npm run flag-spam-tokens -- --audit-launchpad --dry-run` で対象を確認してから本実行
- 公開 RPC の njs フィルター（E-1）は `apt install libnginx-mod-http-js` → スクリプト配置 → vhost 変更 → `nginx -t` → reload。ovbc の起動オプションは変えない。E-2（MongoDB 認証）・E-3（crowdsec バウンサー）・E-4（mongod ログローテーション）は指示書の手順に従い、停止を伴うものはユーザー承認のうえで実施する

## 新機能（2026-10）: 第 2 次セキュリティ修正 — SSRF・リオーグ・レート制限・URL 名トークン（v0.8.6）

2026-10-24 の偵察（tokenURI 由来 URL のサーバー側取得で 127.0.0.1 の各ポートを探られた）と、リオーグ未対応により DB に残った孤児ブロック 3,101 箇所への恒久対策。

### 設計ルール（必ず守る）
- **チェーン由来の文字列を URL として取得するのは `safeFetchJson()`（`lib/security/safe-fetch.ts`）だけ**。https のみ（`ipfs://` は `images.ipfsGateway` へ変換）、IP リテラルのホスト禁止、`dns.lookup` の全アドレスを非公開帯（127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, 224/4, 240/4, ::1, ::, fc00::/7, fe80::/10, マップ済み IPv4 等）で検証、解決済みアドレスに接続を固定（DNS リバインド対策）、リダイレクト追従なし、`application/json` 系のみ、256 KiB・5 秒上限、拒否は理由・URL・コントラクトを `logger.warn`。素の `fetch()` でチェーン由来 URL を叩かない
- tokenURI は **ERC-721/1155 と判定できたコントラクトだけ**読む（DB の `Contract.ERC` / `type`、不明なら ERC-165 `supportsInterface`）。取得した metadata は name/description/image/attributes のみ、長さ上限付きで返す（`lib/services/nft-metadata.service.ts`）。`{tokenId}.json` フォールバックは廃止
- **`X-Forwarded-For` を再び読まない**。レート制限は「レート制限」節のとおり
- **`insertMany` と E11000 無視を復活させない**。Block は number、Transaction は hash をキーに upsert（`lib/sync/reorg.ts`）。`Transaction.hash` の unique は維持
- 高さの差し替えは `replaceBlock()` 経由（孤児 tx と tokentransfers の削除、正規ブロック/tx の upsert、BlockStat 削除、tokens スキャンの巻き戻し、`logger.warn` のリオーグイベント）
- `tokens` / `Contract` に名前を書くときは `hiddenFields()`（`lib/security/display-name.ts`）を通す。一覧 API は `hidden: { $ne: true }`、詳細 API はフラグ付きで返し、画面は `components/DisplayName.tsx` で描画（制御文字除去・長さ上限・リンク化しない・hidden はバッジ＋短縮アドレス）。公開 API に `includeHidden` は作らない
- 攻撃元 IP や作成者アドレスをコードで遮断しない（Cloudflare / ufw の運用で行う）

### 実装の要点
- `lib/security/url.ts`: ブラウザでも使える URL 判定（`parseSafeHttpsUrl`、`isPrivateIp`、`resolveIpfsUrl`）。`isValidImageUrl` も同じ判定を使う（IP リテラル・認証情報入り URL を拒否）
- `lib/contract/erc.ts`: `Contract.ERC` の値（2 / 721 / 1155）と ERC-165 インターフェース ID の定数
- `next.config.ts`: `images.remotePatterns` は自ホスト・IPFS ゲートウェイ・`images.allowedHosts` のみ（チェーン由来画像は `unoptimized`）
- `lib/sync/`: `normalize.ts`（ノード→DB ドキュメント）、`reorg.ts`（upsert / `replaceBlock` / `findCommonAncestor` / `handleReorg` / `processNewBlock` / `verifyConfirmationWindow` / リスナー位置の永続化）、`chain-check.ts`（`checkChain` / `sampleAgainstNode` / `repairChain`）、`web3-node.ts`（web3 v4 アダプタ）。リスナーは新ブロック N の parentHash と DB の N-1 を比較し、不一致なら共通祖先（最大 `maxReorgDepth`=64）まで遡って置換。毎ポーリングで head−`confirmations`（既定 12）..head も照合。設定は `config.json` の `sync` か `SYNC_CONFIRMATIONS` / `SYNC_MAX_REORG_DEPTH`
- `tools/repair-chain.ts`: `--check`（number 昇順ストリームで欠落と parentHash 不一致を数える。不一致で exit 1）、`--sample k`、`--fix [--from] [--to] [--dry-run]`（共通祖先から連結が復元するまで置換、1 箇所 256 まで、`scan_progress` の `repair` で再開可、完了後に `--check` を自動実行）。本番ではローカルノードに対してのみ実行する
- `tools/flag-spam-tokens.ts`: Contract / Token 全件に `classifyDisplayName` を適用（`--dry-run`、`--address --hide|--unhide`、`--unhide-all`。`manual` フラグは自動判定で上書きしない）
- `tools/stats.ts` は import 時に接続しない（sync.ts が全モードで stats の初期化を走らせ、ログのラベルが `tool: 'stats'` に固定されていた）。`tools/sync.ts` は環境変数 `MONGODB_URI` を config.json より優先し、`${VAR}` プレースホルダを解決する
- テスト: `tests/security/{url,safe-fetch,rate-limits,display-name}.test.ts`、`tests/services/nft-metadata.test.ts`、`tests/sync/{reorg,chain-check}.test.ts`（モックノード＋mongodb-memory-server）、`tests/api/hidden-tokens.test.ts`

### 本番反映時の注意
- nginx の explorer vhost に `proxy_set_header X-Client-IP $http_cf_connecting_ip;` と `X-Forwarded-For` / `X-Real-IP` の上書きを入れる（`docs/nginx-explorer.conf.example`）。入れないと全リクエストが `unknown` バケット（上限 1/10）になる
- nginx の `location` は **末尾スラッシュなしの prefix（`location ^~ /api/tokens`）** で書く。`location /api/tokens/ {` と書くと nginx が `/api/tokens` に 301（`/api/tokens/` へ）を返し、Next.js の 308 と無限リダイレクトになって `/tokens` ページが空になる（2026-10-28 に本番で発生）
- 反映後に `npm run flag-spam-tokens -- --dry-run` で対象（本番 19 件）を確認してから本実行、`npm run repair-chain -- --check` → `--fix --dry-run` → `--fix` → `--check` が 0、`--sample 1000` が 0 を確認。実行前に Block / Transaction / BlockStat を mongodump する
- `/api/tokens/<addr>?tokenId=1` を 19 件のいずれかに実行しても metadata は null（ERC-20 判定なので tokenURI は呼ばれない）

## 新機能（2026-10）: DB インデックス管理とモデル一本化（v0.8.5）

本番 explorerDB にインデックスが 1 本もなく（`_id` のみ）、Block.number 検索が 325 万件の全件走査になっていた問題の恒久対策。スキーマにはインデックス定義があったが、それを DB に反映する経路が存在しなかった（`autoIndex: false` かつ `createIndexes()` 呼び出しなし、旧 optimize-indexes は存在しない `blocks` コレクションを対象にしていた）。

### 設計ルール（必ず守る）
- **モデルは `models/index.ts` のみ**。API ルートやツールに inline の `mongoose.models.X || mongoose.model('X', schema)` を書かない（`grep -rn "mongoose.model("` が models/index.ts 以外で 0 件であること）。`lib/models.ts` は re-export のみ
- **コレクション名は `{ collection }` で明示**し、本番実在名（Block, Transaction, Account, Contract, BlockStat, Market, DexSwap, VerificationJob, tokens, tokentransfers, tokenholders, scan_progress）に合わせる。`tests/db/model-collections.test.ts` の allowlist を更新しない限り新しい名前は使えない
- **インデックスはスキーマで定義**し、実クエリ（`find` / `findOne` / `aggregate` / `sort` のキー）に根拠があるものだけ持つ。根拠は `models/index.ts` のコメントと README「Database Indexes」に記載
- **`autoIndex` は false のまま**。作成は `ensureIndexes()`（models/index.ts）が行い、呼び出すのは DB に書くツールだけ（tools/sync.ts の全モード、stats、richlist、tokens、price、rescan-contracts、register-contracts、add-token）。Next.js（app/）からは呼ばない
- **`Model.syncIndexes()` は使わない**（スキーマにないインデックスを削除する）。`background: true` も渡さない（MongoDB 4.2 以降無視）
- **アドレス/ハッシュの検索は小文字の等価比較**。`$regex: new RegExp(`^${addr}$`, 'i')` はインデックスが効かないので書かない（書き込み側はすべて小文字で保存し、スキーマも `lowercase: true`）

### 実装
- `lib/db/indexes.ts`: 汎用ヘルパー。`schemaIndexSpecs()` でスキーマのインデックスを列挙し、`ensureModelIndexes()` が不足分を 1 本ずつ作成。unique は事前に `$group`（`allowDiskUse` + `maxTimeMS`）で重複を数え、あればそのインデックスだけ `skipped` に積んで続行。E11000 / IndexOptionsConflict(85) / IndexKeySpecsConflict(86) は warn、それ以外は error で続行し `{ created, existing, planned, skipped, failed }` を返す（throw しない）
- `models/index.ts`: `ensureIndexes()`（`SKIP_INDEX_SYNC=1` で no-op）、`checkIndexes()`（不足一覧・読み取り専用）、`ensureIndexesOnStartup(tool)`（プロセスごとに 1 回だけ実行し summary をログ）、`ALL_MODELS` / `MODEL_COLLECTIONS`
- `tools/optimize-indexes.ts`: ラッパー CLI。引数なしで作成（失敗または unique 見送りがあれば exit 1）、`--dry-run` で作成予定（不足 unique の重複チェックも実施）、`--check` で不足検査（不足があれば exit 1）。スキーマに表せないインデックスは同ファイルの `extraIndexes`（現在は空）に理由付きで列挙する
- 主な修正: `BlockSchema.index({ miner: 1, blockNumber: -1 })` → `{ miner: 1, number: -1 }`（Block に blockNumber は存在しない）、Block.hash を unique に、TokenTransfer を実在の `tokentransfers`（tokenAddress / transactionHash 形）へ、CSV エクスポートの `tokentxs` も実在コレクションを読むように修正。マイナー別ブロック一覧の sort を timestamp → number、アドレス別トランザクション一覧の sort を timestamp → blockNumber/transactionIndex に変更（順序は同じ。インデックスで並ぶ）
- テスト: `tests/db/indexes.test.ts`（作成・冪等性・重複スキップ・dry-run・SKIP）、`tests/db/model-collections.test.ts`（allowlist）、`tests/tools/optimize-indexes.test.ts`（CLI を子プロセスで起動し exit code を検証）。mongodb-memory-server は初回に MongoDB 8.0.12 のバイナリをダウンロードする（`MONGOMS_SYSTEM_BINARY=/usr/bin/mongod` でローカルのバイナリを使える）

### 本番反映時の注意
- 反映前に `npm run optimize-indexes -- --dry-run` で作成予定を確認し、Transaction.hash の重複（本番で 3 件）を除去してから `npm run optimize-indexes` を実行する。unique 対象に重複が残っていればそのインデックスだけ見送られ exit 1 になる
- 旧コードで保存された checksum 混在アドレス（miner / from / to）が残っている場合、小文字等価比較では一致しない。その場合は一度小文字へ正規化する（本リポジトリの書き込み経路はすべて小文字）
- `app/api/address/[address]/type/route.ts` の `contracts`（小文字）など、本番に存在しないコレクションを読む native アクセスが一部に残っている（今回の対象外）

## 新機能（2026-07）: Etherscan/BscScan ライク機能

### 取引履歴 CSV エクスポート
- `GET /api/address/[address]/export?type=txs|tokentxs&startblock=&endblock=` — Etherscan/BscScan 互換形式の CSV（UTF-8 BOM 付き、上限 5000 行・古い順）。Gtax/クリプタクト等の税務・会計ツールが取り込める
- 通貨シンボル入りヘッダ（`Value_IN(VBC)` 等）は `config.currency.symbol` 由来（ハードコードなし）
- Method 列は `lib/transaction-utils.ts` の `METHOD_IDS` で解決（未知セレクタは 0x プレフィクスのまま）
- CSV 生成は `lib/utils/csv.ts` の純関数群（`csvEscape` は数式インジェクション対策済み。テスト: `tests/lib/csv.test.ts`）
- UI: アドレスページ（ウォレット/コントラクト両ビュー）の Transactions タブ右上に「CSV (Transactions) / CSV (Token Transfers)」ボタン。ウォレットビューは Token Transfers タブにも配置。両ビューに実装があるため、変更時は 2 箇所とも更新すること（`AddressDetailClient.tsx` 内にコントラクト用とウォレット用の 2 つの描画パスがある）
- レート制限: 10 req/min（1 リクエストで最大 5000 行スキャンするため厳しめ）

### トランザクション入力データのデコード表示
- `GET /api/tx/[hash]` が `decodedInput` を返す: 宛先コントラクトが**検証済み**なら DB の ABI で `ethers.Interface.parseTransaction` により関数シグネチャ+引数を展開、未検証なら `METHOD_IDS` セレクタマップで関数名のみ解決（どちらも不可なら null）
- tx 詳細ページの Input Data セクションに Function シグネチャ + 引数テーブル（#/Name/Type/Data、address 型はリンク化）を表示。生 hex は従来どおり下に併記
- 一覧側の Method バッジ（アドレスページ・/transactions）は従来から存在（`getTransactionTypeGlobal`）

### トークン承認チェッカー（/approvals）
- BscScan の Token Approvals 相当。`GET /api/address/[address]/approvals` が ERC-20 `Approval` イベントを RPC の `eth_getLogs`（owner を indexed topic でフィルタ、ERC-721 Approval は topics 数=4 で除外）から全期間スキャンし、現在の `allowance` が非ゼロの (token, spender) を返す
- 結果は `apiCache` で 10 分キャッシュ（`?refresh=1` で破棄。Revoke 確定後の UI 再取得が使用）。レート制限 6 req/min。spender には `buildAddressTags` のラベルを付与
- ページ `/approvals`: 任意アドレスの閲覧可。**Revoke（approve(spender, 0)）は閲覧アドレス＝接続ウォレットのときのみ有効**。`?address=` クエリ対応（アドレスページから導線あり）。wagmi プロバイダは `lib/dex/providers` の `Web3Provider` を再利用
- 2^255 以上の allowance は「Unlimited」表示

### アドレスネームタグ（公開ラベル）
- `lib/address-tags.ts` の `buildAddressTags()` が config からタグを自動導出: DEX（Factory/Router/MasterChef/WVBC/リワード）、Launchpad（現行+legacy ファクトリ）、Bridge（vault/lockAndSwap、route id 付き）、`miners`、`knownTokens`。`config.json` の `addressTags` セクションで追加・上書き（`_comment` キーは無視される）
- `/api/config/client` が `addressTags`（小文字アドレス → ラベルの平坦マップ）を公開、クライアントは `hooks/useAddressTags.ts`（モジュールキャッシュ付き）で取得
- 表示箇所: アドレスページのヘッダ（ウォレット/コントラクト両ビュー）、トランザクション詳細の From/To
- テスト: `tests/lib/address-tags.test.ts`

## 新機能（2026-06）

### ブロック報酬のカウントダウン
- `config.json` の `rewards` で次に報酬が変わるブロック（`forkNames` があればフォーク名）までのライブカウントダウンと期間内の進捗を `/stats` ページに表示（2026-11 までは VirBiCoin の 8→1 VBC のスケジュールとフォーク名がコードに固定されていた）
- 計算は `lib/reward-schedule.ts`（`getNextRewardChange()`）。サーバー専用依存のない純粋モジュールで、クライアントコンポーネントからも利用可能
- コンポーネント: `components/HalvingCountdown.tsx`（`rewards` と通貨記号を props で受け取る）。ブロック高と平均ブロックタイムは既存の `GET /api/stats?enhanced=true`
- VirBiCoin の報酬スケジュールが変わったら（go-virbicoin / open-virbicoin のフォーク追加など）本番の `config.json` の `rewards` を更新する。コードは変えない（テスト: `tests/lib/reward-schedule.test.ts`）

## 新機能（2026-01）

### アドレスタイプによるリダイレクト
- `/address/[address]` は、アドレスタイプに応じて `/contract/` または `/token/` へ自動リダイレクト
- 軽量なタイプ判定 API を用いて `proxy.ts` で実装
- API エンドポイント: `GET /api/address/[address]/type` は `{ type: 'token' | 'contract' | 'wallet' }` を返す

### ガストラッカー
- slow/standard/fast/instant の各ティアによるリアルタイムのガス価格追跡
- API エンドポイント: `GET /api/stats/gas`
- ホームページに表示

### 日次統計
- 過去のトランザクション・ブロック統計
- API エンドポイント: `GET /api/stats/daily?period=7d|30d|90d`
- `/stats` ページにチャートで表示

### ネットワーク情報
- ノードバージョン、クライアント情報、ネットワーク詳細
- API エンドポイント: `GET /api/network/node`
- `/network` ページに表示

### コントラクト一覧
- 検証済み・未検証のすべてのコントラクトを閲覧
- API エンドポイント: `GET /api/contracts`
- ページ: `/contracts`

### 保留中トランザクション
- mempool 内の保留中トランザクションを表示
- API エンドポイント: `GET /api/transactions/pending`
- ページ: `/txs/pending`

### 動的設定
以前はコードに直接書かれていた値を、すべて `config.json` に集約しました。
- ネットワーク名、チェーン ID、RPC URL、エクスプローラー URL
- 通貨名、シンボル、小数桁数
- DEX コントラクトアドレス
- ソーシャルリンク

動的設定を使用するコンポーネント:
- `app/components/AddNetworkButton.tsx` - MetaMask へのネットワーク追加
- `api-docs/page.tsx` - API ドキュメント
- `dex/docs/page.tsx` - DEX ドキュメント
- `contract/verify/page.tsx` - Hardhat 設定例
- `network/page.tsx` - ネットワーク情報

## API レスポンス形式

### 標準レスポンス形式（`lib/api-response.ts`）
ページネーション対応のすべての API は統一されたレスポンス構造を使用します:

```typescript
// 成功レスポンス
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

// エラーレスポンス
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later.",
    "details": { "retryAfter": 60 }
  }
}
```

### レスポンスユーティリティ
```typescript
import {
  paginatedResponse,    // ページネーション付きデータレスポンス
  successResponse,      // ページネーションなしの成功
  errorResponse,        // カスタムエラー
  rateLimitResponse,    // 429 レート制限
  notFoundResponse,     // 404 not found
  internalErrorResponse, // 500 サーバーエラー
  ContractTypes,        // { VRC20: 'VRC-20', VRC721: 'VRC-721', ... }
  normalizeContractType // ERC20 → VRC-20 正規化
} from '@/lib/api-response';
```

### フロントエンド互換性
フロントエンドのページは新旧両方の形式に対応します:
```typescript
const data = await res.json();
const items = data.data || data.contracts || [];
const total = data.meta?.pagination?.total ?? data.total ?? 0;
```

## API エンドポイント

### トークン API
- `GET /api/tokens/[address]` - トークン詳細、保有者、転送、NFT アイテム
- クエリパラメータ: `holdersPage`, `holdersLimit`, `transfersPage`, `transfersLimit`, `nftsPage`, `nftsLimit`

### コントラクト API
- `POST /api/contract/verify` - コントラクトのソースコードを検証（単一ファイルと Standard JSON Input に対応）
- `GET /api/contract/[address]` - コントラクト情報を取得
- `GET /api/contract/status/[address]` - コントラクトの検証ステータスを取得
- `GET /api/contract/compiler-versions` - 検証に使える solc のリリース一覧（binaries.soliditylang.org の list.json、新しい順、`compiler.allowedVersions` で絞る）。検証画面の選択肢はここから取る（以前は 0.8.17〜0.8.30 の固定リストで、0.6 / 0.8 以外の指定は 0.8.30 にすり替えていた）

### コントラクト検証 API（Etherscan/Hardhat 互換）
- `POST /api?module=contract&action=verifysourcecode` - 検証のためコントラクトを送信（JSON ボディまたは form-urlencoded）
- `GET /api?module=contract&action=checkverifystatus&guid=...` - 検証ステータスを確認
- `GET /api?module=contract&action=getabi&address=...` - コントラクト ABI を取得
- `GET /api?module=contract&action=getsourcecode&address=...` - 検証済みソースコードを取得

**照合と上書きの禁止（2026-11、必ず守る）:**
- 検証が通るのは、コンパイルした runtime コードがチェーン上のコードと一致するときだけ（`matchRuntimeBytecode()`、`lib/contract/bytecode-match.ts`）。違ってよいのは immutable の位置（`immutableReferences` で 0 にそろえる）、リンクしたライブラリのアドレス（`linkReferences`）、partial match のときの末尾の CBOR メタデータだけ。4 つの検証経路（`/api/contract/verify`、Etherscan 形式、v2 の flattened-code / standard-input）はすべてこれを使う。部分文字列・先頭一致・類似度・先頭 80% 一致で通す判定を戻さない（以前はそれで偽のソースを検証済みにできた）
- **送られたソースをそのままコンパイルし、そのまま保存する**（単一ファイルは送られた文字列、standard JSON は入力全体）。2026-11 まではどの経路も NatSpec や最初の contract 以外の部分・非 ASCII 文字を削り、`throw` / `var` / pragma を書き換えてからコンパイルしていた。そのため完全一致（full match）にならず、`unicode"…"` の文字列を含むコントラクトは通らず、保存される「検証済みソース」が開発者の書いたものではなかった。画面の standard JSON は入力の最初のファイル（依存ファイル）だけを保存していた（テスト: `tests/api/contract-verify-source.test.ts`）
- 検証済みのコントラクトは検証し直さない（`isAlreadyVerified()`、`lib/contract/verified.ts`。Etherscan 形式は `Contract source code already verified`、画面は 409、v2 は 400）。2026-11-09 に検証済みの OsatoNFT（0xdd0b…）の名前とソースが別のソースで上書きされた
- `POST /api/contract/[address]` は置かない。リクエストの本文をそのまま Contract に upsert していたため、記録のないアドレスに「検証済み」の偽の名前・ソースを誰でも作れた（2026-10〜11 に 5 件。「Official VirBiCoin Bridge (Verified)」を名乗るものを含む）。Contract は同期ツールと検証経路だけが書く

**検証の設定の保存（2026-11）:**
- Contract に保存する optimizer の有無・runs・`evmVersion` は、照合に使った standard JSON から `compileSettingsRecord()`（`lib/contract/solc-utils.ts`）で求める。要求パラメータや固定値（以前は runs 200・paris）を保存しない。`evmVersion` を指定しない入力は `'default'`（getsourcecode では `Default`）
- standard JSON の `settings` を要求パラメータ（`evmversion` / `optimizationUsed` / `runs`）で上書きしない。パラメータは入力に無い項目を補うだけ（以前は必ず paris で上書きしていた）
- `optimizationRuns` / `evmVersion` / `license` は 2026-11 までスキーマに無く、保存時に Mongoose が捨てていた。画面の経路は standard JSON でもフォームの optimization を保存していた（本番の standard JSON の 12 件はすべて「無効」と記録、実際は有効）。保存済みのソースが standard JSON の記録は `npm run backfill-verification-settings` でその入力の設定とライセンスを入れられる。単一ファイルの記録は設定が分からないので、getsourcecode の `Runs` は空、v2 の `optimization_runs` / `evm_version` は null のまま（推測で埋めない）
- ライセンスの読み取りは `spdxLicense()`（standard JSON は各ファイルの本文から読む。JSON の文字列のまま正規表現を当てると `MIT\n//` のように読んでいた）
- コンストラクター引数は照合していないので保存しない（クライアントの申告値を事実として出さない）
- VirBiCoin の EVM は Constantinople。検証画面の EVM バージョンには petersburg / constantinople / byzantium も選べる（sugarnft の OsatoNFT は constantinople でコンパイルされている）

**対応コンパイラバージョン:**
- binaries.soliditylang.org の list.json にあるすべてのリリース（0.4 系から最新まで。nightly は不可。`compiler.allowedVersions` で絞れる）。一覧は `GET /api/contract/compiler-versions`
- `SOLC_RELEASES`（solc-utils.ts）は短い版から commit 付きの名前への対応表で、表示用。検証できる版を制限するものではない

**検証パラメータ:**
| パラメータ | 必須 | 説明 |
|-----------|----------|-------------|
| `contractaddress` / `address` | はい | コントラクトアドレス |
| `sourceCode` | はい* | Solidity ソースコード（単一ファイルモード） |
| `standardJsonInput` | はい* | Standard JSON Input（複数ファイルモード） |
| `compilerversion` / `compilerVersion` | はい | コンパイラバージョン（例: `v0.8.30+commit.73712a01` または `0.8.30`） |
| `contractname` / `contractName` | いいえ | コントラクト名（未指定の場合は自動検出） |
| `optimizationUsed` / `optimization` | いいえ | 最適化を有効化（`1`/`0` または `true`/`false`） |
| `runs` / `optimizationRuns` | いいえ | 最適化の runs（デフォルト: 200） |
| `evmversion` / `evmVersion` | いいえ | EVM バージョン（デフォルト: config.json の `compiler.defaultEvmVersion`、無ければコンパイラの既定。VirBiCoin の本番は `paris`） |
| `constructorArguements` / `constructorArguments` | いいえ | ABI エンコードされたコンストラクタ引数 |

*`sourceCode` または `standardJsonInput` のいずれかが必須です。

**Standard JSON Input 形式:**
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

**Standard JSON Input でのコントラクト名の形式:**
- `FileName.sol:ContractName`（例: `MyContract.sol:MyContract`）

### DEX API
- `GET /api/dex/pairs` - 取引ペア一覧
- `GET /api/dex/tokens` - トークン一覧
- `GET /api/dex/chart/[pair]` - 価格チャートデータ
- `GET /api/dex/external-price` - ネイティブコインの価格（出どころ付き。VBC は DEX）と DEX の TVL

### DEX API - GeckoTerminal 互換（フル V2 API）
どのエンドポイントも、アドレスパラメータを `ethers.isAddress()` で検証し、クエリパラメータをサニタイズします。
エラーレスポンスは標準の JSON:API 形式です: `{ errors: [{ status: "404", title: "..." }] }`

| エンドポイント | パラメータ | 制限 |
|----------|------------|--------|
| `/api/dex/geckoterminal/networks` | - | キャッシュ: 1 時間 |
| `/api/dex/geckoterminal/dexes` | - | キャッシュ: 1 時間 |
| `/api/dex/geckoterminal/pools` | - | キャッシュ: 30s |
| `/api/dex/geckoterminal/pool/[address]` | address（検証あり） | キャッシュ: 30s |
| `/api/dex/geckoterminal/token/[address]` | address（検証あり） | キャッシュ: 60s |
| `/api/dex/geckoterminal/ohlcv/[pool]` | timeframe, aggregate, limit, currency | limit: 1-1000, aggregate: 1-60, type: ohlcv_request_response |
| `/api/dex/geckoterminal/trades/[pool]` | limit, trade_volume_in_usd_greater_than | limit: 1-300 |
| `/api/dex/geckoterminal/simple/price` | addresses（カンマ区切り） | 最大 30 アドレス, format: { "0x...": "price" } |
| `/api/dex/geckoterminal/trending_pools` | page | page: 1-100 |
| `/api/dex/geckoterminal/new_pools` | page | page: 1-100 |
| `/api/dex/geckoterminal/search/pools` | query, page | query: 2-100 文字, page: 1-100 |
| `/api/dex/geckoterminal/info` | - | キャッシュ: 1 時間 |

### DEX API - CoinMarketCap 互換
- `GET /api/dex/cmc/summary` - DEX サマリー
- `GET /api/dex/cmc/ticker` - 価格/出来高付きの取引ペア
- `GET /api/dex/cmc/assets` - 上場アセット
- `GET /api/dex/cmc/trades/[pair]` - 最近の取引
- `GET /api/dex/cmc/orderbook/[pair]` - AMM オーダーブックのシミュレーション

### DEX API - DefiLlama 互換
- `GET /api/dex/defillama` - TVL 付きのプロトコル情報
- `GET /api/dex/defillama/tvl` - TVL（プレーンな数値）
- `GET /api/dex/defillama/pools` - プールデータ（yields 形式）
- `GET /api/dex/defillama/prices` - 信頼度付きのトークン価格
- `GET /api/dex/defillama/historical` - 過去の TVL（30 日）

### 統計 API
- `GET /api/stats` - ネットワーク統計
- `GET /api/stats/gas` - ガス価格トラッカー（slow/standard/fast/instant）
- `GET /api/stats/daily` - 日次統計（トランザクション、ブロック、ガス）

### ネットワーク API
- `GET /api/network/node` - ノード情報（バージョン、クライアント、ピア）

### コントラクト一覧 API
- `GET /api/contracts` - ページネーションとフィルタ付きで全コントラクトを一覧

### 保留中トランザクション API
- `GET /api/transactions/pending` - mempool 内の保留中トランザクション

### アドレスタイプ API
- `GET /api/address/[address]/type` - アドレスが token / contract / wallet のいずれかを判定

### CSV エクスポート API
- `GET /api/address/[address]/export?type=txs|tokentxs&startblock=&endblock=` - Etherscan/BscScan 互換 CSV（上限 5000 行）

### トークン承認 API
- `GET /api/address/[address]/approvals` - アクティブな ERC-20 allowance 一覧（`?refresh=1` でキャッシュ破棄）

### Etherscan / Blockscout 形式 API（`/api?module=&action=`）
`app/api/route.ts` が振り分け、処理は `lib/api/blockscout/`（`account.ts` / `handlers.ts` / `proxy.ts` / `shared.ts`）にある。対応している action の一覧は `app/api/route.ts` の先頭と README の「Etherscan API」節。

設計ルール（2026-11 に、形だけ互換で中身が違っていた箇所を直したときのもの。必ず守る）:
- **action は `app/api/route.ts` の表（`ACTIONS` / `POST_ACTIONS`、proxy は `PROXY_ACTIONS`）に 1 行で足す。** 引数は `Params`（`lib/api/blockscout/params.ts`）で読む。欠落・不正は `ParamError` を投げれば、振り分け側がエラーの形にする（proxy は JSON-RPC の `-32602`）。action ごとに「Missing / Invalid」の if を書かない（2026-11 までは 600 行近い if の連なりで、同じ検査が 40 か所以上あった）
- **エラーは `errorResponse(reason)`。** `message` に理由（Blockscout）、`result` に Etherscan の文言（`Error! Invalid address format`、`Contract source code not verified`、`Error! Missing Or invalid Action name` など。対応表は shared.ts の `ETHERSCAN_ERROR_TEXT`、無ければ理由と同じ文）。Hardhat / Foundry は `result` の文で判定するので、`result: null` に戻さない
- **プロキシはチェーンから読む。** `proxyInfo()`（handlers.ts → `lib/contract/proxy-detect.ts`。EIP-1967 実装 / beacon、EIP-1822、zos、EIP-1167）を getsourcecode の `Proxy` / `Implementation` と `verifyproxycontract` / `checkproxyverification`（OpenZeppelin upgrades の流れ）が使う。関係を DB に保存しない（アップグレードがすぐ反映されるように）。ノードへの呼び出しは `publicClient.request` 経由（viem の getCode などの高水準関数はテストのモックを通らない）
- **項目名と意味は Etherscan / Blockscout の公式に合わせる。データが無いものを別のデータで埋めない。** `txlistinternal` は `InternalTransaction`（コールトレース由来）、`token1155tx` は VRC-1155 の移動だけを返す。通常の取引を内部取引として返さない（利用側が同じ送金を二重に数える）
- **成否は `Transaction.status`（数値 1 / 0、レシートなしは null）から `txStatusFields()` で求める。** 真偽値との比較（`status === false`）は常に成功になる
- **トークン移動は `tokentransfers`、保有者は `tokenholders` から返す。** `Transaction` や `Account` から作らない。種別の絞り込みは `transferKindFilter()`（`lib/api/blockscout/account.ts`）だけを使う: `tokenId` なし = ERC-20（`tokentx`）、`tokenId` あり・`tokenType` なし = ERC-721（`tokennfttx`）、`tokenType: 'VRC-1155'` = ERC-1155（`token1155tx`）。`tokenId` の有無だけで NFT を判定しない（VRC-1155 が VRC-721 に混ざる）
- **一覧は `listOptions()` を通す**（`page` / `offset` / `sort` / `startblock` / `endblock`）。Etherscan と同じく既定・上限とも 10000 行（利用側は「返った件数 < offset」で終端を判断するので、黙って少なく返すと取りこぼす）。1000 行を超えるページは `bulk` バケット（10 回/分）にも数える。空の一覧は `emptyListResponse()`
- **`proxy` モジュールと `eth_*` action は `rpcResponse()`**（JSON-RPC の形に `status` / `message` を足したもの）。ノードの結果は加工せずに返し、パラメータは `toBlockParameter()` / `toQuantity()` で検証・正規化する。`eth_sendRawTransaction` は出さない（公開 RPC を使う）
- トークン種別は `ercTokenType()`（`lib/api/token-standard.ts`）で ERC 名にする。hidden のトークンは一覧から外す（コントラクトを名指しした `tokentx` だけは返す）
- `getLogs` はトピックを位置どおりにノードへ渡す（`and` のみ。`or` 演算子は拒否）。`address` もトピックも無い検索は受けない
- テストは `tests/api/etherscan-compat.test.ts`（DB は mongodb-memory-server、ノードは `publicClient.request` のスパイ）。action を足す・直すときはここに足す

ERC-20 の移動は**イベント 1 件につき 1 文書**（キーは `transactionHash` + `logIndex`、`lib/sync/token-transfers.ts`）。2026-11 までは `transactionHash` + `tokenAddress` がキーで、同じ取引の中で同じトークンが複数回動くと（DEX のスワップ、流動性の出し入れ、手数料付きトークン）1 件しか残らず、`tokentx`・トークンページ・CSV 出力から漏れていた（保有者の残高は全イベントから計算しているので正しかった）。守ること:
- 移動の文書は `erc20TransferFromLog()` で作り、`storeErc20Transfers()` で書く。キーを `transactionHash` + `tokenAddress` に戻さない
- `logIndex` のない ERC-20 の文書は旧形式。`tools/tokens.ts` は、そのトークンの全履歴を読み切れた回にだけ、新形式を書いてから旧形式を消す（`legacyErc20TransferFilter()`。NFT の文書は `tokenId` があるので対象外）。読み切れなかった回は移動・保有者・供給量のどれも書かない（旧形式と新形式を混在させない、欠けた履歴から残高を作らない）
- 本番反映時: 反映前に `tokentransfers` を mongodump。反映後の最初の VRC-20 更新（起動時と 5 分ごと。手動なら `npm run tokens -- --update-all-vrc20`）でトークンごとに置き換わる。確認は「`tokenId` がなく `logIndex` もない文書が 0 件」「置き換え前後で `tokentransfers` の件数が減っていない（増えるのが正常）」

### Blockscout v2 互換 API（`app/api/v2/`）
共通の部品は `lib/api/v2/common.ts`（`v2Route()` = レート制限・DB 接続・エラー応答、`v2Page()` / `paginate()` = ページ送り、`addressParam()` / `tokenInfo()` / `transactionItem()` / `tokenTransferItem()` = 一覧に埋め込むオブジェクト）。新しい経路はこれらを使って書く。

- 統計・ブロック: `stats`、`blocks`、`blocks/[numberOrHash]`、`blocks/[numberOrHash]/transactions`
- 取引: `transactions`、`transactions/[hash]`（一覧と同じ項目＋トークン移動 50 件）、`transactions/[hash]/token-transfers`、`transactions/[hash]/logs`（ノードのレシートから）、`transactions/[hash]/internal-transactions`
- アドレス: `addresses/[address]`、`…/transactions`、`…/tokens`（ページあり）、`…/token-balances`（配列、ページなし）、`…/token-transfers`、`…/counters`、`…/internal-transactions`
- 内部取引: `internal-transactions`（チェーン全体、新しい順）、`blocks/[numberOrHash]/internal-transactions`
- トークン: `tokens`、`tokens/[address]`、`…/holders`、`…/transfers`、`…/counters`
- 検索: `search`、`search/check-redirect`
- コントラクト: `smart-contracts`（検証済みの一覧）、`smart-contracts/[address]` と検証（`verification/via/flattened-code`、`verification/via/standard-input`）

設計ルール（必ず守る）:
- **項目名は Blockscout の現行のもの**（`block_number`、`transaction_types`、`transaction_hash`、`address_hash`、`holders_count` など）。Blockscout 7 より前の名前（`block`、`tx_types`、`tx_hash`、`address`、`holders`）は既存の利用者のために併記している。本家の応答（例: `https://eth.blockscout.com/api/v2/…`）と突き合わせて決める
- **`next_page_params` は、そのまま次の要求のクエリにすると次ページが返る値にする。** Blockscout の利用側はこれを機械的に送り返す。この実装が読むのは `page` と `limit` なので、必ずその 2 つを入れる（`paginate()` が入れる）。`block_number` や `index` は位置の目安として併記するだけ。1 ページは 50 件（`limit` で小さくできる）。次ページの有無は 1 件多く取って判断し、件数を数えない
- **持っていないデータは null か空にする。作らない。** 索引器がまだ届いていない取引の `has_error_in_internal_transactions` は null（`internalErrorFlags()`）、VRC-721 の移動の `log_index` は null、アドレスの `is_contract` / `is_verified` / `name` は `loadAddressFacts()`（Contract・tokens・Account.type）から引く。hidden の名前は返さない
- ERC-1155 の保有は token id ごとに 1 行（`erc1155HoldingsOf()`、`lib/api/erc1155.ts`。`tokenholders` は全 id の合計しか持たない）。移動の `total` は `{ decimals: null, token_id, token_instance, value }`
- `smart-contracts` の一覧と詳細は同じ形で返す: `license_type` は保存した SPDX を Blockscout の値にしたもの（`blockscoutLicenseType()`。`mit`・`gnu_gpl_v3` など、無ければ `none`。以前は一覧が常に `none`、詳細が `MIT` だった）、`compiler_version` は `v` 付き（`blockscoutCompilerVersion()`）
- トークン移動の並びは `timestamp` のみ（アドレス別・トークン別の索引で並ぶ）。全トークン横断の移動一覧（`/api/v2/token-transfers`）は、対応する索引が無いので作っていない
- テストは `tests/api/v2-lists.test.ts`（一覧・検索・カウンター）、`tests/api/v2-token-balances.test.ts`、`tests/api/v2-blocks-stats.test.ts`、`tests/api/internal-and-1155.test.ts`（内部取引・VRC-1155）

DefiLlama はこのエクスプローラーを VirBiCoin の Blockscout として登録しており（DefiLlama-Adapters の `projects/helper/utils/blockscout.js`）、アドレスのトークン自動検出で `token-balances` を呼んで `token.address_hash` / `token.type` / `value` を読む。2026-11 まではこの経路が無く 404 だった。

## コードスタイル

- フックを用いた関数コンポーネントを使用
- `.then()` より `async/await` を優先
- TypeScript の strict モードを使用
- ESLint ルールに従う（eslint-config-next）
- スタイリングには Tailwind CSS を使用
- 言語: 表向きの文字列はすべて英語で書く（UI 表示、README / AGENTS.md / docs、コードコメント、ツールのログ、コミットメッセージ、PR のタイトルと本文）。日本語を使うのは CLAUDE.md（このファイル）だけ

## アーキテクチャ改善提案

### 現在の課題

1. **コードの重複**
   - ~~トークン所有者の計算ロジックが API とツールの両方に存在~~ → ✅ `lib/services/nft.service.ts` に集約済み
   - ~~Solidity コンパイラ補助関数が複数の検証ルートで重複~~ → ✅ `lib/contract/solc-utils.ts` に集約済み
   - ~~`models/index.ts` と `lib/models.ts` にインターフェースの重複~~ → ✅ `lib/models.ts` は re-export に統一し、app/api・tools の inline 定義も撤去（2026-10）

2. **大きなファイル**
   - ~~`app/api/route.ts`（約 2040 行）~~ → ✅ 465 行へ分割（`lib/api/blockscout/` に account/handlers/proxy/verification/shared を分離）
   - `app/api/tokens/[address]/route.ts`（約 1500 行・残）
   - `tools/tokens.ts`（約 1550 行・残）

3. **DB アクセスの分散**
   - ~~API ルート全体で `mongoose.connection.db` を直接使用~~ → ✅ `lib/db/get-db.ts`（`getDb`/`requireDb`/`tryGetDb`）に集約済み
   - ~~複数の接続関数が並存~~ → ✅ `lib/db.ts` の `dbConnect` を `models/index.ts` の `connectDB` へ委譲し一本化

4. **テスト不足**
   - ~~自動テストが存在しない~~ → ✅ Vitest を導入（純粋ロジック中心＋mongodb-memory-server による DB/CLI テスト）
   - CI（`.github/workflows/lint.yml`）で `npm run check` の後に `npm run test` を実行

5. **型の不整合**
   - DB スキーマと API レスポンス型が別々に定義されている（残）

### テスト基盤（`tests/`）

- **ランナー**: Vitest 5（`vitest.config.ts`、`resolve.tsconfigPaths: true` で `@/` エイリアス解決）
- **対象**: 副作用のない純粋関数を中心にテスト
  - `lib/security/validation.ts`（アドレス/ハッシュ検証、ページネーション、画像 URL）
  - `lib/services/nft.service.ts`（NFT 所有者計算）
  - `lib/bigint-utils.ts` / `lib/utils/format.ts`（金額・表示整形、旧ドメイン logoUrl 正規化 `normalizeLegacyLogoUrl`）
  - `lib/transaction-utils.ts`（トランザクション種別判定）
  - `lib/logger.ts`（ログレベル判定）
  - `lib/db/get-db.ts`（DB ハンドルガード）
  - `lib/contract/solc-utils.ts`（コンパイラバージョン/メタデータ処理）
  - `lib/address/format.ts` / `lib/address/transfer-classification.ts`（表示整形・mint/burn 判定）
  - `lib/db/indexes.ts` / `models/index.ts`（インデックス作成・重複検出・allowlist。`tests/db/`、mongodb-memory-server 使用）
  - `tools/optimize-indexes.ts`（`tests/tools/`。子プロセスで CLI を起動し exit code を検証）
- **方針**: DB や RPC に依存する処理はサービス/ハンドラに寄せ、純粋ロジックを切り出してテスト可能にする。DB が必要なテストは mongodb-memory-server を使い、本番 DB には向けない

### 構造化ロギング（`lib/logger.ts`）

- 依存ゼロの軽量ロガー。`LOG_LEVEL` 環境変数でレベル制御（既定 `info`、テスト時は `error` のみ）
- サーバー側（API ルート・同期ツール・DB 層）では `console.*` ではなく `logger` を優先

```typescript
import { logger } from '@/lib/logger';
logger.info('MongoDB connected', { db: 'explorerDB' });
logger.error('Sync failed', { error });
```

### 提案アーキテクチャ（将来のリファクタリング）

```
lib/
  types/                    # ✅ 集約された型定義
    index.ts                # コア型（Block, Transaction, Account, Token など）

  db/                       # ✅ データベース抽象化レイヤー
    connection.ts           # シングルトン DB 接続マネージャー
    base-repository.ts      # 共通 CRUD 操作を備えたベースリポジトリ
    get-db.ts               # ✅ ネイティブ Db ハンドル取得（getDb/requireDb/tryGetDb）
    index.ts                # バレルエクスポート

  services/                 # ✅ ビジネスロジックレイヤー
    nft.service.ts          # NFT 所有者計算（共有）
    index.ts                # バレルエクスポート

  api/blockscout/           # ✅ Etherscan 互換 API のドメイン別モジュール
    shared.ts               # 共有シングルトン（config/client/Token/応答ヘルパー）
    account.ts              # account アクション
    handlers.ts             # block/transaction/token/stats/logs/contract
    proxy.ts                # JSON-RPC プロキシ
    verification.ts         # コントラクト検証

  contract/
    solc-utils.ts           # ✅ Solidity コンパイラ補助（共有）

  address/
    format.ts               # ✅ アドレスページ向け表示整形・型
    transfer-classification.ts # ✅ mint/burn 判定（依存ゼロ・client 安全）

  logger.ts                 # ✅ 構造化ロガー

  utils/                    # ✅ ユーティリティ関数
    format.ts               # 整形ヘルパー（アドレス、時刻、数値）
    index.ts                # バレルエクスポート

app/
  api/
    route.ts                # ✅ 薄いディスパッチャ（465 行）
    tokens/[address]/
      route.ts              # ✅ NFT サービスを利用

tools/
  tokens.ts                 # ✅ 共有サービス/定数/ヘルパーを利用
```

### 残作業

```
lib/
  db/repositories/          # TODO: エンティティ固有のリポジトリ
    token.repository.ts     # Token 固有のクエリ
    block.repository.ts
    transaction.repository.ts
    holder.repository.ts

  services/                 # TODO: 追加サービス
    token.service.ts        # トークンデータの集約
    sync.service.ts         # ブロックチェーン同期ロジック
```

- `app/api/tokens/[address]/route.ts` / `tools/tokens.ts` のさらなる分割
- `any` 型の段階的削減（ESLint で `@typescript-eslint/no-explicit-any` を warn 計上中）
- DB スキーマと API レスポンス型の統一

### 使用例

**型を import:**
```typescript
import { Token, Transaction, Block, ZERO_ADDRESS } from '@/lib/types';
```

**NFT サービスを import:**
```typescript
import { getNftOwnershipFromDb, calculateNftOwnership } from '@/lib/services';
```

**DB ハンドルを取得:**
```typescript
import { getDb, requireDb, tryGetDb } from '@/lib/db';
```

**ユーティリティを import:**
```typescript
import { formatTokenBalance, timeAgo, shortenAddress } from '@/lib/utils';
```

### 移行状況

1. ✅ **フェーズ 1**: 型定義を統合した `lib/types/` を作成
2. ✅ **フェーズ 2**: 接続マネージャーとベースリポジトリを備えた `lib/db/` を作成
3. ✅ **フェーズ 3**: NFT サービスを備えた `lib/services/` を作成
4. ✅ **フェーズ 4**: Token API をサービス利用にリファクタリング
5. ✅ **フェーズ 5**: テスト基盤（Vitest）・構造化ロギング・DB ハンドル集約を整備
6. ✅ **フェーズ 6**: Etherscan 互換 API（`app/api/route.ts`）をドメイン別モジュールへ分割
7. ✅ **フェーズ 7**: モデル定義の一本化とスキーマ駆動のインデックス管理（2026-10, v0.8.5）
8. 🔄 **フェーズ 8**: リポジトリパターンと残る大型ファイルの分割（進行中）

### 利点

- **保守性**: 複数ファイルではなく一箇所の変更で済む
- **テスト容易性**: 純粋ロジックを個別に単体テストできる
- **一貫性**: 同じロジックがどこでも同じ結果を生む
- **型安全性**: 集約された型が不整合を防ぐ


## コミット署名（GPG）

このリポジトリのコミットは GPG 署名が有効です（`commit.gpgsign`）。AI エージェントは
秘密情報であるパスフレーズを代理入力できないため、gpg-agent のキャッシュが切れていると
`git commit` が署名失敗で中断することがあります。

- 署名が切れているときは、ユーザーがターミナルで一度パスフレーズを入力してください
  （`git commit` の再実行、または `echo test | gpg --clearsign` を一度実行）。一度
  入力すれば gpg-agent がしばらくキャッシュします。
- パスフレーズは秘密情報です。AI エージェントへ渡したりディスクへ保存したりしないで
  ください。
- コミット失敗を未然に防ぎたい場合は、コミット前にキャッシュを温める pre-commit フック
  （署名キャッシュが切れていればパスフレーズ入力を促す）を利用する方法があります。

## 関連リポジトリ

VirBiCoin エコシステムは以下のリポジトリで構成されています:

| リポジトリ | 役割 | ローカルパス | URL |
|-----------|------|-------------|-----|
| **virbicoin.com** | 公式 Web サイト（メインサイト。private） | `../virbicoin.com` | [github.com/virbicoin/virbicoin.com](https://github.com/virbicoin/virbicoin.com) |
| **go-virbicoin** | メインクライアント（Gvbc, Go 実装） | `../go-virbicoin` | [github.com/virbicoin/go-virbicoin](https://github.com/virbicoin/go-virbicoin) |
| **open-virbicoin** | Rust クライアント（Ovbc, OpenEthereum フォーク） | `../open-virbicoin` | [github.com/virbicoin/open-virbicoin](https://github.com/virbicoin/open-virbicoin) |
| **vbc-explorer** ← 本リポジトリ | ブロックチェーンエクスプローラー（DEX・Launchpad・ブリッジ画面を含む） | `../vbc-explorer` | [github.com/virbicoin/vbc-explorer](https://github.com/virbicoin/vbc-explorer) |
| **vbc-stats** | ネットワーク統計ダッシュボード | `../vbc-stats` | [github.com/virbicoin/vbc-stats](https://github.com/virbicoin/vbc-stats) |
| **vbc-stats-api** | VBC Stats 用ノードレポーター（組み込みレポーターのない Ovbc 向け） | `../vbc-stats-api` | [github.com/virbicoin/vbc-stats-api](https://github.com/virbicoin/vbc-stats-api) |
| **vbc-pool** | マイニングプール | `../vbc-pool` | [github.com/virbicoin/vbc-pool](https://github.com/virbicoin/vbc-pool) |
| **vbc-rpc** | RPC ノードステータスページ（公開 RPC・WebSocket の案内） | `../vbc-rpc` | [github.com/virbicoin/vbc-rpc](https://github.com/virbicoin/vbc-rpc) |
| **vbc-hash** | Ethash アルゴリズム実装（C/Go バインディング） | `../vbc-hash` | [github.com/virbicoin/vbc-hash](https://github.com/virbicoin/vbc-hash) |

### 依存関係

- **go-virbicoin** と **open-virbicoin**: 同じ VirBiCoin ネットワーク（chainId 329）の 2 つのクライアント実装（Gvbc は Go、Ovbc は Rust）。報酬・フォークブロックなどコンセンサスに関わる変更は必ず両方に同時に入れる
- **vbc-explorer** → ノードの JSON-RPC（Gvbc / Ovbc）。内部取引の索引は Parity 形式の `trace_transaction` を使うため Ovbc が必要（本番の explorer は Ovbc の IPC ソケットを読む）
- **vbc-stats** ← Gvbc は組み込みの ethstats レポーター（`--ethstats`）で直接報告し、Ovbc は **vbc-stats-api** を介して報告する
- **vbc-pool** → ノードの JSON-RPC（Gvbc / Ovbc。本番は両方）から作業を取得し、ブロックの確定と支払いを行う。シェアの検証は `proxy/miner.go` の純 Go 実装で、vbc-hash には依存しない
- **vbc-rpc** → 各ノードの JSON-RPC（8329）に状態を問い合わせるだけ。公開 RPC（rpc.virbicoin.com）への POST は nginx がノードへ中継し、このアプリを通らない
- **vbc-hash**: このワークスペースのどのリポジトリも import していない（Gvbc は `consensus/ethash`、vbc-pool は `proxy/miner.go` の自前実装）
- **virbicoin.com**: 静的サイト（他リポジトリへのリンクのみ）
- 公開リポジトリなので、private のリポジトリはこの表に載せていない（virbicoin.com は公開 Web サイトのソースとして載せる）。公開 README からは virbicoin.com の GitHub ではなく Web サイト（https://www.virbicoin.com）にリンクする
