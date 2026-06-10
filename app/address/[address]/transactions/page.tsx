'use client';

import { use } from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../../../lib/client-config';
import { initializeCurrency } from '../../../../lib/bigint-utils';
import {
  formatAddress,
  formatTimestamp,
  getTimeAgo,
  formatNativeValueDetailed,
  type AddressTransaction as Transaction,
} from '../../../../lib/address/format';
import { getTransactionTypeBadge, formatTokenValue } from '../components/transaction-display';

export default function AddressTransactionsPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const resolvedParams = use(params);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [currencySymbol, setCurrencySymbol] = useState<string>('');
  const itemsPerPage = 50;

  useEffect(() => {
    const fetchSymbol = async () => {
      await initializeCurrency();
      await initializeCurrencyConfig();
      const symbol = getCurrencySymbol();
      setCurrencySymbol(symbol);
    };
    fetchSymbol();
  }, []);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/address/${resolvedParams.address}/transactions?page=${currentPage}&limit=${itemsPerPage}`
        );
        if (!response.ok) {
          throw new Error('Failed to fetch transactions');
        }
        const data = await response.json();
        setTransactions(data.transactions || []);
        setTotalPages(data.totalPages || 1);
        setTotalTransactions(data.totalTransactions || 0);
      } catch (error) {
        console.error('Error fetching transactions:', error);
        setError('Failed to load transactions');
      } finally {
        setLoading(false);
      }
    };
    if (resolvedParams.address) {
      fetchTransactions();
    }
  }, [resolvedParams.address, currentPage]);

  if (!currencySymbol) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
          </div>
          <div className="text-center text-gray-400 mt-4">Loading currency symbol...</div>
        </div>
      </div>
    );
  }

  const formatValue = (value: string) => formatNativeValueDetailed(value, currencySymbol);

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
            <Link
              href={`/address/${resolvedParams.address}`}
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ArrowLeftIcon className="w-6 h-6" />
            </Link>
            <ArrowPathIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl font-bold text-gray-100">Regular Transactions</h1>
          </div>
          <p className="text-gray-400">
            All regular transactions for address {resolvedParams.address}
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Transaction List */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-100">Transaction History</h2>
            <div className="text-sm text-gray-400">
              Showing {transactions.length} of {totalTransactions.toLocaleString()} transactions
            </div>
          </div>

          {transactions.length === 0 ? (
            <p className="text-gray-400 text-center py-8">
              No transactions found for this address.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Tx Hash
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Type
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Block
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        From
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">To</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Value
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Age</th>
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
                          <Link
                            href={`/block/${tx.blockNumber}`}
                            className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                          >
                            {tx.blockNumber.toLocaleString()}
                          </Link>
                        </td>
                        <td className="py-3 px-4">
                          {tx.from === '0x0000000000000000000000000000000000000000' ? (
                            <span className="text-yellow-400 text-sm">System</span>
                          ) : tx.from.toLowerCase() === resolvedParams.address.toLowerCase() ? (
                            <span className="text-gray-400 font-mono text-sm">You</span>
                          ) : (
                            <Link
                              href={`/address/${tx.from}`}
                              className="text-green-400 hover:text-green-300 font-mono text-sm transition-colors"
                              title={tx.from}
                            >
                              {formatAddress(tx.from)}
                            </Link>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {!tx.to || tx.to === '0x0000000000000000000000000000000000000000' ? (
                            <span className="text-indigo-400 text-sm">Contract Created</span>
                          ) : tx.to.toLowerCase() === resolvedParams.address.toLowerCase() ? (
                            <span className="text-gray-400 font-mono text-sm">You</span>
                          ) : (
                            <Link
                              href={`/address/${tx.to}`}
                              className="text-red-400 hover:text-red-300 font-mono text-sm transition-colors"
                              title={tx.to}
                            >
                              {formatAddress(tx.to)}
                            </Link>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            {parseFloat(tx.value) > 0 && (
                              <span
                                className={
                                  tx.direction === 'in' ? 'text-green-400' : 'text-red-400'
                                }
                              >
                                {tx.direction === 'in' ? '+' : '-'}
                                {formatValue(tx.value)}
                              </span>
                            )}
                            {(tx.tokenTransfers || tx.tokenInfo) && (
                              <div className="text-sm">{formatTokenValue(tx)}</div>
                            )}
                            {parseFloat(tx.value) === 0 && !tx.tokenInfo && !tx.tokenTransfers && (
                              <span className="text-gray-500">-</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-sm">
                            <div className="text-gray-300">{getTimeAgo(tx.timestamp)}</div>
                            <div className="text-gray-500 text-xs">
                              {formatTimestamp(tx.timestamp)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination UI */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-8">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    Previous
                  </button>

                  <div className="flex items-center gap-2">
                    {/* First page */}
                    {currentPage > 3 && (
                      <>
                        <button
                          onClick={() => setCurrentPage(1)}
                          className="px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors font-medium"
                        >
                          1
                        </button>
                        {currentPage > 4 && <span className="text-gray-500">...</span>}
                      </>
                    )}

                    {/* Pages around the current page */}
                    {Array.from({ length: 5 }, (_, i) => currentPage - 2 + i)
                      .filter((page) => page >= 1 && page <= totalPages)
                      .map((page) => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-2 rounded-lg transition-colors font-medium ${
                            page === currentPage
                              ? 'bg-blue-600 text-white shadow-lg'
                              : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                          }`}
                        >
                          {page}
                        </button>
                      ))}

                    {/* Last page */}
                    {currentPage < totalPages - 2 && (
                      <>
                        {currentPage < totalPages - 3 && <span className="text-gray-500">...</span>}
                        <button
                          onClick={() => setCurrentPage(totalPages)}
                          className="px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors font-medium"
                        >
                          {totalPages}
                        </button>
                      </>
                    )}
                  </div>

                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    Next
                  </button>
                </div>
              )}

              {/* Pagination info */}
              <div className="text-center mt-4 text-gray-400 text-sm">
                Showing transactions {(currentPage - 1) * 50 + 1} to{' '}
                {Math.min(currentPage * 50, totalTransactions)} of{' '}
                {totalTransactions.toLocaleString()} total transactions
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
