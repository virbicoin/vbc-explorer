/**
 * What runs: the optional parts of the explorer, the background jobs, and whether the web server
 * starts them. The one place that decides it from config.json.
 *
 * Optional parts: without them the explorer is a plain block explorer: blocks, transactions, addresses, tokens and NFTs,
 * contracts and their verification, stats, and the Etherscan / Blockscout APIs. Each part is
 * switched on in config.json; `proxy.ts` answers 404 for the pages and API routes of a part that
 * is off, the header hides its link, and the tools skip its work. Pure module (no fs), so client
 * components can use it with the `features` of `/api/config/client`.
 */

export type Feature = 'dex' | 'launchpad' | 'bridge' | 'richlist';

export type Features = Record<Feature, boolean>;

/** The config.json sections that switch the parts. */
export interface FeatureConfig {
  /** DEX pages, `/api/dex/*` (GeckoTerminal / CMC / DefiLlama), DEX price and swap sync. */
  dex?: { enabled?: unknown };
  /** Token Launchpad pages, `/api/launchpad/*` and the factory sync. */
  launchpad?: { enabled?: unknown };
  /** Bridge page. */
  bridge?: { enabled?: unknown };
  /** Richlist page, `/api/richlist` and the `richlist` tool (account balances). */
  richlist?: { enabled?: unknown };
}

/**
 * Which parts are on. DEX, Launchpad and Bridge need their section with `enabled: true` (they
 * also need contract addresses); the richlist is on unless `richlist.enabled` is false, as it
 * was before it could be switched off.
 */
export function resolveFeatures(config: FeatureConfig): Features {
  return {
    dex: config.dex?.enabled === true,
    launchpad: config.launchpad?.enabled === true,
    bridge: config.bridge?.enabled === true,
    richlist: config.richlist?.enabled !== false,
  };
}

/** The URL paths (pages and API) of each part. */
const FEATURE_PATHS: ReadonlyArray<readonly [string, Feature]> = [
  ['/dex', 'dex'],
  ['/api/dex', 'dex'],
  ['/launchpad', 'launchpad'],
  ['/api/launchpad', 'launchpad'],
  ['/bridge', 'bridge'],
  ['/richlist', 'richlist'],
  ['/api/richlist', 'richlist'],
];

/** The part a path belongs to, or null ("/dex/swap" is the DEX, "/dexes" is not). */
export function featureOfPath(pathname: string): Feature | null {
  for (const [prefix, feature] of FEATURE_PATHS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return feature;
  }
  return null;
}

/** Human-readable name of a part, for messages. */
export const FEATURE_NAMES: Record<Feature, string> = {
  dex: 'The DEX',
  launchpad: 'The Token Launchpad',
  bridge: 'The bridge',
  richlist: 'The richlist',
};

// ============================================
// Background jobs (tools/worker.ts runs the enabled ones; `npm run worker -- --plan` prints them)
// ============================================

export type JobName = 'sync' | 'tokens' | 'internal-transactions' | 'logs' | 'richlist' | 'price';

/** In start order. */
export const JOB_NAMES: readonly JobName[] = [
  'sync',
  'tokens',
  'internal-transactions',
  'logs',
  'richlist',
  'price',
];

export interface JobPlan {
  name: JobName;
  enabled: boolean;
  /** Why it runs or not, for the operator. */
  reason: string;
}

export interface JobConfig extends FeatureConfig {
  currency?: { priceApi?: Record<string, { enabled?: unknown } | undefined> };
}

export interface JobInputs {
  config: JobConfig;
  /** traces.url or TRACE_RPC_URL (getTraceSourceUrl()); null when there is none. */
  traceUrl: string | null;
  env?: Record<string, string | undefined>;
}

/**
 * The price sources tools/price.ts would ask: CoinGecko, CoinMarketCap (with CMC_API_KEY) and
 * Coinpaprika when their `enabled` is true, the DEX pool while the DEX is on and
 * `priceApi.dex.enabled` is not false.
 */
export function priceSources(
  config: JobConfig,
  env: Record<string, string | undefined> = {}
): string[] {
  const priceApi = config.currency?.priceApi ?? {};
  const sources = ['coingecko', 'coinpaprika'].filter(
    (source) => priceApi[source]?.enabled === true
  );
  if (priceApi.cmc?.enabled === true && env.CMC_API_KEY) sources.push('cmc');
  if (resolveFeatures(config).dex && priceApi.dex?.enabled !== false) sources.push('dex');
  return sources;
}

export function planJobs({ config, traceUrl, env = {} }: JobInputs): JobPlan[] {
  const features = resolveFeatures(config);
  const sources = priceSources(config, env);
  return [
    { name: 'sync', enabled: true, reason: 'blocks and transactions (always)' },
    {
      name: 'tokens',
      enabled: true,
      reason: `token discovery and updates (always)${features.dex ? '; DEX LP pairs' : ''}${
        features.launchpad ? '; Launchpad factories' : ''
      }`,
    },
    traceUrl
      ? {
          name: 'internal-transactions',
          enabled: true,
          reason: 'trace source configured (traces.url / TRACE_RPC_URL)',
        }
      : {
          name: 'internal-transactions',
          enabled: false,
          reason: 'no trace source: set traces.url in config.json or TRACE_RPC_URL',
        },
    { name: 'logs', enabled: true, reason: "event logs from the node's receipts (always)" },
    features.richlist
      ? { name: 'richlist', enabled: true, reason: 'account balances for the richlist' }
      : { name: 'richlist', enabled: false, reason: 'richlist.enabled is false' },
    sources.length > 0
      ? { name: 'price', enabled: true, reason: `price from ${sources.join(', ')}` }
      : {
          name: 'price',
          enabled: false,
          reason: 'no price source (currency.priceApi) and no DEX',
        },
  ];
}

/**
 * The jobs to start: the enabled ones, or with `only` exactly those (an unknown name throws).
 * `only` lets a job run alone, also one the config switches off.
 */
export function selectJobs(plan: JobPlan[], only?: string[]): JobName[] {
  if (!only || only.length === 0) return plan.filter((job) => job.enabled).map((job) => job.name);
  const unknown = only.filter((name) => !JOB_NAMES.includes(name as JobName));
  if (unknown.length > 0) {
    throw new Error(`Unknown job: ${unknown.join(', ')} (jobs: ${JOB_NAMES.join(', ')})`);
  }
  return JOB_NAMES.filter((name) => only.includes(name));
}

/**
 * Whether the web server starts the jobs (instrumentation.ts): in production unless
 * EXPLORER_WORKER=off (several web servers on one database, or the jobs run elsewhere with
 * `npm run worker`); in development only with EXPLORER_WORKER=on.
 */
export function workerWanted(env: Record<string, string | undefined> = process.env): boolean {
  const setting = env.EXPLORER_WORKER?.trim().toLowerCase();
  if (setting === 'off' || setting === '0' || setting === 'false') return false;
  if (setting === 'on' || setting === '1' || setting === 'true') return true;
  return env.NODE_ENV === 'production';
}
