'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
}

export default function PoolsPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalTVL, setTotalTVL] = useState(0);

  useEffect(() => {
    async function fetchPools() {
      try {
        const res = await fetch('/api/dex/geckoterminal/pools');
        const data = await res.json();

        const formattedPools = data.data.map(
          (pool: {
            attributes: {
              name: string;
              address: string;
              reserve_in_usd: string;
              base_token_price_native_currency: string;
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
            };
          }
        );

        setPools(formattedPools);
        setTotalTVL(formattedPools.reduce((acc: number, p: Pool) => acc + p.liquidityUsd, 0));
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Pools</h1>
            <p className="text-gray-400">All liquidity pools on VirBiCoin DEX</p>
          </div>
          <Link
            href="/dex?tab=pool"
            className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl hover:opacity-90 transition-opacity font-semibold"
          >
            + Add Liquidity
          </Link>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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
            <div className="text-gray-400 text-sm mb-1">Total Pools</div>
            <div className="text-2xl font-bold text-white">{pools.length}</div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">24h Volume</div>
            <div className="text-2xl font-bold text-white">$0.00</div>
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
                  <th className="text-right px-6 py-4 text-gray-400 font-medium">APR</th>
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
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold border-2 border-gray-800">
                            {pool.baseToken.symbol.slice(0, 2)}
                          </div>
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xs font-bold border-2 border-gray-800">
                            {pool.quoteToken.symbol.slice(0, 2)}
                          </div>
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
                        {pool.baseToken.symbol}/{pool.quoteToken.symbol}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-400">$0.00</td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-green-400">--</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/dex?tab=swap&from=${pool.baseToken.address}&to=${pool.quoteToken.address}`}
                          className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm hover:bg-green-500/30 transition-colors"
                        >
                          Swap
                        </Link>
                        <Link
                          href={`/dex?tab=pool&pair=${pool.address}`}
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

        {/* API Info for GeckoTerminal */}
        <div className="mt-8 p-4 bg-gray-800/30 rounded-xl border border-gray-700/30">
          <h3 className="text-gray-400 text-sm mb-2">API Endpoints</h3>
          <div className="space-y-1 text-xs font-mono text-gray-500">
            <div>GET /api/dex/geckoterminal/pools - All pools data</div>
            <div>GET /api/dex/geckoterminal/info - DEX information</div>
            <div>GET /api/dex/geckoterminal/ohlcv/[pool] - Price history</div>
          </div>
        </div>
      </div>
    </div>
  );
}
