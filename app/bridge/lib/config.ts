import { defineChain, parseAbi, type Chain } from 'viem';

// Contract ABIs are interfaces (not coin/token-specific), so they live in code.
// All chain / coin / token / address values are config-driven
// (config.json -> /api/config/client).
export const VAULT_ABI = parseAbi([
  // Native coin lock (payable). Recipient is the address on the remote chain.
  'function lock(address recipient) payable',
  // ERC-20 lock (for token routes). Requires prior approve() on the token.
  'function lockToken(address token, uint256 amount, address recipient)',
  'function lockNonce() view returns (uint256)',
]);

export const BRIDGE_ABI = parseAbi([
  'function burnForBridge(uint256 amount, address recipient)',
  'function burnNonce() view returns (uint256)',
]);

// Generic ERC-20 ABI, used both for the wrapped token on the remote chain and
// for ERC-20 source assets on token routes.
export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// Backwards-compatible alias (the wrapped token is just an ERC-20).
export const WRAPPED_ABI = ERC20_ABI;

// ---- Resolved, config-driven types ---------------------------------------

/** The native chain this explorer serves (holds the lock vaults). Shared by all routes. */
export interface BridgeSource {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
}

/** What leaves the source chain on a given route. */
export interface BridgeAsset {
  kind: 'native' | 'erc20';
  symbol: string;
  /** ERC-20 token address on the source chain (only for kind === 'erc20'). */
  token?: `0x${string}`;
  decimals: number;
}

/** The remote chain + wrapped token a route bridges to. */
export interface BridgeRemote {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
  bridge: `0x${string}`;
  wrappedToken: `0x${string}`;
  wrappedSymbol: string;
  /** Optional external DEX where the wrapped token can be traded (e.g. PancakeSwap). */
  dexName?: string;
  swapUrl?: string;
}

/** One bridgeable asset -> remote-chain pairing. */
export interface BridgeRoute {
  id: string;
  label: string;
  asset: BridgeAsset;
  vault: `0x${string}`;
  remote: BridgeRemote;
}

export interface BridgeConfig {
  relayEtaSeconds: number;
  source: BridgeSource;
  routes: BridgeRoute[];
}

// ---- Normalization (supports both the routes[] and the legacy shape) -------

interface RawRemote {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
  bridge: string;
  wrappedToken: string;
  wrappedSymbol: string;
  dexName?: string;
  swapUrl?: string;
}
interface RawRoute {
  id?: string;
  label?: string;
  asset?: { kind?: string; symbol?: string; token?: string; decimals?: number };
  vault?: string;
  remote?: RawRemote;
}

function normalizeRemote(r: RawRemote): BridgeRemote {
  return {
    chainId: r.chainId,
    name: r.name,
    nativeSymbol: r.nativeSymbol,
    rpcUrl: r.rpcUrl,
    explorer: r.explorer,
    bridge: r.bridge as `0x${string}`,
    wrappedToken: r.wrappedToken as `0x${string}`,
    wrappedSymbol: r.wrappedSymbol,
    dexName: r.dexName,
    swapUrl: r.swapUrl,
  };
}

function normalizeRoute(r: RawRoute, source: BridgeSource, index: number): BridgeRoute | null {
  if (!r.vault || !r.remote) return null;
  const kind = r.asset?.kind === 'erc20' ? 'erc20' : 'native';
  const symbol = r.asset?.symbol || (kind === 'native' ? source.nativeSymbol : 'TOKEN');
  const remote = normalizeRemote(r.remote);
  return {
    id: r.id || `${symbol}-${remote.chainId}`.toLowerCase() || `route-${index}`,
    label: r.label || `${symbol} → ${remote.wrappedSymbol} (${remote.name})`,
    asset: {
      kind,
      symbol,
      token: r.asset?.token as `0x${string}` | undefined,
      decimals: typeof r.asset?.decimals === 'number' ? r.asset.decimals : 18,
    },
    vault: r.vault as `0x${string}`,
    remote,
  };
}

// Fetch the client config and map it to a BridgeConfig. Returns null when the
// bridge is disabled or has no usable route.
export async function fetchBridgeConfig(): Promise<BridgeConfig | null> {
  const res = await fetch('/api/config/client');
  if (!res.ok) return null;
  const cfg = await res.json();
  const b = cfg?.bridge;
  const net = cfg?.network;
  if (!b?.enabled || !net) return null;

  const source: BridgeSource = {
    chainId: net.chainId,
    name: net.name,
    nativeSymbol: cfg.currency?.symbol ?? net.name,
    rpcUrl: net.rpcUrl,
    explorer: net.explorer,
  };

  // Prefer the multi-route shape; fall back to the legacy single vault/remote.
  const rawRoutes: RawRoute[] = Array.isArray(b.routes)
    ? b.routes
    : b.vault && b.remote
      ? [{ vault: b.vault, remote: b.remote }]
      : [];

  const routes = rawRoutes
    .map((r, i) => normalizeRoute(r, source, i))
    .filter((r): r is BridgeRoute => r !== null);

  if (routes.length === 0) return null;

  return {
    relayEtaSeconds: b.relayEtaSeconds ?? 90,
    source,
    routes,
  };
}

export function toViemChain(c: {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
}): Chain {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    blockExplorers: { default: { name: c.name, url: c.explorer } },
  });
}
