/**
 * The node the server reads from: one viem client for the whole app and the tools
 * (WEB3_PROVIDER_URL, else config.json `web3Provider.url`). Until 2026-11-27 the app also carried
 * web3.js for the same calls, and the Etherscan API read the public RPC URL meant for wallets.
 */
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbi,
  type Abi,
  type PublicClient,
} from 'viem';
import { loadConfig } from '../config';

let client: PublicClient | null = null;

/** The node's URL: the environment overrides config.json, as for the other settings. */
export function getProviderUrl(): string {
  return process.env.WEB3_PROVIDER_URL || loadConfig().web3Provider?.url || 'http://localhost:8545';
}

export function getClient(): PublicClient {
  client ??= createPublicClient({ transport: http(getProviderUrl(), { timeout: 30_000 }) });
  return client;
}

/** Forgets the client (tests that point WEB3_PROVIDER_URL elsewhere). */
export function resetClient(): void {
  client = null;
}

export async function isNodeConnected(): Promise<boolean> {
  try {
    await getClient().getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

/** The runtime code at an address, '0x' when there is none. */
export async function getCode(address: string): Promise<string> {
  return (await getClient().getCode({ address: address as `0x${string}` })) ?? '0x';
}

/** Addresses in lower case, as the database stores them. */
function lowerAddresses(value: unknown): unknown {
  if (typeof value === 'string')
    return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(lowerAddresses);
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, lowerAddresses(item)])
    );
  }
  return value;
}

const parsedAbis = new WeakMap<readonly unknown[], Abi>();

/** A JSON ABI as it is; a human-readable one ('function name() view returns (string)') parsed once. */
function toAbi(abi: Abi | readonly unknown[]): Abi {
  if (!abi.some((item) => typeof item === 'string')) return abi as Abi;
  let parsed = parsedAbis.get(abi);
  if (!parsed) {
    parsed = parseAbi(abi as readonly string[]);
    parsedAbis.set(abi, parsed);
  }
  return parsed;
}

/**
 * Calls a view function (eth_call). The ABI is JSON or human-readable. One output comes back as
 * its value; several come back as an array that also carries the output names (`result[0]`,
 * `result.reserve0`, `const [a, b] = result`), as web3.js and ethers returned them. Integers are
 * bigint (number up to 48 bits, e.g. `decimals()`), addresses in lower case. A revert or an
 * empty answer throws.
 */
export async function callContract(
  abi: Abi | readonly unknown[],
  address: string,
  functionName: string,
  args: readonly unknown[] = [],
  options: { blockNumber?: bigint; from?: string } = {}
): Promise<any> {
  const typedAbi = toAbi(abi);
  const data = encodeFunctionData({ abi: typedAbi, functionName, args: args as unknown[] });
  const result = await getClient().call({
    to: address as `0x${string}`,
    data,
    ...(options.blockNumber !== undefined ? { blockNumber: options.blockNumber } : {}),
    ...(options.from ? { account: options.from as `0x${string}` } : {}),
  });
  if (!result.data || result.data === '0x') throw new Error(`${functionName}() returned nothing`);
  const decoded = decodeFunctionResult({ abi: typedAbi, functionName, data: result.data });
  const fragment = typedAbi.find(
    (item) => item.type === 'function' && item.name === functionName
  ) as { outputs?: Array<{ name?: string }> } | undefined;
  const outputs = fragment?.outputs ?? [];
  if (outputs.length <= 1) return lowerAddresses(decoded);
  const values = (decoded as readonly unknown[]).map(lowerAddresses) as unknown[] &
    Record<string, unknown>;
  for (const [index, output] of outputs.entries()) {
    if (output.name && !(output.name in values)) values[output.name] = values[index];
  }
  return values;
}
