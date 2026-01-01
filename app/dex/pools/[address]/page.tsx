'use client';

import { useEffect, useState, use, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useDexConfig } from '@/hooks/useDexConfig';
import {
  ArrowsRightLeftIcon,
  PlusCircleIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  CircleStackIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';

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

interface PoolDetails {
  address: string;
  name: string;
  token0: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    reserve: string;
    reserveUsd: number;
  };
  token1: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    reserve: string;
    reserveUsd: number;
  };
  price: number;
  priceInverse: number;
  totalLiquidityUsd: number;
  lpTokenSupply: string;
  volume24h: number;
  fees24h: number;
  apr: number | null;
  vbcPriceUsd?: number;
}

export default function PoolDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nativePrice, setNativePrice] = useState<number | null>(null);
  const [nativeSymbol, setNativeSymbol] = useState<string>('VBC');

  // Get wrapped native token address from config
  const { config: dexConfig } = useDexConfig();
  const wrappedNativeAddress = dexConfig?.contracts?.wrappedNative?.toLowerCase() || '';

  // Convert wrapped native address to native token address for DEX compatibility
  const normalizeTokenAddress = useMemo(() => {
    return (tokenAddress: string): string => {
      if (wrappedNativeAddress && tokenAddress.toLowerCase() === wrappedNativeAddress) {
        return NATIVE_TOKEN_ADDRESS;
      }
      return tokenAddress;
    };
  }, [wrappedNativeAddress]);

  useEffect(() => {
    async function fetchPoolDetails() {
      try {
        // Fetch pool details and external price in parallel
        const [poolRes, priceRes] = await Promise.all([
          fetch(`/api/dex/pools/${address}`),
          fetch('/api/dex/external-price'),
        ]);

        const poolData = await poolRes.json();
        const priceData = await priceRes.json();

        if (!poolData.success) {
          throw new Error(poolData.error || 'Failed to fetch pool details');
        }

        setPool(poolData.data);

        if (priceData.success && priceData.data) {
          setNativePrice(priceData.data.nativePriceUsd);
          setNativeSymbol(priceData.data.nativeSymbol || 'VBC');
        }
      } catch (err) {
        console.error('Failed to fetch pool details:', err);
        setError('Failed to load pool details');
      } finally {
        setLoading(false);
      }
    }

    fetchPoolDetails();
    const interval = setInterval(fetchPoolDetails, 30000);
    return () => clearInterval(interval);
  }, [address]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="animate-pulse space-y-4">
              <div className="h-12 bg-gray-700 rounded w-1/3"></div>
              <div className="h-6 bg-gray-700 rounded w-1/4"></div>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-gray-700 rounded-2xl"></div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="h-64 bg-gray-700 rounded-2xl"></div>
              <div className="h-64 bg-gray-700 rounded-2xl"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !pool) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">{error || 'Pool not found'}</h1>
          <Link href="/dex/pools" className="text-green-400 hover:text-green-300 transition-colors">
            ← Back to Pools
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            {/* Pool Info */}
            <div className="flex items-center gap-4">
              <div className="flex -space-x-3">
                <TokenIcon symbol={pool.token0.symbol} size={48} />
                <TokenIcon symbol={pool.token1.symbol} size={48} />
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
                  <Link href="/dex" className="hover:text-white transition-colors">
                    DEX
                  </Link>
                  <span>/</span>
                  <Link href="/dex/pools" className="hover:text-white transition-colors">
                    Pools
                  </Link>
                  <span>/</span>
                  <span className="text-white">{pool.name}</span>
                </div>
                <h1 className="text-3xl font-bold text-white">{pool.name}</h1>
                <div className="text-gray-400 font-mono text-sm mt-1">
                  {pool.address.slice(0, 10)}...{pool.address.slice(-8)}
                </div>
              </div>
            </div>

            {/* Navigation & Actions */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
              {/* Price Display */}
              {nativePrice !== null && (
                <div className="px-3 py-2 text-sm bg-gray-800/50 rounded-lg">
                  <span className="text-gray-400">{nativeSymbol} </span>
                  <span className="text-green-400 font-semibold">${nativePrice.toFixed(6)}</span>
                </div>
              )}

              {/* Navigation */}
              <nav className="flex items-center gap-2 bg-gray-800/50 rounded-xl p-1">
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
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Action Buttons */}
        <div className="flex gap-3 mb-8">
          <Link
            href={`/dex?tab=swap&from=${normalizeTokenAddress(pool.token0.address)}&to=${normalizeTokenAddress(pool.token1.address)}`}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-xl transition-all font-bold shadow-lg"
            style={{ color: '#ffffff' }}
          >
            <ArrowsRightLeftIcon className="w-5 h-5" />
            Swap
          </Link>
          <Link
            href={`/dex?tab=pool&tokenA=${normalizeTokenAddress(pool.token0.address)}&tokenB=${normalizeTokenAddress(pool.token1.address)}`}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all font-bold shadow-lg"
            style={{ color: '#ffffff' }}
          >
            <PlusCircleIcon className="w-5 h-5" />
            Add Liquidity
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
              <CircleStackIcon className="w-4 h-4" />
              Total Liquidity
            </div>
            <div className="text-2xl font-bold text-green-400">
              $
              {pool.totalLiquidityUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
              <ChartBarIcon className="w-4 h-4" />
              24h Volume
            </div>
            <div className="text-2xl font-bold text-white">
              $
              {pool.volume24h.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
              <CurrencyDollarIcon className="w-4 h-4" />
              24h Fees
            </div>
            <div className="text-2xl font-bold text-white">
              $
              {pool.fees24h.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
              <ArrowTrendingUpIcon className="w-4 h-4" />
              Fee APR
            </div>
            <div className="text-2xl font-bold text-green-400">
              {pool.apr !== null ? `${pool.apr.toFixed(2)}%` : '--'}
            </div>
          </div>
        </div>

        {/* Price Info */}
        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Price</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center gap-4">
              <TokenIcon symbol={pool.token0.symbol} size={40} />
              <div>
                <div className="text-gray-400 text-sm">1 {pool.token0.symbol} =</div>
                <div className="text-xl font-bold text-white">
                  {pool.price.toFixed(6)} {pool.token1.symbol}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <TokenIcon symbol={pool.token1.symbol} size={40} />
              <div>
                <div className="text-gray-400 text-sm">1 {pool.token1.symbol} =</div>
                <div className="text-xl font-bold text-white">
                  {pool.priceInverse.toFixed(6)} {pool.token0.symbol}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Token Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* Token 0 */}
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-6">
              <TokenIcon symbol={pool.token0.symbol} size={48} />
              <div>
                <div className="font-semibold text-white text-lg">{pool.token0.symbol}</div>
                <div className="text-sm text-gray-500">{pool.token0.name}</div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
                <span className="text-gray-400">Reserve</span>
                <span className="text-white font-medium">
                  {Number(pool.token0.reserve).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}{' '}
                  {pool.token0.symbol}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
                <span className="text-gray-400">Value (USD)</span>
                <span className="text-white font-medium">
                  $
                  {pool.token0.reserveUsd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-400">Contract</span>
                <Link
                  href={`/token/${pool.token0.address}`}
                  className="text-green-400 hover:text-green-300 transition-colors font-mono text-sm"
                >
                  {pool.token0.address.slice(0, 6)}...{pool.token0.address.slice(-4)}
                </Link>
              </div>
            </div>
          </div>

          {/* Token 1 */}
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-6">
              <TokenIcon symbol={pool.token1.symbol} size={48} />
              <div>
                <div className="font-semibold text-white text-lg">{pool.token1.symbol}</div>
                <div className="text-sm text-gray-500">{pool.token1.name}</div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
                <span className="text-gray-400">Reserve</span>
                <span className="text-white font-medium">
                  {Number(pool.token1.reserve).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}{' '}
                  {pool.token1.symbol}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
                <span className="text-gray-400">Value (USD)</span>
                <span className="text-white font-medium">
                  $
                  {pool.token1.reserveUsd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-400">Contract</span>
                <Link
                  href={`/token/${pool.token1.address}`}
                  className="text-green-400 hover:text-green-300 transition-colors font-mono text-sm"
                >
                  {pool.token1.address.slice(0, 6)}...{pool.token1.address.slice(-4)}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Pool Contract Info */}
        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
          <h2 className="text-lg font-semibold text-white mb-4">Pool Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <div className="text-gray-400 text-sm mb-1">LP Token Address</div>
              <Link
                href={`/token/${pool.address}`}
                className="text-green-400 hover:text-green-300 transition-colors font-mono text-sm break-all"
              >
                {pool.address}
              </Link>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-1">LP Token Supply</div>
              <div className="text-white font-medium">
                {Number(pool.lpTokenSupply).toLocaleString(undefined, {
                  maximumFractionDigits: 8,
                })}
              </div>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-1">Swap Fee</div>
              <div className="text-white font-medium">0.3%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
