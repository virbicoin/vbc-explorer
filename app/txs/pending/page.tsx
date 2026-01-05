'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ClockIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CurrencyDollarIcon,
  FireIcon,
} from '@heroicons/react/24/outline';

interface PendingTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gas: string;
  nonce: number;
  input: string;
  timestamp?: number;
}

export default function PendingTransactionsPage() {
  const [transactions, setTransactions] = useState<PendingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const fetchPendingTxs = async () => {
      try {
        setError(null);

        const response = await fetch('/api/transactions/pending');
        if (!response.ok) {
          throw new Error('Failed to fetch pending transactions');
        }
        const data = await response.json();
        setTransactions(data.transactions || []);
        setLastUpdate(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch pending transactions');
      } finally {
        setLoading(false);
      }
    };

    fetchPendingTxs();

    let interval: NodeJS.Timeout | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchPendingTxs, 5000); // Update every 5 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  const formatAddress = (address: string | null) => {
    if (!address) return 'Contract Creation';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const formatValue = (value: string) => {
    try {
      const weiValue = BigInt(value);
      const ethValue = Number(weiValue) / 1e18;
      if (ethValue === 0) return '0 VBC';
      if (ethValue < 0.0001) return '<0.0001 VBC';
      return `${ethValue.toFixed(4)} VBC`;
    } catch {
      return `${value} VBC`;
    }
  };

  const formatGasPrice = (gasPrice: string) => {
    try {
      const gweiValue = Number(BigInt(gasPrice)) / 1e9;
      return `${gweiValue.toFixed(2)} Gwei`;
    } catch {
      return gasPrice;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <ArrowPathIcon className="w-8 h-8 text-blue-400 animate-spin" />
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClockIcon className="w-8 h-8 text-yellow-400" />
              <div>
                <h1 className="text-3xl font-bold text-gray-100">Pending Transactions</h1>
                <p className="text-gray-400">Transactions waiting to be included in a block</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-gray-400 text-sm">Auto-refresh</span>
              </label>
              {lastUpdate && (
                <span className="text-gray-500 text-sm">
                  Updated: {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
              <p className="text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <ClockIcon className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Pending Count</div>
                <div className="text-2xl font-bold text-yellow-400">{transactions.length}</div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <CurrencyDollarIcon className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Total Value</div>
                <div className="text-2xl font-bold text-green-400">
                  {formatValue(
                    transactions
                      .reduce((sum, tx) => sum + BigInt(tx.value || '0'), BigInt(0))
                      .toString()
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <FireIcon className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Avg Gas Price</div>
                <div className="text-2xl font-bold text-orange-400">
                  {transactions.length > 0
                    ? formatGasPrice(
                        (
                          transactions.reduce(
                            (sum, tx) => sum + BigInt(tx.gasPrice || '0'),
                            BigInt(0)
                          ) / BigInt(transactions.length || 1)
                        ).toString()
                      )
                    : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-gray-100">
              {transactions.length} Pending Transaction{transactions.length !== 1 ? 's' : ''}
            </h2>
          </div>

          {transactions.length === 0 ? (
            <div className="p-8 text-center">
              <ClockIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No pending transactions at the moment.</p>
              <p className="text-gray-500 text-sm mt-2">
                Transactions appear here before being included in a block.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Tx Hash
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">From</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">To</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Value</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Gas Price
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Gas Limit
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Nonce</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {transactions.map((tx) => (
                    <tr key={tx.hash} className="hover:bg-gray-700/50 transition-colors">
                      <td className="py-3 px-4">
                        <Link
                          href={`/tx/${tx.hash}`}
                          className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                        >
                          {formatAddress(tx.hash)}
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/address/${tx.from}`}
                          className="text-green-400 hover:text-green-300 font-mono text-sm"
                        >
                          {formatAddress(tx.from)}
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        {tx.to ? (
                          <Link
                            href={`/address/${tx.to}`}
                            className="text-red-400 hover:text-red-300 font-mono text-sm"
                          >
                            {formatAddress(tx.to)}
                          </Link>
                        ) : (
                          <span className="text-purple-400 text-sm">Contract Creation</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-yellow-400">{formatValue(tx.value)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-orange-400">{formatGasPrice(tx.gasPrice)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-300">{parseInt(tx.gas).toLocaleString()}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-400">{tx.nonce}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <h3 className="text-blue-400 font-semibold mb-2">About Pending Transactions</h3>
          <ul className="text-gray-400 text-sm space-y-1">
            <li>• Pending transactions are waiting to be included in a block by miners.</li>
            <li>• Higher gas prices typically result in faster confirmation times.</li>
            <li>• Transactions may be dropped if gas price is too low or nonce is incorrect.</li>
            <li>• This page auto-refreshes every 5 seconds when enabled.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
