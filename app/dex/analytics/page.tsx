'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Pool {
  address: string;
  name: string;
  tvl: number;
  volume24h: number;
  fees24h: number;
}

interface DexStats {
  totalTVL: number;
  totalVolume24h: number;
  totalFees24h: number;
  totalPools: number;
  topPools: Pool[];
  vbcPrice: number;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<DexStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/dex/geckoterminal/pools');
        const data = await res.json();

        let totalTVL = 0;
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
            totalTVL += tvl;
            return {
              address: pool.attributes.address,
              name: pool.attributes.name,
              tvl,
              volume24h: parseFloat(pool.attributes.volume_usd?.h24 || '0'),
              fees24h: parseFloat(pool.attributes.volume_usd?.h24 || '0') * 0.003, // 0.3% fee
            };
          }
        );

        // Sort by TVL
        pools.sort((a, b) => b.tvl - a.tvl);

        // Get VBC price
        const configRes = await fetch('/api/dex/config');
        const config = await configRes.json();

        setStats({
          totalTVL,
          totalVolume24h: 0,
          totalFees24h: 0,
          totalPools: pools.length,
          topPools: pools.slice(0, 10),
          vbcPrice: config.rewardToken?.priceUSD || 0,
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">VirBiCoin DEX Analytics</h1>
          <p className="text-gray-400">Real-time statistics and insights</p>
        </div>

        {/* Main Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-green-500/20 to-emerald-600/20 rounded-2xl p-6 border border-green-500/30">
            <div className="flex items-center gap-2 text-green-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              Total Value Locked
            </div>
            <div className="text-3xl font-bold text-white">
              $
              {stats.totalTVL.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500/20 to-indigo-600/20 rounded-2xl p-6 border border-blue-500/30">
            <div className="flex items-center gap-2 text-blue-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              24h Volume
            </div>
            <div className="text-3xl font-bold text-white">
              $
              {stats.totalVolume24h.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500/20 to-pink-600/20 rounded-2xl p-6 border border-purple-500/30">
            <div className="flex items-center gap-2 text-purple-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              24h Fees
            </div>
            <div className="text-3xl font-bold text-white">
              $
              {stats.totalFees24h.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-500/20 to-orange-600/20 rounded-2xl p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 text-yellow-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              Total Pools
            </div>
            <div className="text-3xl font-bold text-white">{stats.totalPools}</div>
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
                {stats.topPools.map((pool, index) => (
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
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold border-2 border-gray-800">
                            {pool.name.split('/')[0]?.slice(0, 2)}
                          </div>
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xs font-bold border-2 border-gray-800">
                            {pool.name.split('/')[1]?.slice(0, 2)}
                          </div>
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
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-700/50 text-center">
            <Link href="/dex/pools" className="text-green-400 hover:underline">
              View All Pools →
            </Link>
          </div>
        </div>

        {/* Protocol Info */}
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                  />
                </svg>
                Trade Now
              </Link>
              <Link
                href="/dex/pools"
                className="flex items-center gap-2 text-green-400 hover:underline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Add Liquidity
              </Link>
              <Link
                href="/dex/docs"
                className="flex items-center gap-2 text-green-400 hover:underline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Documentation
              </Link>
            </div>
          </div>
        </div>

        {/* GeckoTerminal Info Box */}
        <div className="mt-8 p-6 bg-gradient-to-r from-green-500/10 to-emerald-600/10 rounded-2xl border border-green-500/20">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-2">GeckoTerminal Integration</h3>
              <p className="text-gray-400 text-sm mb-3">
                VirBiCoin DEX provides GeckoTerminal-compatible API endpoints for seamless
                integration with cryptocurrency analytics platforms.
              </p>
              <div className="space-y-1 text-xs font-mono text-gray-500">
                <div>• GET /api/dex/geckoterminal/pools - Pool data</div>
                <div>• GET /api/dex/geckoterminal/info - DEX metadata</div>
                <div>• GET /api/dex/geckoterminal/ohlcv/[pool] - Price history</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
