import type { NextConfig } from 'next';
import fs from 'node:fs';
import path from 'node:path';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Hostnames next/image is allowed to optimize (fetch server-side): the
 * explorer's own host, the IPFS gateway and `images.allowedHosts` from
 * config.json. Chain-derived logo / metadata images are rendered with
 * `unoptimized`, so the optimizer never fetches an arbitrary host.
 */
function imageRemotePatterns(): Array<{ protocol: 'https'; hostname: string }> {
  const hosts = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    try {
      hosts.add(new URL(value.includes('://') ? value : `https://${value}`).hostname);
    } catch {
      // ignore malformed entries
    }
  };
  for (const file of ['config.json', 'config.example.json']) {
    const configPath = path.join(process.cwd(), file);
    if (!fs.existsSync(configPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      add(cfg?.explorer?.url);
      add(cfg?.images?.ipfsGateway ?? 'https://ipfs.io/ipfs/');
      for (const host of cfg?.images?.allowedHosts ?? []) add(host);
    } catch {
      // ignore malformed config
    }
    break;
  }
  if (hosts.size === 0) add('https://ipfs.io/ipfs/');
  return [...hosts].map((hostname) => ({ protocol: 'https', hostname }));
}

const nextConfig: NextConfig = {
  // Next.js 16でTurbopackがデフォルトのため、空のturbopack設定を追加
  turbopack: {
    resolveAlias: {
      // WalletConnect/pino依存関係を無視
      pino: { browser: './node_modules/pino/browser.js' },
    },
  },

  // 本番環境でのメモリ最適化
  experimental: {
    // メモリ使用量を削減 - 大きなパッケージを最適化
    optimizePackageImports: [
      'react',
      'react-dom',
      '@heroicons/react',
      'react-icons',
      'ethers',
      'viem',
      '@tanstack/react-query',
    ],
  },

  // 外部パッケージ設定（サーバーサイドでバンドルしない）
  serverExternalPackages: ['mongoose', 'web3', 'pino', 'thread-stream', 'pino-pretty', 'solc'],

  // solc のコンパイルは worker_threads（lib/contract/solc-worker.cjs）で実行する。ワーカーは
  // パス指定で起動し自身で solc/wrapper を require するため、バンドラからは見えない。
  // standalone 出力にも含まれるようトレース対象に明示する
  outputFileTracingIncludes: {
    '/api/**/*': ['./lib/contract/solc-worker.cjs', './node_modules/solc/**/*'],
  },

  // 軽量化設定
  compiler: {
    // 未使用コードの削除
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // バンドルサイズ最適化
  bundlePagesRouterDependencies: true,

  // 圧縮有効化
  compress: true,

  // PoweredByヘッダー削除
  poweredByHeader: false,

  // 静的ファイルの最適化
  productionBrowserSourceMaps: false,

  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT,
    WEB3_PROVIDER_URL: process.env.WEB3_PROVIDER_URL,
  },
  webpack: (config, { isServer, webpack }) => {
    // lightningcssのネイティブモジュールエラーを回避
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
    }

    // lightningcssのネイティブモジュールを完全に無視
    config.externals = config.externals || [];
    config.externals.push({
      lightningcss: 'lightningcss',
    });

    // lightningcssのネイティブモジュールを空のオブジェクトに置き換え
    config.resolve.alias = {
      ...config.resolve.alias,
      lightningcss: false,
    };

    // lightningcssのネイティブモジュールを無視するプラグインを追加
    config.plugins.push(
      new webpack.IgnorePlugin({
        // require()をwebpackインスタンスに変更
        resourceRegExp: /lightningcss\.linux-x64-gnu\.node$/,
      })
    );

    // lightningcssのネイティブモジュールを無視するプラグインを追加
    config.plugins.push(
      new webpack.IgnorePlugin({
        // require()をwebpackインスタンスに変更
        resourceRegExp: /lightningcss/,
      })
    );

    return config;
  },
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // Only the explorer host, the IPFS gateway and config `images.allowedHosts`
    // may be optimized; chain-derived images use `unoptimized` (see imageRemotePatterns)
    remotePatterns: imageRemotePatterns(),
  },
  /* config options here */
};

export default nextConfig;
