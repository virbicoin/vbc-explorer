# CLAUDE.md - VBC Explorer プロジェクトガイド

このファイルは、Claude Code（claude.ai/code）が本コードベースで作業する際のガイドです。

## プロジェクト概要

VBC Explorer は、VirBiCoin 向けのモダンなブロックチェーンエクスプローラーです（EVM 互換であれば他のネットワークでも動作します）。Next.js 16 App Router・TypeScript・MongoDB で構築しています。

主な機能は次のとおりです。

- NFT の表示・管理
- スマートコントラクトの検証
- DEX（分散型取引所）と Token Launchpad
- GeckoTerminal / CoinMarketCap / DefiLlama 互換の API エンドポイント

## 技術スタック

- **フレームワーク**: Next.js 16+（App Router）
- **言語**: TypeScript 7+（Go ネイティブ版 tsc。JS コンパイラ API は同梱されない）
- **データベース**: MongoDB（Mongoose 9）
- **スタイリング**: Tailwind CSS 4
- **Web3**: ethers.js 6, web3.js 4, viem 2, wagmi 3
- **状態管理**: @tanstack/react-query 5
- **テスト**: Vitest 4
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
  db/                   # データベース抽象化レイヤー
  dex/                  # DEX 固有ユーティリティ & キャッシュサービス
  security/             # 入力検証 & レート制限
  services/             # ビジネスロジックサービス
  types/                # TypeScript 型定義
  utils/                # ユーティリティ関数
  web3/                 # Web3 シングルトンプロバイダ
  bigint-utils.ts       # BigInt ユーティリティ
  client-config.ts      # クライアント側設定
  config.ts             # サーバー側設定
  db.ts                 # データベース接続
  etherUnits.ts         # 単位変換
  filters.ts            # データフィルタ
  launchpad-token-source.ts # Launchpad トークンデータ
  models.ts             # モデルインターフェース
  price-service.ts      # 価格データサービス
  reward-schedule.ts    # ブロック報酬スケジュール（純粋モジュール、クライアント/サーバー共用）
  stats.ts              # 統計ユーティリティ
  supply.ts             # 供給量計算
  transaction-utils.ts  # トランザクションユーティリティ
  
models/                 # Mongoose モデル
tools/                  # ブロックチェーン同期用 CLI ツール
  sync.ts               # ブロックチェーン同期
  tokens.ts             # トークンデータ同期（NFT/ERC20）
  stats.ts              # 統計計算
  richlist.ts           # リッチリスト生成
  price.ts              # 価格 + DEX スワップ同期
  register-contracts.ts # コントラクト登録
  optimize-indexes.ts   # データベースインデックス最適化
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
- `output: 'standalone'` - デプロイサイズを縮小
- `optimizePackageImports` - 大きなパッケージのツリーシェイキング
- `serverExternalPackages` - 重いサーバー依存のバンドルを防止
- `compress: true` - Gzip 圧縮を有効化

### データベースインデックス（`npm run optimize-indexes`）
- 一般的なクエリパターン向けの複合インデックス
- バックグラウンドでのインデックス作成（ノンブロッキング）
- 最良のパフォーマンスのため初期セットアップ後に実行

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
npm run price           # 価格 + DEX スワップデータを更新（WikaEx + オンチェーン）

# データベース管理
npm run optimize-indexes # DB インデックスを作成/最適化
npm run create-indexes   # データベースインデックスを作成

# PM2 プロセス管理
pm2 restart explorer    # explorer を再起動
pm2 logs explorer       # ログを表示
pm2 logs price          # 価格同期のログを表示
pm2 status              # サービス状態を確認
pm2 monit               # リソースを監視
```

## 価格 & DEX データアーキテクチャ

### 価格ソース（tools/price.ts, lib/price-service.ts）
価格は次の API を上から順に試し、最初に取得できた値を使います。
1. **CoinGecko** - `https://api.coingecko.com/api/v3/simple/price`
2. **CoinMarketCap** - 環境変数 `CMC_API_KEY` が必要
3. **Coinpaprika** - `https://api.coinpaprika.com/v1/tickers`
4. **WikaEx** - `https://wikaex.com/api/spot/coingecko/tickers`
5. **DEX フォールバック** - LP ペアのリザーブから算出するオンチェーン価格

`config.json` の `currency.priceApi` で設定します:
```json
"priceApi": {
  "coingecko": { "enabled": true, "id": "virbicoin" },
  "cmc": { "enabled": false, "id": "virbicoin" },
  "coinpaprika": { "enabled": true, "id": "vbc-virbicoin" },
  "wikaex": { "enabled": true, "symbol": "VBC" },
  "dex": { "enabled": true, "pairAddress": "0x..." }
}
```
- **更新間隔**: 価格は 5 分ごと、DEX スワップは 15 秒ごと

### 価格サービス（lib/price-service.ts）
すべての API ルートから価格データを取得するための共通モジュールです。
```typescript
import { getNativePrice, getPriceFromDatabase } from '@/lib/price-service';

// ソース情報付きの現在価格を取得
const priceData = await getNativePrice();
// 戻り値: { price: 0.000217, source: 'Market DB', timestamp: Date }
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

### レート制限
- クライアント IP ごとのトークンバケットアルゴリズム
- エンドポイントごとに上限を設定可能（デフォルト: 100 req/min）
- 機微なエンドポイントにはより厳しい上限:
  - コントラクト検証: 10 req/10s
  - コントラクト POST/更新: 10 req/min
  - コントラクト操作: 30 req/min
  - Blockscout API: 100 req/min
  - トークン残高: 60 req/min

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
- `tokens` - トークンメタデータ
- `tokentransfers` - トークン転送イベント
- `tokenholders` - トークン保有者残高
- `accounts` - アカウント残高
- `markets` - 複数ソースからの価格データ（price.ts が更新）
- `dexswaps` - DEX スワップイベント（price.ts が更新）

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

## 新機能（2026-07）: Etherscan/BscScan ライク機能

### 取引履歴 CSV エクスポート
- `GET /api/address/[address]/export?type=txs|tokentxs&startblock=&endblock=` — Etherscan/BscScan 互換形式の CSV（UTF-8 BOM 付き、上限 5000 行・古い順）。Gtax/クリプタクト等の税務・会計ツールが取り込める
- 通貨シンボル入りヘッダ（`Value_IN(VBC)` 等）は `config.currency.symbol` 由来（ハードコードなし）
- Method 列は `lib/transaction-utils.ts` の `METHOD_IDS` で解決（未知セレクタは 0x プレフィクスのまま）
- CSV 生成は `lib/utils/csv.ts` の純関数群（`csvEscape` は数式インジェクション対策済み。テスト: `tests/lib/csv.test.ts`）
- UI: アドレスページの Transactions タブ右上に「CSV (Transactions) / CSV (Token Transfers)」ボタン
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

### ハービングカウントダウン
- 次のブロック報酬削減フォーク（Quiche / Miche / Rusk / Celestia / Mafuyu / Kipfel / Lumina）までのライブカウントダウンとエラ進捗を `/stats` ページに表示
- 報酬スケジュール（8 VBC からブロック 4,200,000 を起点に 2,100,000 ブロックごとに 1 VBC ずつ減少、最低 1 VBC）は `lib/reward-schedule.ts` に集約。サーバー専用依存のない純粋モジュールで、クライアントコンポーネントからも利用可能
- `lib/api/blockscout/shared.ts` の報酬関数は `lib/reward-schedule.ts` からの再エクスポート（既存 API ハンドラのインポートは変更不要）
- コンポーネント: `components/HalvingCountdown.tsx`。データは既存の `GET /api/stats?enhanced=true`（`latestBlock` / `avgBlockTime`）を使用し、新規 API は不要
- go-virbicoin 側で報酬スケジュールが変更された場合は `lib/reward-schedule.ts` を更新すること（テスト: `tests/lib/reward-schedule.test.ts`）

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
- `AddVBCButton.tsx` - MetaMask へのネットワーク追加
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

### コントラクト検証 API（Etherscan/Hardhat 互換）
- `POST /api?module=contract&action=verifysourcecode` - 検証のためコントラクトを送信（JSON ボディまたは form-urlencoded）
- `GET /api?module=contract&action=checkverifystatus&guid=...` - 検証ステータスを確認
- `GET /api?module=contract&action=getabi&address=...` - コントラクト ABI を取得
- `GET /api?module=contract&action=getsourcecode&address=...` - 検証済みソースコードを取得

**対応コンパイラバージョン:**
- 0.8.15 - 0.8.33（完全な commit ハッシュマッピング付き）
- 0.6.12（レガシーサポート）

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
| `evmversion` / `evmVersion` | いいえ | EVM バージョン（デフォルト: `paris`） |
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
- `GET /api/dex/external-price` - 外部価格（WikaEx + DEX フォールバック）

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

## コードスタイル

- フックを用いた関数コンポーネントを使用
- `.then()` より `async/await` を優先
- TypeScript の strict モードを使用
- ESLint ルールに従う（eslint-config-next）
- スタイリングには Tailwind CSS を使用
- ロケール: ユーザー向け表示は日本語（ja）

## アーキテクチャ改善提案

### 現在の課題

1. **コードの重複**
   - ~~トークン所有者の計算ロジックが API とツールの両方に存在~~ → ✅ `lib/services/nft.service.ts` に集約済み
   - ~~Solidity コンパイラ補助関数が複数の検証ルートで重複~~ → ✅ `lib/contract/solc-utils.ts` に集約済み
   - `models/index.ts` と `lib/models.ts` にインターフェースの重複（残）

2. **大きなファイル**
   - ~~`app/api/route.ts`（約 2040 行）~~ → ✅ 465 行へ分割（`lib/api/blockscout/` に account/handlers/proxy/verification/shared を分離）
   - `app/api/tokens/[address]/route.ts`（約 1500 行・残）
   - `tools/tokens.ts`（約 1550 行・残）

3. **DB アクセスの分散**
   - ~~API ルート全体で `mongoose.connection.db` を直接使用~~ → ✅ `lib/db/get-db.ts`（`getDb`/`requireDb`/`tryGetDb`）に集約済み
   - ~~複数の接続関数が並存~~ → ✅ `lib/db.ts` の `dbConnect` を `models/index.ts` の `connectDB` へ委譲し一本化

4. **テスト不足**
   - ~~自動テストが存在しない~~ → ✅ Vitest を導入し純粋ロジックを中心に 151 テストを整備
   - CI（`.github/workflows/lint.yml`）で `npm run check` の後に `npm run test` を実行

5. **型の不整合**
   - DB スキーマと API レスポンス型が別々に定義されている（残）

### テスト基盤（`tests/`）

- **ランナー**: Vitest（`vitest.config.ts`、`vite-tsconfig-paths` で `@/` エイリアス解決）
- **対象**: 副作用のない純粋関数を中心にテスト
  - `lib/security/validation.ts`（アドレス/ハッシュ検証、ページネーション、画像 URL）
  - `lib/services/nft.service.ts`（NFT 所有者計算）
  - `lib/bigint-utils.ts` / `lib/utils/format.ts`（金額・表示整形、旧ドメイン logoUrl 正規化 `normalizeLegacyLogoUrl`）
  - `lib/transaction-utils.ts`（トランザクション種別判定）
  - `lib/logger.ts`（ログレベル判定）
  - `lib/db/get-db.ts`（DB ハンドルガード）
  - `lib/contract/solc-utils.ts`（コンパイラバージョン/メタデータ処理）
  - `lib/address/format.ts` / `lib/address/transfer-classification.ts`（表示整形・mint/burn 判定）
- **方針**: DB や RPC に依存する処理はサービス/ハンドラに寄せ、純粋ロジックを切り出してテスト可能にする

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
7. 🔄 **フェーズ 7**: リポジトリパターンと残る大型ファイルの分割（進行中）

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
| **virbicoin.com** | 公式 Web サイト（メインサイト） | `../virbicoin.com` | [github.com/virbicoin/virbicoin.com](https://github.com/virbicoin/virbicoin.com) |
| **go-virbicoin** | メインクライアント（Gvbc, Go 実装） | `../go-virbicoin` | [github.com/virbicoin/go-virbicoin](https://github.com/virbicoin/go-virbicoin) |
| **open-virbicoin** | Rust クライアント（Ovbc, OpenEthereum フォーク） | `../open-virbicoin` | [github.com/virbicoin/open-virbicoin](https://github.com/virbicoin/open-virbicoin) |
| **vbc-stats** | ネットワーク統計ダッシュボード | `../vbc-stats` | [github.com/virbicoin/vbc-stats](https://github.com/virbicoin/vbc-stats) |
| **vbc-explorer** ← 本リポジトリ | ブロックチェーンエクスプローラー | `../vbc-explorer` | [github.com/virbicoin/vbc-explorer](https://github.com/virbicoin/vbc-explorer) |
| **open-virbicoin-pool** | マイニングプール | `../vbc-pool` | [github.com/virbicoin/open-virbicoin-pool](https://github.com/virbicoin/open-virbicoin-pool) |
| **vbc-rpc** | RPC ノードステータス & JSON-RPC プロキシ | `../vbc-rpc` | [github.com/virbicoin/vbc-rpc](https://github.com/virbicoin/vbc-rpc) |
| **vbc-hash** | Ethash アルゴリズム実装（C/Go バインディング） | `../vbc-hash` | [github.com/virbicoin/vbc-hash](https://github.com/virbicoin/vbc-hash) |

### 依存関係

- **open-virbicoin**: go-virbicoin（Gvbc）と同じ VirBiCoin ネットワーク（chainId 329）に接続する代替クライアント（Ovbc, Rust 実装）
- **vbc-explorer** → **go-virbicoin**: JSON-RPC 経由でブロックチェーンデータを取得
- **vbc-stats** → **go-virbicoin**: Gvbc ノードが eth-netstats-client プロトコルでブロック/統計データを送信
- **open-virbicoin-pool** → **go-virbicoin**: マイニングプールが Gvbc ノードから作業を取得
- **vbc-rpc** → **go-virbicoin**: RPC プロキシが Gvbc ノードにリクエストを中継
