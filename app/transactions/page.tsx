'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  ArrowPathIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  HashtagIcon,
  ChartBarIcon,
  CalendarIcon,
  BoltIcon,
  CubeIcon,
} from '@heroicons/react/24/outline';
import SummaryCard from '../components/SummaryCard';
import {
  getCurrencySymbol,
  getCurrencyConfig,
  initializeCurrencyConfig,
  getNetworkName,
} from '../../lib/client-config';
import { initializeCurrency } from '../../lib/bigint-utils';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  blockNumber: number;
  gasUsed?: number;
  gasPrice?: number;
  status?: number;
  type?: string;
  action?: string;
}

interface Block {
  number: number;
  hash: string;
  timestamp: number;
  transactions: number;
  miner: string;
  difficulty: string;
  totalDifficulty: string;
  gasLimit: number;
  gasUsed: number;
  nonce: string;
  extraData: string;
  baseFeePerGas?: number;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTransactions, setTotalTransactions] = useState(0);

  const [now, setNow] = useState(Date.now());
  const [stats, setStats] = useState({
    avgBlockTime: '-',
    totalTransactions: 0,
    lastBlockTimestamp: 0,
    lastBlockTime: 'Unknown',
    avgGasPrice: '0',
  });
  const [gasUnit, setGasUnit] = useState('Gwei');
  const [currencySymbol, setCurrencySymbol] = useState<string>('');
  const [networkName, setNetworkName] = useState<string>('');
  const transactionsPerPage = 50;

  useEffect(() => {
    // Fetch config for gas unit and network name
    const fetchConfig = async () => {
      try {
        // First initialize the currency cache from API
        await initializeCurrencyConfig();

        const currencyConfig = getCurrencyConfig();
        setGasUnit((currencyConfig as { gasUnit?: string }).gasUnit || 'Gwei');

        // Load currency symbol
        const symbol = getCurrencySymbol();
        setCurrencySymbol(symbol);

        // Load network name
        const network = getNetworkName();
        setNetworkName(network);
      } catch (err) {
        console.error('Error fetching currency config:', err);
      }
    };
    fetchConfig();

    // 統計データを取得
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats?enhanced=true');
        if (response.ok) {
          const statsData = await response.json();
          setStats({
            avgBlockTime: statsData.avgBlockTime || '-',
            totalTransactions: statsData.totalTransactions || 0,
            lastBlockTimestamp: statsData.lastBlockTimestamp || 0,
            lastBlockTime: statsData.lastBlockTime || 'Unknown',
            avgGasPrice: statsData.avgGasPrice || '0',
          });
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
      }
    };
    fetchStats();

    // ブロックデータを取得
    const fetchBlocks = async () => {
      try {
        const response = await fetch('/api/blocks?page=1&limit=1');
        if (response.ok) {
          const data = await response.json();
          setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
        }
      } catch (err) {
        console.error('Error fetching blocks:', err);
      }
    };
    fetchBlocks();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        // Initialize currency conversion factors
        await initializeCurrency();

        const response = await fetch(
          `/api/transactions?page=${currentPage}&limit=${transactionsPerPage}`
        );
        if (!response.ok) {
          throw new Error('Failed to fetch transactions');
        }
        const data = await response.json();
        setTransactions(data.transactions || data); // APIレスポンス形式に対応
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages);
          setTotalTransactions(data.pagination.total);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
    // Auto refresh every 30 seconds for first page only
    if (currentPage === 1) {
      const interval = setInterval(fetchTransactions, 30000);
      return () => clearInterval(interval);
    }
  }, [currentPage]);

  const formatValue = (value: string) => {
    try {
      const numValue = parseFloat(value);
      if (numValue === 0) return `0 ${currencySymbol}`;
      if (numValue < 0.000000001) return `<0.000000001 ${currencySymbol}`;
      if (numValue < 0.001) return `${numValue.toFixed(9)} ${currencySymbol}`;
      if (numValue < 1) return `${numValue.toFixed(8)} ${currencySymbol}`;
      if (numValue < 1000) return `${numValue.toFixed(6)} ${currencySymbol}`;
      return `${numValue.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currencySymbol}`;
    } catch {
      return `${value} ${currencySymbol}`;
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const getTimeAgo = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  // MetaMask準拠のトランザクションタイプバッジを生成（他のページと統一）
  const getTransactionTypeBadge = (tx: Transaction) => {
    const type = tx.type || 'unknown';
    const action = tx.action || type;

    // タイプごとのスタイル定義（暗いテーマ統一）
    const styles: Record<string, { bg: string; text: string; icon: string }> = {
      send: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '↑' },
      receive: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '↓' },
      token_transfer: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: '⇄' },
      nft_transfer: { bg: 'bg-pink-500/20', text: 'text-pink-400', icon: '🎨' },
      approve: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '✓' },
      swap: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '⟲' },
      liquidity: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: '💧' },
      stake: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '📥' },
      unstake: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '📤' },
      harvest: { bg: 'bg-lime-500/20', text: 'text-lime-400', icon: '🌾' },
      mint: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '✨' },
      burn: { bg: 'bg-red-600/20', text: 'text-red-500', icon: '🔥' },
      contract_creation: { bg: 'bg-indigo-500/20', text: 'text-indigo-400', icon: '📄' },
      contract_interaction: { bg: 'bg-violet-500/20', text: 'text-violet-400', icon: '⚡' },
      mining_reward: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⛏️' },
      unknown: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: '?' },
    };

    const style = styles[type] || styles['unknown'];

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${style.bg} ${style.text}`}
      >
        <span>{style.icon}</span>
        <span>{action}</span>
      </span>
    );
  };

  const formatTransactionFee = (gasPrice?: number, gasUsed?: number) => {
    if (!gasPrice || !gasUsed) return 'N/A';
    try {
      // gasPriceは文字列として保存されている可能性があるため、文字列として扱う
      const gasPriceStr = gasPrice.toString();
      const gasUsedNum = Number(gasUsed);

      // gasPriceがWei単位で保存されている場合（1000000000 = 1 Gwei）
      const gasPriceWei = BigInt(gasPriceStr);
      const gasUsedBigInt = BigInt(gasUsedNum);
      const totalFeeWei = gasPriceWei * gasUsedBigInt;
      const totalFeeGasUnit = Number(totalFeeWei) / 1e9; // Wei to Gwei equivalent

      if (totalFeeGasUnit >= 1) {
        return `${Math.round(totalFeeGasUnit)} ${gasUnit}`;
      } else {
        return `${Math.round(totalFeeGasUnit * 1000)} m${gasUnit}`;
      }
    } catch {
      return 'N/A';
    }
  };

  // サマリーカード用データ
  const summaryStats = [
    {
      title: 'Total Transactions',
      value: stats.totalTransactions.toLocaleString(),
      sub: 'Total transactions in chain',
      icon: <ChartBarIcon className="w-5 h-5 text-blue-400" />,
      colorClass: 'text-blue-400',
    },
    {
      title: 'Latest Block',
      value: blocks.length > 0 ? Number(blocks[0].number).toLocaleString() : '-',
      sub: 'Most recent block number',
      icon: <CubeIcon className="w-5 h-5 text-green-400" />,
      colorClass: 'text-green-400',
    },
    {
      title: 'Average Gas Price',
      value: (() => {
        if (stats.avgGasPrice === '0' || !stats.avgGasPrice) return 'N/A';
        try {
          // APIから返される値が既にGwei単位の可能性があるため、まず数値として解析
          const gasPrice = parseFloat(stats.avgGasPrice);

          // 値が非常に小さい場合（0.02など）、既にGwei単位と仮定
          if (gasPrice < 1000) {
            if (gasPrice >= 1) {
              return `${Math.round(gasPrice)} ${gasUnit}`;
            } else {
              return `${Math.round(gasPrice * 1000)} m${gasUnit}`;
            }
          }

          // 大きな値の場合、WeiからGweiに変換
          const gasPriceWei = BigInt(stats.avgGasPrice);
          const gasPriceGasUnit = Number(gasPriceWei) / 1e9;

          if (gasPriceGasUnit >= 1) {
            return `${Math.round(gasPriceGasUnit)} ${gasUnit}`;
          } else {
            return `${Math.round(gasPriceGasUnit * 1000)} m${gasUnit}`;
          }
        } catch {
          return `${stats.avgGasPrice} wei`;
        }
      })(),
      sub: 'Average gas price for transactions',
      icon: <BoltIcon className="w-5 h-5 text-yellow-400" />,
      colorClass: 'text-yellow-400',
    },
    {
      title: 'Last Transaction',
      value:
        transactions.length > 0
          ? (() => {
              const secondsAgo = Math.floor(now / 1000 - transactions[0].timestamp);
              if (secondsAgo < 0) return '0s ago';
              if (secondsAgo < 60) return `${secondsAgo}s ago`;
              if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
              if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
              return `${Math.floor(secondsAgo / 86400)}d ago`;
            })()
          : 'Unknown',
      sub: 'Time since last transaction',
      icon: <CalendarIcon className="w-5 h-5 text-emerald-400" />,
      colorClass: 'text-emerald-400',
    },
  ];

  if (loading) {
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

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded mb-4">
            <strong className="font-bold">Error:</strong>
            <span className="block sm:inline"> {error}</span>
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
            <ArrowPathIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl font-bold text-gray-100">Latest Transactions</h1>
            {currentPage > 1 && <span className="text-lg text-gray-400">- Page {currentPage}</span>}
          </div>
          <p className="text-gray-400">
            Most recent transactions on the {networkName || 'blockchain'} network
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {summaryStats.map((stat, idx) => (
            <SummaryCard key={idx} {...stat} />
          ))}
        </div>

        {/* Transaction List Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-100">Transaction List</h2>
            <div className="text-sm text-gray-400">
              Showing {transactions.length} of {totalTransactions.toLocaleString()} transactions
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-600">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                    Transaction Hash
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Block</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Age</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">From</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">To</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Value</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-600">
                {transactions.map((tx) => (
                  <tr key={tx.hash} className="hover:bg-gray-700/50 transition-colors">
                    <td className="py-3 px-4">
                      <Link
                        href={`/tx/${tx.hash}`}
                        className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors"
                        title={tx.hash}
                      >
                        {formatAddress(tx.hash)}
                      </Link>
                    </td>
                    <td className="py-3 px-4">{getTransactionTypeBadge(tx)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        <HashtagIcon className="w-4 h-4 text-blue-400 mr-2" />
                        <Link
                          href={`/block/${tx.blockNumber}`}
                          className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                        >
                          {tx.blockNumber.toLocaleString()}
                        </Link>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        <ClockIcon className="w-4 h-4 text-gray-400 mr-2" />
                        <div>
                          <div className="text-sm text-gray-300">{getTimeAgo(tx.timestamp)}</div>
                          <div className="text-xs text-gray-500">
                            {formatTimestamp(tx.timestamp)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/address/${tx.from}`}
                        className="text-green-400 hover:text-green-300 font-mono text-sm transition-colors"
                        title={tx.from}
                      >
                        {formatAddress(tx.from)}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      {tx.to ? (
                        <Link
                          href={`/address/${tx.to}`}
                          className="text-red-400 hover:text-red-300 font-mono text-sm transition-colors"
                          title={tx.to}
                        >
                          {formatAddress(tx.to)}
                        </Link>
                      ) : (
                        <span className="text-indigo-400 text-sm">Contract Creation</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-green-400 font-medium text-sm">
                        {formatValue(tx.value)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        {tx.status === 1 ? (
                          <>
                            <CheckCircleIcon className="w-4 h-4 text-green-400 mr-2" />
                            <span className="text-green-400 text-sm">Success</span>
                          </>
                        ) : tx.status === 0 ? (
                          <>
                            <XCircleIcon className="w-4 h-4 text-red-400 mr-2" />
                            <span className="text-red-400 text-sm">Failed</span>
                          </>
                        ) : (
                          <span className="text-gray-400 text-sm">Unknown</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-4 mt-8">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            <div className="flex items-center gap-2">
              {/* 最初のページ */}
              {currentPage > 3 && (
                <>
                  <button
                    onClick={() => setCurrentPage(1)}
                    className="px-3 py-2 text-gray-300 hover:bg-gray-700 rounded transition-colors"
                  >
                    1
                  </button>
                  {currentPage > 4 && <span className="text-gray-500">...</span>}
                </>
              )}

              {/* 現在のページ周辺 */}
              {Array.from({ length: 5 }, (_, i) => currentPage - 2 + i)
                .filter((page) => page >= 1 && page <= totalPages)
                .map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-2 rounded transition-colors ${
                      page === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {page}
                  </button>
                ))}

              {/* 最後のページ */}
              {currentPage < totalPages - 2 && (
                <>
                  {currentPage < totalPages - 3 && <span className="text-gray-500">...</span>}
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    className="px-3 py-2 text-gray-300 hover:bg-gray-700 rounded transition-colors"
                  >
                    {totalPages}
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}

        {/* ページ情報 */}
        <div className="text-center mt-4 text-gray-400 text-sm">
          Showing transactions {(currentPage - 1) * transactionsPerPage + 1} to{' '}
          {Math.min(currentPage * transactionsPerPage, totalTransactions)} of{' '}
          {totalTransactions.toLocaleString()} total transactions
        </div>

        {transactions.length === 0 && !loading && (
          <div className="text-center py-12">
            <ArrowPathIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">No transactions found</p>
          </div>
        )}
      </main>
    </div>
  );
}
