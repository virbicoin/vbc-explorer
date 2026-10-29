/**
 * Launchpad factory lookups (chain-authenticated).
 *
 * Registration of Launchpad tokens trusts only what the TokenFactory contracts
 * report: `isFactoryToken(address)` decides whether a token came from a
 * factory (legacy factories without that function are checked against
 * `getAllTokens()`), and `tokenInfo(address)` supplies creator, name, symbol,
 * decimals, supply, creation time and — on V2 — logo / description / website.
 * Values asserted by API clients (creator, name, supply) are never used.
 *
 * All reads go through a `FactoryClient` (one `eth_call`), so tests can inject
 * a fake and the sync tool / API share one implementation.
 */

import { Interface } from 'ethers';
import { loadConfig, type AppConfig } from '../config';
import { getWeb3 } from '../web3/provider';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface FactoryClient {
  /**
   * `eth_call` to `to` with calldata `data`. Resolves to the hex result; a
   * revert or a JSON-RPC error (e.g. unknown function on an old factory)
   * resolves to '0x'. Transport failures (node unreachable) reject.
   */
  call(to: string, data: string): Promise<string>;
}

export interface FactorySource {
  /** Lowercase factory address. */
  address: string;
  /** True for entries of `launchpad.legacyFactories`. */
  legacy: boolean;
  version?: string;
}

export interface FactoryTokenInfo {
  /** Lowercase token address. */
  address: string;
  /** Lowercase address of the factory that created the token. */
  factory: string;
  legacy: boolean;
  /** Lowercase creator address as recorded by the factory (ZERO_ADDRESS when unknown). */
  creator: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Live `totalSupply()` of the token (falls back to the factory record). */
  totalSupply: string;
  /** Creation time recorded by the factory, when it has one. */
  createdAt: Date | null;
  logoUrl: string | null;
  description: string | null;
  website: string | null;
}

export interface ResolveFactoryTokenOptions {
  client?: FactoryClient;
  factories?: FactorySource[];
}

/** Raised when the node could not be reached (as opposed to "not a factory token"). */
export class FactoryRpcError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'FactoryRpcError';
  }
}

const FACTORY_IFACE = new Interface([
  'function isFactoryToken(address token) view returns (bool)',
  'function tokenInfo(address token) view returns (address creator, string name, string symbol, uint8 decimals, uint256 totalSupply, uint256 createdAt, string logoUrl, string description, string website)',
  'function getAllTokens() view returns (address[] tokens)',
]);

const LEGACY_TOKEN_INFO_IFACE = new Interface([
  'function tokenInfo(address token) view returns (address creator, string name, string symbol, uint8 decimals, uint256 totalSupply, uint256 createdAt)',
]);

const ERC20_IFACE = new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

export function isHexAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_RE.test(value);
}

function isEmptyResult(result: string): boolean {
  return !result || result === '0x' || /^0x0*$/.test(result);
}

/** Factories from config: the current one first, then `legacyFactories` (deduplicated). */
export function getLaunchpadFactories(config: AppConfig = loadConfig()): FactorySource[] {
  const launchpad = config.launchpad;
  if (!launchpad) return [];
  const seen = new Set<string>();
  const factories: FactorySource[] = [];
  const add = (address: unknown, legacy: boolean, version?: string) => {
    if (!isHexAddress(address)) return;
    const lower = address.toLowerCase();
    if (lower === ZERO_ADDRESS || seen.has(lower)) return;
    seen.add(lower);
    factories.push({ address: lower, legacy, version });
  };
  add(launchpad.factoryAddress, false);
  add(launchpad.factoryAddressV2, false, 'v2');
  for (const legacy of launchpad.legacyFactories ?? []) add(legacy?.address, true, legacy?.version);
  return factories;
}

/** JSON-RPC level errors (revert, unknown method) carry a numeric code in `innerError`. */
function isJsonRpcError(error: unknown): boolean {
  const inner = (error as { innerError?: unknown })?.innerError;
  if (Array.isArray(inner))
    return inner.some((e) => typeof (e as { code?: unknown })?.code === 'number');
  return typeof (inner as { code?: unknown })?.code === 'number';
}

/** The default client: the shared Web3 singleton (`lib/web3/provider.ts`). */
export function createWeb3FactoryClient(): FactoryClient {
  return {
    async call(to: string, data: string): Promise<string> {
      try {
        const result = await getWeb3().eth.call({ to, data });
        return typeof result === 'string' ? result : '0x';
      } catch (error) {
        if (isJsonRpcError(error)) return '0x';
        throw new FactoryRpcError(
          `eth_call to ${to} failed: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }
    },
  };
}

/** Lowercase addresses of every token a factory created (`getAllTokens()`). */
export async function listFactoryTokens(client: FactoryClient, factory: string): Promise<string[]> {
  const result = await client.call(factory, FACTORY_IFACE.encodeFunctionData('getAllTokens'));
  if (isEmptyResult(result)) return [];
  try {
    const [tokens] = FACTORY_IFACE.decodeFunctionResult('getAllTokens', result);
    return Array.from(tokens as readonly string[], (t) => String(t).toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Whether `factory` created `token`: `isFactoryToken()` when the factory has
 * it, otherwise membership in `getAllTokens()` (legacy factories).
 */
export async function isFactoryToken(
  client: FactoryClient,
  factory: string,
  token: string
): Promise<boolean> {
  const result = await client.call(
    factory,
    FACTORY_IFACE.encodeFunctionData('isFactoryToken', [token])
  );
  if (!isEmptyResult(result) || result === `0x${'0'.repeat(64)}`) {
    try {
      const [known] = FACTORY_IFACE.decodeFunctionResult('isFactoryToken', result);
      return Boolean(known);
    } catch {
      // fall through to the token list
    }
  }
  const tokens = await listFactoryTokens(client, factory);
  return tokens.includes(token.toLowerCase());
}

/** `balanceOf(holder)` of an ERC-20 token (0n when the call fails or returns nothing). */
export async function readBalanceOf(
  client: FactoryClient,
  token: string,
  holder: string
): Promise<bigint> {
  const result = await client.call(token, ERC20_IFACE.encodeFunctionData('balanceOf', [holder]));
  if (isEmptyResult(result)) return 0n;
  try {
    const [balance] = ERC20_IFACE.decodeFunctionResult('balanceOf', result);
    return BigInt(balance as bigint);
  } catch {
    return 0n;
  }
}

async function readTotalSupply(client: FactoryClient, token: string): Promise<string | null> {
  const result = await client.call(token, ERC20_IFACE.encodeFunctionData('totalSupply'));
  if (isEmptyResult(result)) return null;
  try {
    const [supply] = ERC20_IFACE.decodeFunctionResult('totalSupply', result);
    return BigInt(supply as bigint).toString();
  } catch {
    return null;
  }
}

interface RawTokenInfo {
  creator: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  createdAt: Date | null;
  logoUrl: string | null;
  description: string | null;
  website: string | null;
}

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function decodeTokenInfo(result: string): RawTokenInfo | null {
  if (isEmptyResult(result)) return null;
  const decoders: Array<() => RawTokenInfo> = [
    () => {
      const r = FACTORY_IFACE.decodeFunctionResult('tokenInfo', result);
      return {
        creator: String(r.creator).toLowerCase(),
        name: String(r.name),
        symbol: String(r.symbol),
        decimals: Number(r.decimals),
        totalSupply: BigInt(r.totalSupply as bigint).toString(),
        createdAt: Number(r.createdAt) > 0 ? new Date(Number(r.createdAt) * 1000) : null,
        logoUrl: optionalText(r.logoUrl),
        description: optionalText(r.description),
        website: optionalText(r.website),
      };
    },
    () => {
      const r = LEGACY_TOKEN_INFO_IFACE.decodeFunctionResult('tokenInfo', result);
      return {
        creator: String(r.creator).toLowerCase(),
        name: String(r.name),
        symbol: String(r.symbol),
        decimals: Number(r.decimals),
        totalSupply: BigInt(r.totalSupply as bigint).toString(),
        createdAt: Number(r.createdAt) > 0 ? new Date(Number(r.createdAt) * 1000) : null,
        logoUrl: null,
        description: null,
        website: null,
      };
    },
  ];
  for (const decode of decoders) {
    try {
      return decode();
    } catch {
      // try the next layout
    }
  }
  return null;
}

/**
 * Chain-sourced description of a token the given factory created (the caller
 * has already established that, via `isFactoryToken()` or `getAllTokens()`).
 */
export async function describeFactoryToken(
  client: FactoryClient,
  factory: FactorySource,
  token: string
): Promise<FactoryTokenInfo> {
  const address = token.toLowerCase();
  const info = decodeTokenInfo(
    await client.call(factory.address, FACTORY_IFACE.encodeFunctionData('tokenInfo', [address]))
  );
  const liveSupply = await readTotalSupply(client, address);
  return {
    address,
    factory: factory.address,
    legacy: factory.legacy,
    creator: info?.creator && isHexAddress(info.creator) ? info.creator : ZERO_ADDRESS,
    name: info?.name ?? '',
    symbol: info?.symbol ?? '',
    decimals: Number.isFinite(info?.decimals) ? (info?.decimals as number) : 18,
    totalSupply: liveSupply ?? info?.totalSupply ?? '0',
    createdAt: info?.createdAt ?? null,
    logoUrl: info?.logoUrl ?? null,
    description: info?.description ?? null,
    website: info?.website ?? null,
  };
}

/**
 * Resolve a token through the configured factories. Returns the chain-sourced
 * token record of the first factory that knows the address, or null when no
 * factory does (the registration API answers 404 in that case).
 */
export async function resolveFactoryToken(
  address: string,
  options: ResolveFactoryTokenOptions = {}
): Promise<FactoryTokenInfo | null> {
  if (!isHexAddress(address)) return null;
  const token = address.toLowerCase();
  const client = options.client ?? createWeb3FactoryClient();
  const factories = options.factories ?? getLaunchpadFactories();
  for (const factory of factories) {
    if (await isFactoryToken(client, factory.address, token)) {
      return describeFactoryToken(client, factory, token);
    }
  }
  return null;
}
