import type { NextConfig } from 'next';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'explorer.digitalregion.jp',
        pathname: '/img/**',
      },
      {
        protocol: 'https',
        hostname: 'sugar.digitalregion.jp',
        pathname: '/image/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'ipfs.io',
        pathname: '/ipfs/**',
      },
      {
        protocol: 'https',
        hostname: '*.ipfs.io',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'gateway.pinata.cloud',
        pathname: '/ipfs/**',
      },
    ],
  },
  /* config options here */
};

export default nextConfig;
