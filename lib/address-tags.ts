/**
 * Public address name tags (Etherscan/BscScan-style).
 *
 * Tags are derived from infrastructure addresses already present in
 * config.json (DEX, Launchpad, Bridge, miners, knownTokens) and can be
 * extended/overridden with a manual `addressTags` section:
 *
 *   "addressTags": { "0xabc...": "Team Treasury" }
 *
 * Pure module: no DB/network access, safe for client and server use.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface NamedToken {
  address?: string;
  name?: string;
  symbol?: string;
}

export interface AddressTagSources {
  miners?: Record<string, string>;
  knownTokens?: Record<string, { name?: string; symbol?: string }>;
  dex?: {
    factory?: string;
    router?: string;
    masterChef?: string;
    wrappedNative?: NamedToken | null;
    rewardToken?: NamedToken | null;
  };
  launchpad?: {
    factoryAddress?: string;
    legacyFactories?: { address?: string }[];
  };
  bridge?: {
    routes?: {
      id?: string;
      vault?: string;
      autoSwap?: { lockAndSwap?: string } | null;
    }[];
  };
  addressTags?: Record<string, string>;
}

function isTaggableAddress(addr: unknown): addr is string {
  return (
    typeof addr === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(addr) &&
    addr.toLowerCase() !== ZERO_ADDRESS
  );
}

/**
 * Build the merged { lowercased address -> label } map. Later sources win;
 * the manual `addressTags` section always has the final say.
 */
export function buildAddressTags(cfg: AddressTagSources): Record<string, string> {
  const tags: Record<string, string> = {};
  const set = (addr: unknown, label: string) => {
    if (isTaggableAddress(addr) && label) tags[addr.toLowerCase()] = label;
  };

  for (const [addr, info] of Object.entries(cfg.knownTokens || {})) {
    const label = info?.name
      ? info.symbol
        ? `${info.name} (${info.symbol})`
        : info.name
      : undefined;
    if (label) set(addr, label);
  }

  const dex = cfg.dex || {};
  set(dex.factory, 'DEX: Factory');
  set(dex.router, 'DEX: Router');
  set(dex.masterChef, 'DEX: MasterChef');
  const wn = dex.wrappedNative;
  if (wn?.address)
    set(wn.address, wn.name ? `${wn.name}${wn.symbol ? ` (${wn.symbol})` : ''}` : 'Wrapped Native');
  const rt = dex.rewardToken;
  if (rt?.address)
    set(
      rt.address,
      rt.name ? `${rt.name}${rt.symbol ? ` (${rt.symbol})` : ''}` : 'DEX: Reward Token'
    );

  const lp = cfg.launchpad || {};
  set(lp.factoryAddress, 'Launchpad: Token Factory');
  for (const f of lp.legacyFactories || []) {
    set(f?.address, 'Launchpad: Token Factory (legacy)');
  }

  for (const route of cfg.bridge?.routes || []) {
    const suffix = route?.id ? ` (${route.id})` : '';
    set(route?.vault, `Bridge: Vault${suffix}`);
    set(route?.autoSwap?.lockAndSwap, `Bridge: Lock & Swap${suffix}`);
  }

  for (const [addr, label] of Object.entries(cfg.miners || {})) {
    if (typeof label === 'string' && label) set(addr, label);
  }

  for (const [addr, label] of Object.entries(cfg.addressTags || {})) {
    if (typeof label === 'string' && label) set(addr, label);
  }

  return tags;
}
