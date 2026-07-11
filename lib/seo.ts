import type { Metadata } from 'next';
import { loadConfig } from '@/lib/config';

/**
 * Server-side SEO helpers shared by the dynamic entity pages
 * (block / tx / address / token).
 *
 * These build a per-entity document <title>, meta description, canonical URL
 * and Open Graph / Twitter tags so every entity page is individually
 * indexable and produces a proper link preview. The pages stay client-rendered;
 * only the <head> is produced on the server through each route's
 * generateMetadata() — which is what reaches non-JS scrapers (X / Discord /
 * Slack / Facebook) and gives correct titles in search results.
 *
 * The builders are PURE: a route looks up live data off the render path
 * (see lib/seo-data.ts) and passes an optional summary in. When no summary is
 * available the builder falls back to a param-only result, so enrichment is
 * always strictly additive and the page can never break on a DB hiccup.
 */

interface SiteSeo {
  explorerName: string;
  networkName: string;
  currencySymbol: string;
  decimals: number;
  baseUrl?: string;
}

function siteSeo(): SiteSeo {
  const config = loadConfig();
  const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
  const networkName = config.network?.name || config.currency?.name || 'Blockchain';
  const currencySymbol = config.currency?.symbol || '';
  const decimals = typeof config.currency?.decimals === 'number' ? config.currency.decimals : 18;

  let baseUrl: string | undefined;
  const rawUrl = config.explorer?.url;
  if (rawUrl) {
    try {
      baseUrl = new URL(rawUrl).origin;
    } catch {
      // Malformed explorer.url — fall back to relative URLs (no metadataBase).
    }
  }

  return { explorerName, networkName, currencySymbol, decimals, baseUrl };
}

/**
 * `metadataBase` for the root layout so that canonical and Open Graph URLs
 * resolve to absolute URLs. Returns `undefined` when no valid `explorer.url`
 * is configured (Next then falls back to its localhost default in dev).
 */
export function siteMetadataBase(): URL | undefined {
  const { baseUrl } = siteSeo();
  return baseUrl ? new URL(baseUrl) : undefined;
}

/** Shorten a 0x hash/address for display in a title: `0x1234…abcd`. */
export function shortenHex(value: string, lead = 6, tail = 4): string {
  if (!value) return value;
  const v = value.trim();
  if (v.length <= lead + tail + 1) return v;
  return `${v.slice(0, lead)}…${v.slice(-tail)}`;
}

/**
 * Format a wei-denominated amount as a human native-currency string with
 * thousands separators, e.g. `1,924,245.236517` (an optional `symbol` is
 * appended when given). Returns '' for zero, dust below display precision, or
 * unparseable input, so callers can simply omit an empty segment. Pure BigInt
 * math: no precision loss and no dependency on any currency init state.
 */
export function formatNativeAmount(wei: string, decimals = 18, symbol = ''): string {
  let v: bigint;
  try {
    v = BigInt(wei);
  } catch {
    return '';
  }
  if (v <= 0n) return '';

  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const fracDigits = (v % base).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  if (whole === 0n && fracDigits === '') return ''; // below display precision

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const num = fracDigits ? `${wholeStr}.${fracDigits}` : wholeStr;
  return symbol ? `${num} ${symbol}` : num;
}

/** Format a unix timestamp (seconds or ms) as an ISO `YYYY-MM-DD` date (UTC). */
function formatUtcDate(timestamp: number): string {
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return new Date(ms).toISOString().slice(0, 10);
}

interface EntityMetaInput {
  /** Entity-specific title, e.g. `Block #123`. `| <explorerName>` is appended. */
  title: string;
  description: string;
  /** Absolute path, e.g. `/block/123` — resolved against `metadataBase`. */
  path: string;
}

/**
 * Compose a full Metadata object from an entity-specific title/description.
 * The document title becomes `<title> | <explorerName>`; Open Graph and
 * Twitter mirror it so previews and the tab title stay in sync.
 */
export function buildEntityMetadata(
  { title, description, path }: EntityMetaInput,
  twitterCard: 'summary' | 'summary_large_image' = 'summary_large_image'
): Metadata {
  const { explorerName } = siteSeo();
  const fullTitle = `${title} | ${explorerName}`;

  return {
    title: fullTitle,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: explorerName,
      type: 'website',
    },
    twitter: {
      card: twitterCard,
      title: fullTitle,
      description,
    },
  };
}

// ---- Per-entity builders --------------------------------------------------

/** Block summary used to enrich block metadata (looked up in lib/seo-data.ts). */
export interface BlockSummary {
  miner?: string;
  timestamp?: number;
}

export function buildBlockMetadata(blockNumber: string, block?: BlockSummary): Metadata {
  const { networkName } = siteSeo();
  let description = `Block #${blockNumber} on the ${networkName} blockchain — miner, transactions, gas used, size, difficulty and timestamp.`;

  if (block?.miner || block?.timestamp) {
    const bits: string[] = [];
    if (block.miner) bits.push(`mined by ${shortenHex(block.miner)}`);
    if (block.timestamp) bits.push(`on ${formatUtcDate(block.timestamp)}`);
    description = `Block #${blockNumber} ${bits.join(' ')} on the ${networkName} blockchain — transactions, gas used, size and difficulty.`;
  }

  return buildEntityMetadata({
    title: `Block #${blockNumber}`,
    description,
    path: `/block/${blockNumber}`,
  });
}

/** Transaction summary used to enrich tx metadata (looked up in lib/seo-data.ts). */
export interface TxSummary {
  from?: string;
  to?: string;
  value?: string; // wei
  status?: number; // 1 = success, 0 = failed
}

export function buildTxMetadata(hash: string, tx?: TxSummary): Metadata {
  const { networkName, currencySymbol, decimals } = siteSeo();
  // Full hash in the description for exact-match search; shortened in the title.
  let description = `Transaction ${hash} on the ${networkName} blockchain — status, value, from/to addresses, gas and event logs.`;

  if (tx && (tx.from || tx.to || tx.value !== undefined)) {
    const segs: string[] = [];
    const amount = tx.value ? formatNativeAmount(tx.value, decimals, currencySymbol) : '';
    if (amount) segs.push(amount);
    if (tx.from) segs.push(`from ${shortenHex(tx.from)}`);
    if (tx.to) segs.push(`to ${shortenHex(tx.to)}`);
    const status = tx.status === 0 ? 'failed' : 'succeeded';
    const detail = segs.length ? `${segs.join(' ')} — ` : '';
    description = `Transaction ${hash} ${detail}${status} on the ${networkName} blockchain.`;
  }

  return buildEntityMetadata({
    title: `Transaction ${shortenHex(hash)}`,
    description,
    path: `/tx/${hash}`,
  });
}

/** Account summary used to enrich address metadata (looked up in lib/seo-data.ts). */
export interface AddressSummary {
  balance?: string; // wei
  type?: number; // 0 = wallet, 1 = contract
}

export function buildAddressMetadata(address: string, account?: AddressSummary): Metadata {
  const { networkName, currencySymbol, decimals } = siteSeo();
  let description = `Address ${address} on the ${networkName} blockchain — balance, transactions, token holdings and activity.`;

  if (account && (account.balance !== undefined || account.type !== undefined)) {
    const kind = account.type === 1 ? 'Contract' : 'Address';
    const bal = account.balance
      ? formatNativeAmount(account.balance, decimals, currencySymbol)
      : '';
    description = bal
      ? `${kind} ${address} holds ${bal} on the ${networkName} blockchain — transactions, token holdings and activity.`
      : `${kind} ${address} on the ${networkName} blockchain — balance, transactions, token holdings and activity.`;
  }

  return buildEntityMetadata({
    title: `Address ${shortenHex(address)}`,
    description,
    path: `/address/${address}`,
  });
}

/** Known on-chain identity for a token, used to enrich its metadata. */
export interface TokenIdentity {
  name?: string;
  symbol?: string;
  type?: string;
}

/**
 * Token metadata. When a name/symbol is known (looked up off the render path)
 * the title becomes `Name (SYMBOL)` — the search vector people actually use —
 * otherwise it falls back to the shortened address. The description always
 * carries the full address for exact-match search.
 */
export function buildTokenMetadata(address: string, token?: TokenIdentity): Metadata {
  const { networkName } = siteSeo();
  const name = token?.name?.trim();
  const symbol = token?.symbol?.trim();
  const label = name && symbol ? `${name} (${symbol})` : name || symbol;

  if (label) {
    const kind = token?.type?.trim() ? `${token.type.trim()} token` : 'token';
    return buildEntityMetadata({
      title: label,
      description: `${label} — ${kind} ${address} on the ${networkName} blockchain. Holders, transfers, total supply and metadata.`,
      path: `/token/${address}`,
    });
  }

  return buildEntityMetadata({
    title: `Token ${shortenHex(address)}`,
    description: `Token ${address} on the ${networkName} blockchain — holders, transfers, total supply and metadata.`,
    path: `/token/${address}`,
  });
}

// ---- Static hub / listing pages -------------------------------------------

export type HubKey =
  'blocks' | 'transactions' | 'tokens' | 'contracts' | 'richlist' | 'stats' | 'approvals';

const HUBS: Record<HubKey, { title: string; path: string; describe: (network: string) => string }> =
  {
    blocks: {
      title: 'Blocks',
      path: '/blocks',
      describe: (n) =>
        `Browse the latest blocks on the ${n} blockchain — block height, miner, transactions, gas and timestamp.`,
    },
    transactions: {
      title: 'Transactions',
      path: '/transactions',
      describe: (n) =>
        `Browse the latest transactions on the ${n} blockchain — value, status, from and to addresses, and gas.`,
    },
    tokens: {
      title: 'Tokens',
      path: '/tokens',
      describe: (n) =>
        `Explore tokens on the ${n} blockchain — ERC-20 tokens, NFTs, holders, transfers and supply.`,
    },
    contracts: {
      title: 'Contracts',
      path: '/contracts',
      describe: (n) => `Browse verified and deployed smart contracts on the ${n} blockchain.`,
    },
    richlist: {
      title: 'Rich List',
      path: '/richlist',
      describe: (n) => `Top accounts by balance on the ${n} blockchain.`,
    },
    stats: {
      title: 'Statistics',
      path: '/stats',
      describe: (n) =>
        `Live statistics and network status for the ${n} blockchain — node health, hashrate, difficulty, gas price, block time and daily activity.`,
    },
    approvals: {
      title: 'Token Approvals',
      path: '/approvals',
      describe: (n) =>
        `Review and revoke ERC-20 token allowances your wallet has granted on the ${n} blockchain.`,
    },
  };

/**
 * Metadata for a static hub / listing page. Same shape as the entity pages but
 * with a plain `summary` Twitter card (these pages have no per-page OG image).
 */
export function buildHubMetadata(key: HubKey): Metadata {
  const { networkName } = siteSeo();
  const hub = HUBS[key];
  return buildEntityMetadata(
    { title: hub.title, description: hub.describe(networkName), path: hub.path },
    'summary'
  );
}

// ---- Structured data (JSON-LD) --------------------------------------------

interface Breadcrumb {
  name: string;
  path: string;
}

/**
 * Build a schema.org BreadcrumbList for an entity page so search engines can
 * render a breadcrumb trail. URLs are absolute when an explorer URL is
 * configured. Render the result with the <JsonLd> component.
 */
export function buildBreadcrumbJsonLd(crumbs: Breadcrumb[]): Record<string, unknown> {
  const { baseUrl } = siteSeo();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: baseUrl ? new URL(crumb.path, baseUrl).toString() : crumb.path,
    })),
  };
}

/**
 * Site-wide WebSite JSON-LD with a SearchAction, so search engines can offer a
 * sitelinks search box that targets the explorer's /search page. Emitted only
 * when an explorer URL is configured (SearchAction requires an absolute target).
 */
export function buildWebSiteJsonLd(): Record<string, unknown> {
  const { explorerName, baseUrl } = siteSeo();
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: explorerName,
  };
  if (baseUrl) {
    jsonLd.url = baseUrl;
    jsonLd.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    };
  }
  return jsonLd;
}

/**
 * Site-wide Organization JSON-LD. `sameAs` is pulled from the configured social
 * links and repository URL, so it stays generic across deployments.
 */
export function buildOrganizationJsonLd(): Record<string, unknown> {
  const config = loadConfig();
  const { explorerName, baseUrl } = siteSeo();

  const candidates = [...Object.values(config.social ?? {}), config.explorer?.github];
  const sameAs = Array.from(
    new Set(candidates.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)))
  );

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: explorerName,
  };
  if (baseUrl) jsonLd.url = baseUrl;
  if (sameAs.length) jsonLd.sameAs = sameAs;
  return jsonLd;
}
