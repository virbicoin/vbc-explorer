/**
 * Optional parts of the explorer.
 *
 * Without them it is a plain block explorer: blocks, transactions, addresses, tokens and NFTs,
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
