'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChartBarIcon,
  CubeIcon,
  ArrowPathIcon,
  UserGroupIcon,
  ClockIcon,
  BoltIcon,
  CurrencyDollarIcon,
  FireIcon,
  ServerIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../lib/client-config';
import { initializeCurrency } from '../../lib/bigint-utils';

interface NetworkStats {
  latestBlock: number;
  totalTransactions: number;
  avgBlockTime: string;
  networkHashrate: string;
  networkDifficulty: string;
  activeMiners: number;
  avgGasPrice: string;
  avgTransactionFee: string;
  totalSupply: string;
  circulatingSupply?: string;
  totalAddresses?: number;
  totalContracts?: number;
  totalTokens?: number;
  isConnected: boolean;
}

interface DailyStats {
  date: string;
  transactions: number;
  blocks: number;
  avgGasPrice: number;
  activeAddresses: number;
}

interface GasStats {
  slow: string;
  standard: string;
  fast: string;
  instant: string;
  baseFee?: string;
}

export default function StatsPage() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [gasStats, setGasStats] = useState<GasStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [currencySymbol, setCurrencySymbol] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d' | '90d'>('7d');

  useEffect(() => {
    const init = async () => {
      await initializeCurrency();
      await initializeCurrencyConfig();
      setCurrencySymbol(getCurrencySymbol());
    };
    init();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);

        // Fetch network stats
        const statsRes = await fetch('/api/stats?enhanced=true');
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }

        // Fetch gas stats
        try {
          const gasRes = await fetch('/api/stats/gas');
          if (gasRes.ok) {
            const gasData = await gasRes.json();
            setGasStats(gasData);
          }
        } catch {
          // Gas stats API might not exist yet
        }

        // Fetch daily stats
        try {
          const dailyRes = await fetch(`/api/stats/daily?period=${selectedPeriod}`);
          if (dailyRes.ok) {
            const dailyData = await dailyRes.json();
            setDailyStats(dailyData.stats || []);
          }
        } catch {
          // Daily stats API might not exist yet
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [selectedPeriod]);

  const formatNumber = (num: number | string | undefined) => {
    if (num === undefined || num === null) return '0';
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return '0';
    return n.toLocaleString();
  };

  const formatHashrate = (hashrate: string | undefined) => {
    if (!hashrate) return 'N/A';
    return hashrate;
  };

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <ChartBarIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl font-bold text-gray-100">Network Statistics</h1>
          </div>
          <p className="text-gray-400">
            Comprehensive statistics and analytics for the blockchain network.
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Network Overview */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <GlobeAltIcon className="w-6 h-6 text-green-400" />
            Network Overview
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <CubeIcon className="w-5 h-5 text-green-400" />
                <span className="text-gray-400 text-sm">Latest Block</span>
              </div>
              <div className="text-2xl font-bold text-green-400">
                {formatNumber(stats?.latestBlock)}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div
                  className={`w-2 h-2 rounded-full ${stats?.isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}
                ></div>
                <span className="text-xs text-gray-400">
                  {stats?.isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <ArrowPathIcon className="w-5 h-5 text-blue-400" />
                <span className="text-gray-400 text-sm">Total Transactions</span>
              </div>
              <div className="text-2xl font-bold text-blue-400">
                {formatNumber(stats?.totalTransactions)}
              </div>
              <div className="text-xs text-gray-400 mt-2">All time</div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <ClockIcon className="w-5 h-5 text-yellow-400" />
                <span className="text-gray-400 text-sm">Avg Block Time</span>
              </div>
              <div className="text-2xl font-bold text-yellow-400">
                {stats?.avgBlockTime || '0'}s
              </div>
              <div className="text-xs text-gray-400 mt-2">Last 100 blocks</div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <UserGroupIcon className="w-5 h-5 text-purple-400" />
                <span className="text-gray-400 text-sm">Active Miners</span>
              </div>
              <div className="text-2xl font-bold text-purple-400">
                {formatNumber(stats?.activeMiners)}
              </div>
              <div className="text-xs text-gray-400 mt-2">Last 100 blocks</div>
            </div>
          </div>
        </section>

        {/* Mining Stats */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <ServerIcon className="w-6 h-6 text-orange-400" />
            Mining Statistics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <BoltIcon className="w-5 h-5 text-orange-400" />
                <span className="text-gray-400 text-sm">Network Hashrate</span>
              </div>
              <div className="text-2xl font-bold text-orange-400">
                {formatHashrate(stats?.networkHashrate)}
              </div>
              <div className="text-xs text-gray-400 mt-2">Current mining power</div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <ChartBarIcon className="w-5 h-5 text-red-400" />
                <span className="text-gray-400 text-sm">Network Difficulty</span>
              </div>
              <div className="text-2xl font-bold text-red-400">
                {stats?.networkDifficulty || 'N/A'}
              </div>
              <div className="text-xs text-gray-400 mt-2">Current difficulty</div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center gap-3 mb-2">
                <CurrencyDollarIcon className="w-5 h-5 text-green-400" />
                <span className="text-gray-400 text-sm">Total Supply</span>
              </div>
              <div className="text-2xl font-bold text-green-400">Unlimited (∞)</div>
              <div className="text-xs text-gray-400 mt-2">No maximum supply cap</div>
            </div>
          </div>
        </section>

        {/* Gas Tracker */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <FireIcon className="w-6 h-6 text-orange-400" />
            Gas Tracker
          </h2>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                <div className="text-gray-400 text-sm mb-2">🐢 Slow</div>
                <div className="text-xl font-bold text-gray-300">
                  {gasStats?.slow || stats?.avgGasPrice || 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-1">&gt; 10 min</div>
              </div>
              <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                <div className="text-gray-400 text-sm mb-2">🚗 Standard</div>
                <div className="text-xl font-bold text-blue-400">
                  {gasStats?.standard || stats?.avgGasPrice || 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-1">~ 3 min</div>
              </div>
              <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                <div className="text-gray-400 text-sm mb-2">🚀 Fast</div>
                <div className="text-xl font-bold text-green-400">
                  {gasStats?.fast || stats?.avgGasPrice || 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-1">~ 30 sec</div>
              </div>
              <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                <div className="text-gray-400 text-sm mb-2">⚡ Instant</div>
                <div className="text-xl font-bold text-orange-400">
                  {gasStats?.instant || stats?.avgGasPrice || 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-1">&lt; 15 sec</div>
              </div>
            </div>
            {gasStats?.baseFee && (
              <div className="mt-4 text-center text-gray-400 text-sm">
                Base Fee: <span className="text-white font-medium">{gasStats.baseFee}</span>
              </div>
            )}
            <div className="mt-4 text-center text-gray-400 text-sm">
              Average Transaction Fee:{' '}
              <span className="text-white font-medium">{stats?.avgTransactionFee || 'N/A'}</span>
            </div>
          </div>
        </section>

        {/* Daily Statistics Chart */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
              <ChartBarIcon className="w-6 h-6 text-blue-400" />
              Daily Statistics
            </h2>
            <div className="flex gap-2">
              {(['7d', '30d', '90d'] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    selectedPeriod === period
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {period === '7d' ? '7 Days' : period === '30d' ? '30 Days' : '90 Days'}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            {dailyStats.length > 0 ? (
              <div className="space-y-4">
                {/* Simple bar chart representation */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Transactions Chart */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Daily Transactions</h3>
                    <div className="space-y-2">
                      {dailyStats.slice(-7).map((day, idx) => {
                        const maxTx = Math.max(...dailyStats.map((d) => d.transactions));
                        const width = maxTx > 0 ? (day.transactions / maxTx) * 100 : 0;
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-16">
                              {new Date(day.date).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            <div className="flex-1 bg-gray-700 rounded-full h-4">
                              <div
                                className="bg-blue-500 h-4 rounded-full transition-all duration-300"
                                style={{ width: `${width}%` }}
                              ></div>
                            </div>
                            <span className="text-xs text-gray-400 w-16 text-right">
                              {day.transactions.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Blocks Chart */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Daily Blocks</h3>
                    <div className="space-y-2">
                      {dailyStats.slice(-7).map((day, idx) => {
                        const maxBlocks = Math.max(...dailyStats.map((d) => d.blocks));
                        const width = maxBlocks > 0 ? (day.blocks / maxBlocks) * 100 : 0;
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-16">
                              {new Date(day.date).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            <div className="flex-1 bg-gray-700 rounded-full h-4">
                              <div
                                className="bg-green-500 h-4 rounded-full transition-all duration-300"
                                style={{ width: `${width}%` }}
                              ></div>
                            </div>
                            <span className="text-xs text-gray-400 w-16 text-right">
                              {day.blocks.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <ChartBarIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Daily statistics will be available soon.</p>
                <p className="text-sm mt-2">
                  Statistics are calculated from blockchain data periodically.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Quick Links */}
        <section>
          <h2 className="text-xl font-semibold text-gray-100 mb-4">Quick Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              href="/blocks"
              className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <CubeIcon className="w-8 h-8 text-green-400" />
                <div>
                  <div className="font-semibold text-gray-100">View Blocks</div>
                  <div className="text-sm text-gray-400">Browse all blocks</div>
                </div>
              </div>
            </Link>

            <Link
              href="/transactions"
              className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ArrowPathIcon className="w-8 h-8 text-blue-400" />
                <div>
                  <div className="font-semibold text-gray-100">View Transactions</div>
                  <div className="text-sm text-gray-400">Browse all transactions</div>
                </div>
              </div>
            </Link>

            <Link
              href="/richlist"
              className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <CurrencyDollarIcon className="w-8 h-8 text-yellow-400" />
                <div>
                  <div className="font-semibold text-gray-100">Rich List</div>
                  <div className="text-sm text-gray-400">Top holders by balance</div>
                </div>
              </div>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
