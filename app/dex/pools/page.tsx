'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useDexConfig } from '@/hooks/useDexConfig';

const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

// Token icon mapping
const TOKEN_ICONS: Record<string, { icon: string; color: string }> = {
  VBC: { icon: '/img/VBC.svg', color: 'from-green-400 to-teal-500' },
  WVBC: { icon: '/img/VBC.svg', color: 'from-green-400 to-teal-500' },
  USDT: { icon: '/img/USDT.svg', color: 'from-green-400 to-emerald-500' },
  VBCG: { icon: '/img/VBCG.png', color: 'from-yellow-400 to-amber-500' },
};

function TokenIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const tokenInfo = TOKEN_ICONS[symbol];

  if (tokenInfo?.icon) {
    return (
      <div
        className="rounded-full overflow-hidden border-2 border-gray-700 bg-gray-900 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <Image
          src={tokenInfo.icon}
          alt={symbol}
          width={size - 4}
          height={size - 4}
          className="object-contain"
        />
      </div>
    );
  }

  // Fallback to gradient circle with initials
  return (
    <div
      className={`rounded-full bg-gradient-to-br ${tokenInfo?.color || 'from-gray-400 to-gray-600'} flex items-center justify-center text-white text-xs font-bold border-2 border-gray-700`}
      style={{ width: size, height: size }}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}

interface Pool {
  id: string;
  address: string;
  name: string;
  baseToken: { symbol: string; address: string };
  quoteToken: { symbol: string; address: string };
  reserve0: string;
  reserve1: string;
  price: number;
  liquidityUsd: number;
  volume24h: number;
}

// Calculate APR based on 24h volume and TVL
// APR = (volume24h * fee_rate * 365) / TVL * 100
const FEE_RATE = 0.003; // 0.3% fee
function calculateAPR(volume24h: number, tvl: number): number | null {
  if (tvl <= 0 || volume24h <= 0) return null;
  return ((volume24h * FEE_RATE * 365) / tvl) * 100;
}

export default function PoolsPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalTVL, setTotalTVL] = useState(0);
  const [totalVolume24h, setTotalVolume24h] = useState(0);
  const [externalTVL, setExternalTVL] = useState<number | null>(null);
  const [nativePrice, setNativePrice] = useState<number | null>(null);
  const [nativeSymbol, setNativeSymbol] = useState<string>('');

  // Get wrapped native token address from config
  const { config: dexConfig } = useDexConfig();
  const wrappedNativeAddress = dexConfig?.contracts?.wrappedNative?.toLowerCase() || '';

  // Convert wrapped native address to native token address for DEX compatibility
  const normalizeTokenAddress = useMemo(() => {
    return (address: string): string => {
      if (wrappedNativeAddress && address.toLowerCase() === wrappedNativeAddress) {
        return NATIVE_TOKEN_ADDRESS;
      }
      return address;
    };
  }, [wrappedNativeAddress]);

  useEffect(() => {
    async function fetchPools() {
      try {
        // Fetch pools and external price data in parallel
        const [poolsRes, externalPriceRes] = await Promise.all([
          fetch('/api/dex/geckoterminal/pools'),
          fetch('/api/dex/external-price'),
        ]);

        const data = await poolsRes.json();
        const externalPrice = await externalPriceRes.json();

        // Set external TVL and native price from Exbitron/DefiLlama
        if (externalPrice.success && externalPrice.data) {
          setExternalTVL(externalPrice.data.totalTvlUsd);
          setNativePrice(externalPrice.data.nativePriceUsd);
          setNativeSymbol(externalPrice.data.nativeSymbol || '');
        }

        const formattedPools = data.data.map(
          (pool: {
            attributes: {
              name: string;
              address: string;
              reserve_in_usd: string;
              base_token_price_native_currency: string;
              volume_usd?: { h24?: string };
            };
            relationships: {
              base_token: { data: { id: string } };
              quote_token: { data: { id: string } };
            };
          }) => {
            const [base, quote] = pool.attributes.name.split('/');
            return {
              id: pool.attributes.address,
              address: pool.attributes.address,
              name: pool.attributes.name,
              baseToken: {
                symbol: base,
                address: pool.relationships.base_token.data.id.split('_')[1],
              },
              quoteToken: {
                symbol: quote,
                address: pool.relationships.quote_token.data.id.split('_')[1],
              },
              reserve0: '0',
              reserve1: '0',
              price: parseFloat(pool.attributes.base_token_price_native_currency),
              liquidityUsd: parseFloat(pool.attributes.reserve_in_usd),
              volume24h: parseFloat(pool.attributes.volume_usd?.h24 || '0'),
            };
          }
        );

        setPools(formattedPools);
        setTotalTVL(formattedPools.reduce((acc: number, p: Pool) => acc + p.liquidityUsd, 0));
        setTotalVolume24h(formattedPools.reduce((acc: number, p: Pool) => acc + p.volume24h, 0));
      } catch (error) {
        console.error('Failed to fetch pools:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchPools();
    const interval = setInterval(fetchPools, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-gray-700 rounded w-1/3"></div>
            <div className="h-64 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/20 rounded-xl">
                <svg
                  className="w-8 h-8 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">Liquidity Pools</h1>
                <p className="text-gray-400 mt-1">All liquidity pools on VirBiCoin DEX</p>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-2 bg-gray-800/50 rounded-xl p-1">
              {nativePrice !== null && nativeSymbol && (
                <div className="px-3 py-2 text-sm">
                  <span className="text-gray-400">{nativeSymbol} </span>
                  <span className="text-green-400 font-semibold">${nativePrice.toFixed(6)}</span>
                </div>
              )}
              <Link
                href="/dex"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Trade
              </Link>
              <Link
                href="/dex/pools"
                className="px-4 py-2 text-sm font-medium bg-blue-500/20 text-blue-400 rounded-lg"
              >
                Pools
              </Link>
              <Link
                href="/dex/analytics"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Analytics
              </Link>
              <Link
                href="/dex/docs"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Docs
              </Link>
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">Total Value Locked</div>
            <div className="text-2xl font-bold text-white">
              $
              {totalTVL.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">{nativeSymbol || 'VBC'} Price</div>
            <div className="text-2xl font-bold text-white">
              $
              {nativePrice !== null
                ? nativePrice.toLocaleString(undefined, {
                    minimumFractionDigits: 6,
                    maximumFractionDigits: 6,
                  })
                : '---'}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">Total Pools</div>
            <div className="text-2xl font-bold text-white">{pools.length}</div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">24h Volume</div>
            <div className="text-2xl font-bold text-white">
              $
              {totalVolume24h.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        </div>

        {/* Pools Table */}
        <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Pool</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">TVL</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">Price</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">24h Volume</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">Fee APR</th>
                  <th className="text-center px-6 py-4 text-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((pool) => (
                  <tr
                    key={pool.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/dex/pools/${pool.address}`}
                        className="flex items-center gap-3 group"
                      >
                        <div className="flex -space-x-2">
                          <TokenIcon symbol={pool.baseToken.symbol} size={36} />
                          <TokenIcon symbol={pool.quoteToken.symbol} size={36} />
                        </div>
                        <div>
                          <div className="font-semibold text-white group-hover:text-green-400 transition-colors">
                            {pool.name}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">
                            {pool.address.slice(0, 6)}...{pool.address.slice(-4)}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="text-white font-medium">
                        $
                        {pool.liquidityUsd.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="text-white font-medium">{pool.price.toFixed(6)}</div>
                      <div className="text-xs text-gray-500">
                        {pool.quoteToken.symbol} per {pool.baseToken.symbol}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-white">
                      $
                      {pool.volume24h.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {(() => {
                        const apr = calculateAPR(pool.volume24h, pool.liquidityUsd);
                        if (apr === null) return <span className="text-gray-400">--</span>;
                        return <span className="text-green-400">{apr.toFixed(2)}%</span>;
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/dex?tab=swap&from=${normalizeTokenAddress(pool.baseToken.address)}&to=${normalizeTokenAddress(pool.quoteToken.address)}`}
                          className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm hover:bg-green-500/30 transition-colors"
                        >
                          Swap
                        </Link>
                        <Link
                          href={`/dex?tab=pool&tokenA=${normalizeTokenAddress(pool.baseToken.address)}&tokenB=${normalizeTokenAddress(pool.quoteToken.address)}`}
                          className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm hover:bg-blue-500/30 transition-colors"
                        >
                          Add
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
