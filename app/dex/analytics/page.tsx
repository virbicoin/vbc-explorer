'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ChartBarIcon,
  ArrowTrendingUpIcon,
  CurrencyDollarIcon,
  CircleStackIcon,
  ArrowsRightLeftIcon,
  PlusCircleIcon,
  DocumentTextIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useTokenConfig } from '@/hooks/useTokenConfig';

interface Pool {
  address: string;
  name: string;
  tvl: number;
  volume24h: number;
  fees24h: number;
}

interface DexStats {
  totalTVL: number;
  externalTVL: number | null;
  totalVolume24h: number;
  totalFees24h: number;
  totalPools: number;
  topPools: Pool[];
  nativePrice: number;
  nativeSymbol: string;
  priceSource: string;
  tvlSource: string;
}

// Token icon component
function TokenIcon({
  symbol,
  size = 32,
  className = '',
  getIcon,
}: {
  symbol: string;
  size?: number;
  className?: string;
  getIcon: (symbol: string) => string | null;
}) {
  const iconPath = getIcon(symbol);

  if (iconPath) {
    return (
      <Image
        src={iconPath}
        alt={symbol}
        width={size}
        height={size}
        className={`rounded-full ${className}`}
      />
    );
  }

  // Fallback gradient icon
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-gray-600 to-gray-800 text-white text-xs font-bold ${className}`}
      style={{ width: size, height: size }}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<DexStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Get token icon function from config
  const { getTokenIcon } = useTokenConfig();

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch pools and external price data in parallel
        const [poolsRes, externalPriceRes] = await Promise.all([
          fetch('/api/dex/geckoterminal/pools'),
          fetch('/api/dex/external-price'),
        ]);

        const data = await poolsRes.json();
        const externalPrice = await externalPriceRes.json();

        let totalTVL = 0;
        let totalVolume24h = 0;
        let totalFees24h = 0;
        const pools: Pool[] = data.data.map(
          (pool: {
            attributes: {
              name: string;
              address: string;
              reserve_in_usd: string;
              volume_usd?: { h24?: string };
            };
          }) => {
            const tvl = parseFloat(pool.attributes.reserve_in_usd);
            const volume24h = parseFloat(pool.attributes.volume_usd?.h24 || '0');
            const fees24h = volume24h * 0.003; // 0.3% fee
            totalTVL += tvl;
            totalVolume24h += volume24h;
            totalFees24h += fees24h;
            return {
              address: pool.attributes.address,
              name: pool.attributes.name,
              tvl,
              volume24h,
              fees24h,
            };
          }
        );

        // Sort by TVL
        pools.sort((a, b) => b.tvl - a.tvl);

        // Get native price and TVL from external sources
        let nativePrice = 0;
        let nativeSymbol = '';
        let externalTVL: number | null = null;
        let priceSource = 'DEX';
        let tvlSource = 'DEX';

        if (externalPrice.success && externalPrice.data) {
          if (externalPrice.data.nativePriceUsd > 0) {
            nativePrice = externalPrice.data.nativePriceUsd;
            priceSource = externalPrice.data.source?.price || 'Exbitron';
          }
          if (externalPrice.data.nativeSymbol) {
            nativeSymbol = externalPrice.data.nativeSymbol;
          }
          if (externalPrice.data.totalTvlUsd > 0) {
            externalTVL = externalPrice.data.totalTvlUsd;
            tvlSource = externalPrice.data.source?.tvl || 'DefiLlama';
          }
        }

        setStats({
          totalTVL,
          externalTVL,
          totalVolume24h,
          totalFees24h,
          totalPools: pools.length,
          topPools: pools.slice(0, 10),
          nativePrice,
          nativeSymbol,
          priceSource,
          tvlSource,
        });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-gray-700 rounded w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-gray-700 rounded-2xl"></div>
              ))}
            </div>
            <div className="h-96 bg-gray-700 rounded-2xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-red-400">Failed to load analytics</h1>
          <p className="text-gray-400 mt-2">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-500/20 rounded-xl">
                <ChartBarIcon className="w-8 h-8 text-purple-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">DEX Analytics</h1>
                <p className="text-gray-400 mt-1">Real-time statistics and insights</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <nav className="hidden md:flex items-center gap-2 bg-gray-800/50 rounded-xl p-1">
                {stats.nativePrice > 0 && stats.nativeSymbol && (
                  <div className="px-3 py-2 text-sm">
                    <span className="text-gray-400">{stats.nativeSymbol} </span>
                    <span className="text-green-400 font-semibold">
                      ${stats.nativePrice.toFixed(6)}
                    </span>
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
                  className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
                >
                  Pools
                </Link>
                <Link
                  href="/dex/analytics"
                  className="px-4 py-2 text-sm font-medium bg-purple-500/20 text-purple-400 rounded-lg"
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
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
              <ArrowTrendingUpIcon className="w-4 h-4" />
              Total Value Locked
            </div>
            <div className="text-2xl font-bold text-white">
              $
              {stats.totalTVL.toLocaleString(undefined, {
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
              {stats.totalVolume24h.toLocaleString(undefined, {
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
              {stats.totalFees24h.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
              <CircleStackIcon className="w-4 h-4" />
              Total Pools
            </div>
            <div className="text-2xl font-bold text-white">{stats.totalPools}</div>
          </div>
        </div>

        {/* Top Pools */}
        <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 overflow-hidden mb-8">
          <div className="p-6 border-b border-gray-700/50">
            <h2 className="text-xl font-bold text-white">Top Pools by TVL</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">#</th>
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Pool</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">TVL</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">24h Volume</th>
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">24h Fees</th>
                </tr>
              </thead>
              <tbody>
                {stats.topPools.map((pool, index) => {
                  const [token0, token1] = pool.name.split('/');
                  return (
                    <tr
                      key={pool.address}
                      className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors"
                    >
                      <td className="px-6 py-4 text-gray-500">{index + 1}</td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/dex/pools/${pool.address}`}
                          className="flex items-center gap-3 group"
                        >
                          <div className="flex -space-x-2">
                            <TokenIcon symbol={token0 || ''} size={32} getIcon={getTokenIcon} />
                            <TokenIcon symbol={token1 || ''} size={32} getIcon={getTokenIcon} />
                          </div>
                          <span className="font-semibold text-white group-hover:text-green-400 transition-colors">
                            {pool.name}
                          </span>
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-right text-white font-medium">
                        $
                        {pool.tvl.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-400">
                        $
                        {pool.volume24h.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-400">
                        $
                        {pool.fees24h.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-700/50 text-center">
            <Link href="/dex/pools" className="text-green-400 hover:underline">
              View All Pools →
            </Link>
          </div>
        </div>

        {/* Protocol Info & Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-bold text-white mb-4">Protocol Info</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Swap Fee</span>
                <span className="text-white">0.3%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Protocol Fee</span>
                <span className="text-white">0.05%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">LP Reward</span>
                <span className="text-white">0.25%</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-bold text-white mb-4">Quick Links</h3>
            <div className="space-y-2">
              <Link href="/dex" className="flex items-center gap-2 text-green-400 hover:underline">
                <ArrowsRightLeftIcon className="w-4 h-4" />
                Trade Now
              </Link>
              <Link
                href="/dex/pools"
                className="flex items-center gap-2 text-green-400 hover:underline"
              >
                <PlusCircleIcon className="w-4 h-4" />
                Add Liquidity
              </Link>
              <Link
                href="/api-docs"
                className="flex items-center gap-2 text-green-400 hover:underline"
              >
                <DocumentTextIcon className="w-4 h-4" />
                API Documentation
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
