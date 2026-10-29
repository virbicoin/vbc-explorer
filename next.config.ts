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
  // Turbopack is the default in Next.js 16, so provide a turbopack section
  turbopack: {
    resolveAlias: {
      // Resolve pino to its browser build for the WalletConnect dependency chain
      pino: { browser: './node_modules/pino/browser.js' },
    },
  },

  // Memory optimisation for production
  experimental: {
    // Reduce memory usage by tree-shaking large packages
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

  // Server-side packages that must not be bundled
  serverExternalPackages: ['mongoose', 'web3', 'pino', 'thread-stream', 'pino-pretty', 'solc'],

  // Solidity is compiled in worker_threads (lib/contract/solc-worker.cjs). The worker is started
  // by path and requires solc/wrapper itself, so the bundler never sees it; list both explicitly
  // so the standalone output traces and includes them
  outputFileTracingIncludes: {
    '/api/**/*': ['./lib/contract/solc-worker.cjs', './node_modules/solc/**/*'],
  },

  // Output size
  compiler: {
    // Strip console calls from production bundles
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Bundle size optimisation
  bundlePagesRouterDependencies: true,

  // Enable gzip compression
  compress: true,

  // Remove the X-Powered-By header
  poweredByHeader: false,

  // No browser source maps in production
  productionBrowserSourceMaps: false,

  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT,
    WEB3_PROVIDER_URL: process.env.WEB3_PROVIDER_URL,
  },
  webpack: (config, { isServer, webpack }) => {
    // Avoid native-module errors from lightningcss in the browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
    }

    // Treat lightningcss as an external
    config.externals = config.externals || [];
    config.externals.push({
      lightningcss: 'lightningcss',
    });

    // Alias lightningcss to an empty module
    config.resolve.alias = {
      ...config.resolve.alias,
      lightningcss: false,
    };

    // Ignore the lightningcss native module
    config.plugins.push(
      new webpack.IgnorePlugin({
        // webpack comes from the Next.js callback argument, not require('webpack')
        resourceRegExp: /lightningcss\.linux-x64-gnu\.node$/,
      })
    );

    // Ignore the lightningcss native module
    config.plugins.push(
      new webpack.IgnorePlugin({
        // webpack comes from the Next.js callback argument, not require('webpack')
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
