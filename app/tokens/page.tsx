'use client';
import Link from 'next/link';
import Image from 'next/image';
import { CubeTransparentIcon, CheckCircleIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import {
  getCurrencyName,
  getCurrencySymbol,
  initializeCurrencyConfig,
} from '../../lib/client-config';
import { initializeCurrency } from '../../lib/bigint-utils';
import { getTokenIcon, getTokenColor } from '../../lib/token-icons';

type Token = {
  symbol: string;
  name: string;
  address: string;
  holders: number;
  supply: string;
  type: string;
  verified?: boolean;
  decimals?: number;
  logoUrl?: string;
};

// Check if token is an NFT (ERC721/ERC1155)
const isNFTToken = (type: string) => {
  const nftTypes = ['ERC721', 'ERC1155', 'VRC-721', 'VRC-1155', 'NFT'];
  return nftTypes.some((t) => type.toUpperCase().includes(t.toUpperCase()));
};

// MetaMask追加関数
const addToMetaMask = async (token: Token) => {
  // NFTs cannot be added to MetaMask as ERC20 tokens
  if (isNFTToken(token.type)) {
    alert('NFT tokens cannot be added to MetaMask wallet.');
    return;
  }

  // Wait for ethereum to be injected
  let ethereum = (window as any).ethereum;
  if (!ethereum) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    ethereum = (window as any).ethereum;
  }

  if (!ethereum) {
    const confirmed = confirm('No Web3 wallet detected. Would you like to install MetaMask?');
    if (confirmed) {
      window.open('https://metamask.io/download/', '_blank');
    }
    return;
  }

  if (token.type === 'Native' || token.address === 'N/A') return;

  try {
    await ethereum.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: token.address,
          symbol: token.symbol.slice(0, 11),
          decimals: token.decimals ?? 18,
          image: token.logoUrl || undefined,
        },
      },
    });
  } catch (err: any) {
    if (err.code !== 4001) {
      console.error('Failed to add token to MetaMask:', err);
    }
  }
};

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [currencyName, setCurrencyName] = useState<string>('');
  const [currencySymbol, setCurrencySymbol] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'all' | 'nft'>('all');
  const [nativeSupply, setNativeSupply] = useState<string>('0');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTokens, setTotalTokens] = useState(0);
  const ITEMS_PER_PAGE = 50;

  // Fetch native token total supply from richlist API
  const fetchNativeSupply = async () => {
    try {
      const res = await fetch('/api/richlist?page=1&limit=1');
      if (res.ok) {
        const data = await res.json();
        const totalSupply = data.statistics?.totalSupply || 0;
        // Convert from Wei to native currency and format
        const supply = (totalSupply / 1e18).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
        setNativeSupply(supply);
      }
    } catch (error) {
      console.error('Error fetching native supply:', error);
      setNativeSupply('0');
    }
  };

  useEffect(() => {
    async function fetchTokens() {
      try {
        setLoading(true);

        // Initialize currency conversion factors
        await initializeCurrency();

        // Initialize currency config cache
        await initializeCurrencyConfig();

        // Load config values (now from initialized cache)
        const name = getCurrencyName();
        const symbol = getCurrencySymbol();
        setCurrencyName(name);
        setCurrencySymbol(symbol);

        // Fetch tokens with pagination
        const typeParam = activeTab === 'nft' ? 'nft' : 'vrc20';
        const res = await fetch(
          `/api/tokens?page=${currentPage}&limit=${ITEMS_PER_PAGE}&type=${typeParam}`
        );
        if (!res.ok) throw new Error('Failed to fetch tokens');
        const data = await res.json();

        // Sort tokens (Native first, then by address descending)
        const sortedTokens = (data.tokens || []).sort((a: Token, b: Token) => {
          // Nativeトークン（VBC）は最初に表示
          if (a.type === 'Native') return -1;
          if (b.type === 'Native') return 1;

          // その他のトークンはアドレスでソート（新しい順）
          return b.address.localeCompare(a.address);
        });
        setTokens(sortedTokens);

        // Update pagination info
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages || 1);
          setTotalTokens(data.pagination.total || 0);
        }
      } catch {
        setTokens([]);
      } finally {
        setLoading(false);
      }
    }
    fetchTokens();

    // Fetch native token supply from richlist API
    fetchNativeSupply();
  }, [activeTab, currentPage]);

  // Reset to page 1 when tab changes
  const handleTabChange = (tab: 'all' | 'nft') => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  // Use tokens directly since filtering is done server-side
  const filteredTokens = tokens;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <CubeTransparentIcon className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold text-gray-100">Tokens & NFTs</h1>
          </div>
          <p className="text-gray-400">
            Explore tokens and NFT collections on the {currencyName} network
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Total Tokens</h3>
            <p className="text-2xl font-bold text-blue-400">{loading ? '-' : tokens.length}</p>
            <p className="text-xs text-gray-400">Contracts deployed</p>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
            <h3 className="text-sm font-medium text-gray-300 mb-2">NFT Collections</h3>
            <p className="text-2xl font-bold text-purple-400">
              {loading
                ? '-'
                : tokens.filter((t) => t.type === 'VRC-721' || t.type === 'VRC-1155').length}
            </p>
            <p className="text-xs text-gray-400">NFT contracts</p>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Total Holders</h3>
            <p className="text-2xl font-bold text-yellow-400">
              {loading
                ? '-'
                : tokens.reduce((sum, token) => sum + (token.holders || 0), 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400">Unique addresses</p>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Contract Types</h3>
            <p className="text-2xl font-bold text-orange-400">
              {loading ? '-' : new Set(tokens.map((t) => t.type)).size}
            </p>
            <p className="text-xs text-gray-400">Different standards</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => handleTabChange('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <CubeTransparentIcon className="w-4 h-4" />
              VRC-20 Tokens
            </button>
            <button
              onClick={() => handleTabChange('nft')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'nft'
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <PhotoIcon className="w-4 h-4" />
              NFT Collections
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300">Token</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300">
                    Contract Address
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300 w-24">
                    Actions
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300 w-32">
                    Verify
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300">Holders</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-300">
                    Total Supply
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12">
                      <div className="flex justify-center items-center">
                        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredTokens.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-400">
                      {activeTab === 'nft' ? 'No NFT collections found' : 'No tokens found'}
                    </td>
                  </tr>
                ) : (
                  filteredTokens.map((token, index) => {
                    const iconUrl = getTokenIcon(token.symbol, token.address);
                    return (
                    <tr
                      key={`${token.address}-${index}`}
                      className="hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getTokenColor(token.symbol)} flex items-center justify-center shadow-md overflow-hidden`}>
                            {iconUrl ? (
                              <Image
                                src={iconUrl}
                                alt={token.symbol}
                                width={28}
                                height={28}
                                className="object-contain"
                              />
                            ) : (
                              <span className="font-bold text-white text-xs">
                                {token.symbol?.charAt(0) || '?'}
                              </span>
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-gray-200">{token.symbol}</div>
                            <div className="text-sm text-gray-400">{token.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-3 py-1 rounded text-sm font-medium ${
                            token.type === 'Native'
                              ? 'bg-cyan-500/20 text-cyan-400'
                              : token.type === 'VRC-20'
                                ? 'bg-blue-500/20 text-blue-400'
                                : token.type === 'VRC-721'
                                  ? 'bg-purple-500/20 text-purple-400'
                                  : token.type === 'VRC-1155'
                                    ? 'bg-orange-500/20 text-orange-400'
                                    : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {token.type}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {token.type === 'Native' ? (
                            <span className="font-mono text-gray-400 break-all">N/A</span>
                          ) : token.address === 'N/A' ? (
                            <span className="font-mono text-gray-400 break-all">N/A</span>
                          ) : (
                            <Link
                              href={`/token/${token.address}`}
                              className="font-mono text-blue-400 hover:text-blue-300 transition-colors break-all"
                            >
                              {token.address}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 w-24">
                        {token.type !== 'Native' &&
                          token.address !== 'N/A' &&
                          !isNFTToken(token.type) && (
                            <button
                              onClick={() => addToMetaMask(token)}
                              className="p-2 hover:bg-gray-600 rounded-lg transition-colors"
                              title="Add to MetaMask"
                            >
                              🦊
                            </button>
                          )}
                      </td>
                      <td className="py-3 px-4 w-32">
                        {token.type !== 'Native' && token.verified ? (
                          <span className="flex items-center gap-1 px-3 py-1 bg-green-500/20 text-green-400 rounded text-sm font-medium w-fit">
                            <CheckCircleIcon className="w-4 h-4" />
                            <span>Verified</span>
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-yellow-400 text-lg font-bold">
                          {token.holders?.toLocaleString?.() ?? '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-green-400 text-lg font-bold">
                          {token.type === 'Native'
                            ? `${nativeSupply} ${currencySymbol}`
                            : token.supply
                              ? `${token.supply} ${token.symbol}`
                              : '-'}
                        </span>
                      </td>
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>
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
              {/* 最初のページ */}
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

              {/* 現在のページ周辺 */}
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

              {/* 最後のページ */}
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

        {/* ページ情報 */}
        {totalTokens > 0 && (
          <div className="text-center mt-4 text-gray-400 text-sm">
            Showing tokens {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, totalTokens)} of {totalTokens.toLocaleString()}{' '}
            total {activeTab === 'nft' ? 'NFT collections' : 'tokens'}
          </div>
        )}
      </main>
    </div>
  );
}
