'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  CodeBracketIcon,
  CheckCircleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface Contract {
  address: string;
  name: string;
  symbol?: string;
  type: string;
  verified: boolean;
  createdAt?: string;
  blockNumber?: number;
  transactionCount?: number;
  compilerVersion?: string;
}

interface ContractsResponse {
  contracts: Contract[];
  total: number;
  page: number;
  limit: number;
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const limit = 25;

  useEffect(() => {
    const fetchContracts = async () => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
        });

        if (filter !== 'all') {
          params.append('verified', filter === 'verified' ? 'true' : 'false');
        }

        if (typeFilter !== 'all') {
          params.append('type', typeFilter);
        }

        if (searchQuery) {
          params.append('search', searchQuery);
        }

        const response = await fetch(`/api/contracts?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Failed to fetch contracts');
        }

        const data: ContractsResponse = await response.json();
        setContracts(data.contracts || []);
        setTotal(data.total || 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch contracts');
      } finally {
        setLoading(false);
      }
    };

    fetchContracts();
  }, [page, filter, typeFilter, searchQuery]);

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 10)}...${address.slice(-8)}`;
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <CodeBracketIcon className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold text-gray-100">Smart Contracts</h1>
          </div>
          <p className="text-gray-400">
            Browse and explore smart contracts deployed on the network.
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Filters */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by address or name..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-gray-200 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Verification Filter */}
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-5 h-5 text-gray-400" />
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as 'all' | 'verified' | 'unverified');
                  setPage(1);
                }}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Contracts</option>
                <option value="verified">Verified Only</option>
                <option value="unverified">Unverified Only</option>
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Types</option>
                <option value="VRC-20">VRC-20 Token</option>
                <option value="VRC-721">VRC-721 NFT</option>
                <option value="VRC-1155">VRC-1155 Multi-Token</option>
                <option value="Contract">Other Contract</option>
              </select>
            </div>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-gray-400 text-sm">Total Contracts</div>
            <div className="text-2xl font-bold text-white">{total.toLocaleString()}</div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-gray-400 text-sm">Verified Contracts</div>
            <div className="text-2xl font-bold text-green-400">
              {contracts.filter((c) => c.verified).length.toLocaleString()}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-gray-400 text-sm">Current Page</div>
            <div className="text-2xl font-bold text-blue-400">
              {page} / {totalPages || 1}
            </div>
          </div>
        </div>

        {/* Contracts Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-16">
              <ArrowPathIcon className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-red-400">{error}</p>
            </div>
          ) : contracts.length === 0 ? (
            <div className="text-center py-16">
              <CodeBracketIcon className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400">No contracts found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-700/50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Address
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Type</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Verified
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Compiler
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {contracts.map((contract) => {
                    // Link to /token/ for token contracts, /contract/ for others
                    const isToken = ['VRC-20', 'VRC-721', 'VRC-1155', 'ERC20', 'ERC721'].includes(
                      contract.type
                    );
                    const linkHref = isToken
                      ? `/token/${contract.address}`
                      : `/contract/${contract.address}`;

                    return (
                      <tr key={contract.address} className="hover:bg-gray-700/50 transition-colors">
                        <td className="py-3 px-4">
                          <Link
                            href={linkHref}
                            className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors"
                            title={contract.address}
                          >
                            {formatAddress(contract.address)}
                          </Link>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-200 font-medium">
                              {contract.name || 'Unknown'}
                            </span>
                            {contract.symbol && (
                              <span className="text-gray-400 text-sm">({contract.symbol})</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              contract.type === 'VRC-20' || contract.type === 'ERC20'
                                ? 'bg-blue-500/20 text-blue-400'
                                : contract.type === 'VRC-721' || contract.type === 'ERC721'
                                  ? 'bg-purple-500/20 text-purple-400'
                                  : contract.type === 'VRC-1155'
                                    ? 'bg-pink-500/20 text-pink-400'
                                    : 'bg-gray-500/20 text-gray-400'
                            }`}
                          >
                            {contract.type || 'Contract'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {contract.verified ? (
                            <div className="flex items-center gap-1 text-green-400">
                              <CheckCircleIcon className="w-5 h-5" />
                              <span className="text-sm">Verified</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-gray-500">
                              <XCircleIcon className="w-5 h-5" />
                              <span className="text-sm">Unverified</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-gray-400 text-sm">
                            {contract.compilerVersion || '-'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {contract.blockNumber ? (
                            <Link
                              href={`/block/${contract.blockNumber}`}
                              className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                            >
                              Block #{contract.blockNumber.toLocaleString()}
                            </Link>
                          ) : (
                            <span className="text-gray-500 text-sm">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-gray-700 px-4 py-3 flex items-center justify-between">
              <div className="text-sm text-gray-400">
                Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of{' '}
                {total.toLocaleString()} contracts
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (page <= 3) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`px-3 py-1 rounded transition-colors ${
                          page === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/contract/verify"
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <CheckCircleIcon className="w-8 h-8 text-green-400" />
              <div>
                <div className="font-semibold text-gray-100">Verify Contract</div>
                <div className="text-sm text-gray-400">
                  Verify and publish your contract source code
                </div>
              </div>
            </div>
          </Link>

          <Link
            href="/tokens"
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <CodeBracketIcon className="w-8 h-8 text-blue-400" />
              <div>
                <div className="font-semibold text-gray-100">View Tokens</div>
                <div className="text-sm text-gray-400">Browse all VRC-20 and VRC-721 tokens</div>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
