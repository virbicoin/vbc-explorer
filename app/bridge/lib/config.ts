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

// Lock-and-swap entry on the source chain: one tx locks the native coin and
// declares the auto-conversion (output token + min amount) executed remotely.
export const LOCKSWAP_ABI = parseAbi([
  'function lockAndSwap(address finalRecipient, address outputToken, uint256 minOut) payable',
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

// Uniswap V2-style router (PancakeSwap etc.), used by the in-page swap that
// converts the wrapped token into other remote-chain assets.
export const ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
]);

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

/** An asset the wrapped token can be converted into via the in-page swap. */
export interface SwapOutput {
  symbol: string;
  kind: 'native' | 'erc20';
  /** Token address on the remote chain (only for kind === 'erc20'). */
  address?: `0x${string}`;
  decimals: number;
}

/** V2-router swap settings for converting the wrapped token on the remote chain. */
export interface RemoteSwap {
  /** Uniswap V2-style router (e.g. PancakeSwap Router). */
  router: `0x${string}`;
  /** Wrapped native token of the remote chain (e.g. WBNB) — used as the routing hop. */
  wrappedNative: `0x${string}`;
  outputs: SwapOutput[];
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
  /** Optional in-page swap via a V2 router on the remote chain. */
  swap?: RemoteSwap;
}

/** One bridgeable asset -> remote-chain pairing. */
export interface BridgeRoute {
  id: string;
  label: string;
  asset: BridgeAsset;
  vault: `0x${string}`;
  remote: BridgeRemote;
  /** Optional single-tx auto-conversion (lock here, receive swap.outputs remotely). */
  autoSwap?: { lockAndSwap: `0x${string}` };
}

export interface BridgeConfig {
  relayEtaSeconds: number;
  source: BridgeSource;
  routes: BridgeRoute[];
}

// ---- Normalization (supports both the routes[] and the legacy shape) -------

interface RawSwapOutput {
  symbol?: string;
  kind?: string;
  address?: string;
  decimals?: number;
}
interface RawSwap {
  router?: string;
  wrappedNative?: string;
  outputs?: RawSwapOutput[];
}
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
  swap?: RawSwap;
}
interface RawRoute {
  id?: string;
  label?: string;
  asset?: { kind?: string; symbol?: string; token?: string; decimals?: number };
  vault?: string;
  remote?: RawRemote;
  autoSwap?: { lockAndSwap?: string };
}

function normalizeSwap(r?: RawSwap): RemoteSwap | undefined {
  if (!r?.router || !r.wrappedNative || !Array.isArray(r.outputs)) return undefined;
  const outputs: SwapOutput[] = r.outputs
    .filter((o): o is RawSwapOutput & { symbol: string } => !!o?.symbol)
    .map((o) => ({
      symbol: o.symbol,
      kind: o.address && o.kind !== 'native' ? ('erc20' as const) : ('native' as const),
      address: o.address as `0x${string}` | undefined,
      decimals: typeof o.decimals === 'number' ? o.decimals : 18,
    }))
    .filter((o) => o.kind === 'native' || !!o.address);
  if (outputs.length === 0) return undefined;
  return {
    router: r.router as `0x${string}`,
    wrappedNative: r.wrappedNative as `0x${string}`,
    outputs,
  };
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
    swap: normalizeSwap(r.swap),
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
    autoSwap: r.autoSwap?.lockAndSwap
      ? { lockAndSwap: r.autoSwap.lockAndSwap as `0x${string}` }
      : undefined,
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
