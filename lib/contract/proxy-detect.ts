/**
 * Proxy detection: which implementation a proxy contract delegates to, read from the chain the way
 * Blockscout does (no stored claim involved, so an upgrade is picked up at once).
 *
 * Recognised: EIP-1967 (implementation slot, and the beacon slot + `implementation()`), EIP-1822
 * (PROXIABLE slot), the OpenZeppelin legacy (zos) slot and EIP-1167 minimal proxies (the address
 * in the runtime code).
 */
import { keccak256, stringToBytes, toHex, type Address, type Hex } from 'viem';

/** keccak256(text) as a 32-byte slot, minus 1 where the standard says so. */
function slot(text: string, minusOne: boolean): Hex {
  const hash = BigInt(keccak256(stringToBytes(text)));
  return toHex(minusOne ? hash - 1n : hash, { size: 32 });
}

export const EIP1967_IMPLEMENTATION_SLOT = slot('eip1967.proxy.implementation', true);
export const EIP1967_BEACON_SLOT = slot('eip1967.proxy.beacon', true);
export const EIP1822_PROXIABLE_SLOT = slot('PROXIABLE', false);
export const ZEPPELINOS_IMPLEMENTATION_SLOT = slot('org.zeppelinos.proxy.implementation', false);

/** `implementation()` of a beacon. */
const IMPLEMENTATION_SELECTOR = '0x5c60da1b';

const MINIMAL_PROXY = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;

export type ProxyKind = 'eip1967' | 'eip1967-beacon' | 'eip1822' | 'zeppelinos' | 'eip1167';

export interface ProxyInfo {
  kind: ProxyKind;
  implementation: string;
}

/** The node calls detection needs (a viem public client satisfies it). */
export interface ProxyNode {
  getStorageAt(args: { address: Address; slot: Hex }): Promise<Hex | undefined>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  call(args: { to: Address; data: Hex }): Promise<{ data?: Hex }>;
}

/** The address in the low 20 bytes of a storage word, or null for an empty word. */
function addressInWord(word: Hex | undefined | null): string | null {
  if (!word || !/^0x[0-9a-f]*$/i.test(word)) return null;
  const hex = word.slice(2).padStart(64, '0').slice(-40).toLowerCase();
  return /^0+$/.test(hex) ? null : `0x${hex}`;
}

async function hasCode(node: ProxyNode, address: string): Promise<boolean> {
  const code = await node.getCode({ address: address as Address });
  return Boolean(code && code !== '0x');
}

/** The proxy's implementation, or null when the address is not a recognised proxy. */
export async function detectProxy(node: ProxyNode, address: string): Promise<ProxyInfo | null> {
  const target = address.toLowerCase() as Address;
  const code = await node.getCode({ address: target });
  if (!code || code === '0x') return null;

  const minimal = MINIMAL_PROXY.exec(code);
  if (minimal) return { kind: 'eip1167', implementation: `0x${minimal[1].toLowerCase()}` };

  const read = (slotHex: Hex) => node.getStorageAt({ address: target, slot: slotHex });

  for (const [kind, slotHex] of [
    ['eip1967', EIP1967_IMPLEMENTATION_SLOT],
    ['eip1822', EIP1822_PROXIABLE_SLOT],
    ['zeppelinos', ZEPPELINOS_IMPLEMENTATION_SLOT],
  ] as const) {
    const implementation = addressInWord(await read(slotHex));
    if (implementation && (await hasCode(node, implementation))) return { kind, implementation };
  }

  const beacon = addressInWord(await read(EIP1967_BEACON_SLOT));
  if (beacon) {
    const answer = await node.call({ to: beacon as Address, data: IMPLEMENTATION_SELECTOR });
    const implementation = addressInWord(answer.data);
    if (implementation && (await hasCode(node, implementation))) {
      return { kind: 'eip1967-beacon', implementation };
    }
  }
  return null;
}
