import { defineChain, parseAbi, type Chain } from 'viem';

// Contract ABIs are interfaces (not coin-specific names), so they live in code.
// All chain/coin/address values are config-driven (config.json -> /api/config/client).
export const VAULT_ABI = parseAbi([
  'function lock(address bscRecipient) payable',
  'function lockNonce() view returns (uint256)',
]);

export const BRIDGE_ABI = parseAbi([
  'function burnForBridge(uint256 amount, address vbcRecipient)',
  'function burnNonce() view returns (uint256)',
]);

export const WRAPPED_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// Resolved, config-driven bridge configuration.
export interface BridgeChainBase {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
}
export interface BridgeConfig {
  relayEtaSeconds: number;
  // The native chain this explorer serves (from config.network); holds the lock vault.
  source: BridgeChainBase & { vault: `0x${string}` };
  // The remote chain where the wrapped token lives (e.g. BSC).
  remote: BridgeChainBase & {
    bridge: `0x${string}`;
    wrappedToken: `0x${string}`;
    wrappedSymbol: string;
  };
}

// Fetch the client config and map it to a BridgeConfig. Returns null when the
// bridge is not enabled/configured (so the page can show a disabled state).
export async function fetchBridgeConfig(): Promise<BridgeConfig | null> {
  const res = await fetch('/api/config/client');
  if (!res.ok) return null;
  const cfg = await res.json();
  const b = cfg?.bridge;
  const net = cfg?.network;
  if (!b?.enabled || !b.remote || !net) return null;
  return {
    relayEtaSeconds: b.relayEtaSeconds ?? 90,
    source: {
      chainId: net.chainId,
      name: net.name,
      nativeSymbol: cfg.currency?.symbol ?? net.name,
      rpcUrl: net.rpcUrl,
      explorer: net.explorer,
      vault: b.vault,
    },
    remote: {
      chainId: b.remote.chainId,
      name: b.remote.name,
      nativeSymbol: b.remote.nativeSymbol,
      rpcUrl: b.remote.rpcUrl,
      explorer: b.remote.explorer,
      bridge: b.remote.bridge,
      wrappedToken: b.remote.wrappedToken,
      wrappedSymbol: b.remote.wrappedSymbol,
    },
  };
}

export function toViemChain(c: BridgeChainBase): Chain {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    blockExplorers: { default: { name: c.name, url: c.explorer } },
  });
}
