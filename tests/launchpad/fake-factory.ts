/**
 * Shared fixture for the Launchpad tests: an in-memory "chain" with a V2
 * TokenFactory (isFactoryToken / 9-field tokenInfo), a legacy factory without
 * isFactoryToken (6-field tokenInfo, membership via getAllTokens) and ERC-20
 * tokens. `handleCall()` answers `eth_call` payloads and `hasCode()` answers
 * `eth_getCode`, so the same world backs a fake FactoryClient and a mock
 * JSON-RPC HTTP node.
 */
import http from 'node:http';
import { Interface } from 'ethers';
import type { FactoryClient, FactorySource } from '@/lib/launchpad/factory';

export const V2_FACTORY = '0x5b6c68456d8e79194c63514390884e8b541298c4';
export const LEGACY_FACTORY = '0x1111111111111111111111111111111111111111';
export const CREATOR = '0xc0ffee254729296a45a3885639ac7e10f9d54979';
export const OTHER_CREATOR = '0xdeadbeef00000000000000000000000000000001';

export const FACTORIES: FactorySource[] = [
  { address: V2_FACTORY, legacy: false },
  { address: LEGACY_FACTORY, legacy: true, version: 'v1' },
];

/** What `eth_getCode` returns for every deployed contract of the fake chain. */
export const FAKE_CODE = '0x6080604052348015600f57600080fd5b50';

const FACTORY_IFACE = new Interface([
  'function isFactoryToken(address token) view returns (bool)',
  'function tokenInfo(address token) view returns (address creator, string name, string symbol, uint8 decimals, uint256 totalSupply, uint256 createdAt, string logoUrl, string description, string website)',
  'function getAllTokens() view returns (address[] tokens)',
]);
const LEGACY_IFACE = new Interface([
  'function tokenInfo(address token) view returns (address creator, string name, string symbol, uint8 decimals, uint256 totalSupply, uint256 createdAt)',
  'function getAllTokens() view returns (address[] tokens)',
]);
const ERC20_IFACE = new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

export interface FakeToken {
  address: string;
  factory: string;
  creator: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Supply recorded by the factory at creation. */
  recordedSupply: bigint;
  /** Current `totalSupply()` of the token contract. */
  liveSupply: bigint;
  createdAt: number;
  logoUrl?: string;
  description?: string;
  website?: string;
  balances: Record<string, bigint>;
  /** False simulates a factory entry whose address has no contract code (default true). */
  hasCode?: boolean;
}

export class FakeFactoryWorld {
  readonly tokens = new Map<string, FakeToken>();
  /** Deployed contracts that are not tokens of any factory (eth_getCode is non-empty). */
  readonly contracts = new Set<string>();
  readonly calls: Array<{ to: string; selector: string }> = [];

  addContract(address: string): void {
    this.contracts.add(address.toLowerCase());
  }

  /** eth_getCode semantics: factories, tokens (unless hasCode: false) and extra contracts have code. */
  hasCode(address: string): boolean {
    const lower = address.toLowerCase();
    if (lower === V2_FACTORY || lower === LEGACY_FACTORY) return true;
    if (this.contracts.has(lower)) return true;
    const token = this.tokens.get(lower);
    return token !== undefined && token.hasCode !== false;
  }

  addToken(token: Partial<FakeToken> & { address: string; factory: string }): FakeToken {
    const full: FakeToken = {
      creator: CREATOR,
      name: 'Fake Token',
      symbol: 'FAKE',
      decimals: 18,
      recordedSupply: 1_000_000n * 10n ** 18n,
      liveSupply: 1_000_000n * 10n ** 18n,
      createdAt: 1_760_000_000,
      balances: {},
      hasCode: true,
      ...token,
      address: token.address.toLowerCase(),
      factory: token.factory.toLowerCase(),
    };
    this.tokens.set(full.address, full);
    return full;
  }

  tokensOf(factory: string): string[] {
    return [...this.tokens.values()].filter((t) => t.factory === factory).map((t) => t.address);
  }

  /** Answer an eth_call; '0x' stands for "reverted / no such function". */
  handleCall(to: string, data: string): string {
    const target = to.toLowerCase();
    const selector = data.slice(0, 10).toLowerCase();
    this.calls.push({ to: target, selector });

    if (target === V2_FACTORY) {
      const fn = FACTORY_IFACE.getFunction(selector);
      if (!fn) return '0x';
      const args = FACTORY_IFACE.decodeFunctionData(fn, data);
      if (fn.name === 'isFactoryToken') {
        const token = this.tokens.get(String(args[0]).toLowerCase());
        return FACTORY_IFACE.encodeFunctionResult(fn, [token?.factory === V2_FACTORY]);
      }
      if (fn.name === 'tokenInfo') {
        const token = this.tokens.get(String(args[0]).toLowerCase());
        if (!token || token.factory !== V2_FACTORY) {
          return FACTORY_IFACE.encodeFunctionResult(fn, [
            '0x0000000000000000000000000000000000000000',
            '',
            '',
            0,
            0n,
            0n,
            '',
            '',
            '',
          ]);
        }
        return FACTORY_IFACE.encodeFunctionResult(fn, [
          token.creator,
          token.name,
          token.symbol,
          token.decimals,
          token.recordedSupply,
          BigInt(token.createdAt),
          token.logoUrl ?? '',
          token.description ?? '',
          token.website ?? '',
        ]);
      }
      if (fn.name === 'getAllTokens') {
        return FACTORY_IFACE.encodeFunctionResult(fn, [this.tokensOf(V2_FACTORY)]);
      }
      return '0x';
    }

    if (target === LEGACY_FACTORY) {
      const fn = LEGACY_IFACE.getFunction(selector);
      if (!fn) return '0x'; // no isFactoryToken on the old factory → revert
      const args = LEGACY_IFACE.decodeFunctionData(fn, data);
      if (fn.name === 'tokenInfo') {
        const token = this.tokens.get(String(args[0]).toLowerCase());
        if (!token || token.factory !== LEGACY_FACTORY) return '0x';
        return LEGACY_IFACE.encodeFunctionResult(fn, [
          token.creator,
          token.name,
          token.symbol,
          token.decimals,
          token.recordedSupply,
          BigInt(token.createdAt),
        ]);
      }
      if (fn.name === 'getAllTokens') {
        return LEGACY_IFACE.encodeFunctionResult(fn, [this.tokensOf(LEGACY_FACTORY)]);
      }
      return '0x';
    }

    const token = this.tokens.get(target);
    if (token) {
      const fn = ERC20_IFACE.getFunction(selector);
      if (!fn) return '0x';
      if (fn.name === 'balanceOf') {
        const [owner] = ERC20_IFACE.decodeFunctionData(fn, data);
        return ERC20_IFACE.encodeFunctionResult(fn, [
          token.balances[String(owner).toLowerCase()] ?? 0n,
        ]);
      }
      if (fn.name === 'totalSupply') {
        return ERC20_IFACE.encodeFunctionResult(fn, [token.liveSupply]);
      }
    }
    return '0x';
  }
}

export function fakeClient(world: FakeFactoryWorld): FactoryClient {
  return {
    call: async (to, data) => world.handleCall(to, data),
    getCode: async (address) => (world.hasCode(address) ? FAKE_CODE : '0x'),
  };
}

/** Minimal JSON-RPC node over HTTP backed by the world (eth_call + chain identity). */
export async function startFakeNode(
  world: FakeFactoryWorld
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end('{}');
        return;
      }
      const handle = (m: { id: unknown; method: string; params?: unknown[] }) => {
        switch (m.method) {
          case 'eth_call': {
            const call = (m.params?.[0] ?? {}) as { to?: string; data?: string };
            const result = world.handleCall(call.to ?? '', call.data ?? '0x');
            if (result === '0x') {
              return {
                jsonrpc: '2.0',
                id: m.id,
                error: { code: -32000, message: 'execution reverted' },
              };
            }
            return { jsonrpc: '2.0', id: m.id, result };
          }
          case 'eth_getCode': {
            const address = String(m.params?.[0] ?? '');
            return { jsonrpc: '2.0', id: m.id, result: world.hasCode(address) ? FAKE_CODE : '0x' };
          }
          case 'eth_chainId':
            return { jsonrpc: '2.0', id: m.id, result: '0x149' };
          case 'net_version':
            return { jsonrpc: '2.0', id: m.id, result: '329' };
          case 'eth_blockNumber':
            return { jsonrpc: '2.0', id: m.id, result: '0x10' };
          default:
            return {
              jsonrpc: '2.0',
              id: m.id,
              error: { code: -32601, message: 'Method not found' },
            };
        }
      };
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          Array.isArray(parsed)
            ? parsed.map((m) => handle(m as { id: unknown; method: string }))
            : handle(parsed as { id: unknown; method: string })
        )
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
