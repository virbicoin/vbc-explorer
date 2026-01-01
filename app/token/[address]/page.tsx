'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  CheckCircleIcon,
  ClipboardDocumentIcon,
  UsersIcon,
  ArrowPathIcon,
  CodeBracketIcon,
  ClockIcon,
  PlayIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

interface TokenData {
  token: {
    address: string;
    name: string;
    symbol: string;
    type: string;
    isNFT: boolean;
    decimals: number;
    totalSupply: string;
    totalSupplyRaw: string;
    verified?: boolean;
    description?: string;
    floorPrice?: string;
    volume24h?: string;
    creator?: string;
    logoUrl?: string;
  };
  contract?: {
    verified: boolean;
    compiler: string | null;
    language: string | null;
    name: string;
    sourceCode: string | null;
    bytecode: string | null;
    compilerVersion?: string;
    metadataVersion?: string;
  };
  statistics?: {
    holders: number;
    transfers: number;
    age: number | string;
    marketCap: string;
    totalTransfers?: number;
    transfers24h?: number;
  };
  holders?: Array<{
    rank: number;
    address: string;
    balance: string;
    balanceRaw: string;
    percentage: string;
    tokenIds?: number[];
  }>;
  transfers?: Array<{
    hash: string;
    from: string;
    to: string;
    value: string;
    valueRaw: string;
    timestamp: string;
    timeAgo: string;
    tokenId?: string;
  }>;
  pagination?: {
    holders: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    transfers: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    nfts?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
  nftItems?: Array<{
    tokenId: number;
    owner: string;
  }>;
}

interface TokenMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
  tokenURI: string;
  createdAt?: string;
}

interface ImageLoadState {
  [tokenId: number]: 'loading' | 'loaded' | 'error' | 'initial';
}

// アドレス省略表示関数（SystemやMining Rewardはそのまま表示）
const formatAddress = (address: string) => {
  if (!address) return 'N/A';
  if (address === 'System' || address === 'Mining Reward') return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
};

export default function TokenDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const router = useRouter();
  const [address, setAddress] = useState<string>('');
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('holders');
  const [balanceAddress, setBalanceAddress] = useState<string>('');
  const [balanceResult, setBalanceResult] = useState<{
    address: string;
    balance: string;
    percentage: string;
    rank: number | null;
  } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [tokenMetadata, setTokenMetadata] = useState<Record<number, TokenMetadata>>({});
  const [metadataLoading, setMetadataLoading] = useState<Record<number, boolean>>({});
  const [imageLoadState, setImageLoadState] = useState<ImageLoadState>({});

  // Pagination states
  const [holdersPage, setHoldersPage] = useState(1);
  const [transfersPage, setTransfersPage] = useState(1);
  const [nftsPage, setNftsPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  const NFTS_PER_PAGE = 12;

  // getTransactionForTokenId function removed (unused)

  // 有効なタブIDのリスト
  const validTabs = ['holders', 'transfers', 'balance', 'source', 'tokenids'];

  // URLハッシュからタブを読み取る
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // #を除去
      if (hash && validTabs.includes(hash)) {
        setActiveTab(hash);
      }
    };

    // 初期ロード時にハッシュを読み取る
    handleHashChange();

    // ハッシュ変更イベントをリッスン
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // タブ切り替え時にURLハッシュを更新
  const handleTabChange = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      // URLハッシュを更新（履歴に追加せず置き換え）
      const url = new URL(window.location.href);
      url.hash = tabId;
      router.replace(url.toString(), { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const getParams = async () => {
      const resolvedParams = await params;
      setAddress(resolvedParams.address);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!address) return;

    const fetchTokenData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Use the unified tokens API with pagination
        const response = await fetch(
          `/api/tokens/${address}?holdersPage=${holdersPage}&holdersLimit=${ITEMS_PER_PAGE}&transfersPage=${transfersPage}&transfersLimit=${ITEMS_PER_PAGE}&nftsPage=${nftsPage}&nftsLimit=${NFTS_PER_PAGE}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch token/NFT data');
        }

        const data = await response.json();
        setTokenData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchTokenData();
  }, [address, holdersPage, transfersPage, nftsPage]);

  // Copy address to clipboard handler
  const copyAddressToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(tokenData?.token?.address || '');
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  // Check if token is an NFT (ERC721/ERC1155)
  const isNFTToken = (type: string) => {
    const nftTypes = ['ERC721', 'ERC1155', 'VRC-721', 'VRC-1155', 'NFT'];
    return nftTypes.some((t) => type.toUpperCase().includes(t.toUpperCase()));
  };

  // Add ERC20 token to MetaMask
  const addToMetaMask = async () => {
    // NFTs should use addNFTToMetaMask instead
    if (tokenData?.token?.type && isNFTToken(tokenData.token.type)) {
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

    if (!tokenData?.token || tokenData.token.type === 'Native') return;

    try {
      await ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: tokenData.token.address,
            symbol: tokenData.token.symbol.slice(0, 11),
            decimals: tokenData.token.decimals ?? 18,
            image: tokenData.token.logoUrl || undefined,
          },
        },
      });
    } catch (err: any) {
      if (err.code !== 4001) {
        console.error('Failed to add token to MetaMask:', err);
      }
    }
  };

  // Add specific NFT to MetaMask by tokenId
  const addNFTToMetaMask = async (tokenId: number | string) => {
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

    try {
      await ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC721',
          options: {
            address: tokenData?.token?.address || address,
            tokenId: String(tokenId),
          },
        },
      });
    } catch (err: any) {
      if (err.code !== 4001) {
        console.error('Failed to add NFT to MetaMask:', err);
        alert('Failed to add NFT to MetaMask. Your wallet may not support this feature.');
      }
    }
  };

  const fetchTokenMetadata = useCallback(
    async (tokenId: number) => {
      if (tokenMetadata[tokenId] || metadataLoading[tokenId]) return;

      setMetadataLoading((prev) => ({ ...prev, [tokenId]: true }));

      try {
        // Use the unified tokens API with tokenId parameter
        const response = await fetch(`/api/tokens/${address}?tokenId=${tokenId}`);

        if (!response.ok) {
          console.warn(`❌ Metadata fetch failed - Token ${tokenId}: HTTP ${response.status}`);
          return;
        }

        const data = await response.json();
        setTokenMetadata((prev) => ({
          ...prev,
          [tokenId]: data.metadata,
        }));

        // Initialize image state when metadata is loaded
        setImageLoadState((prev) => ({ ...prev, [tokenId]: 'initial' }));
      } catch (error) {
        console.error(`❌ Metadata fetch error - Token ${tokenId}:`, error);
      } finally {
        setMetadataLoading((prev) => ({ ...prev, [tokenId]: false }));
      }
    },
    [address, tokenMetadata, metadataLoading]
  );

  const checkBalance = async () => {
    if (!balanceAddress || !tokenData || !address) return;

    setBalanceLoading(true);
    try {
      // Fetch balance from API for the specific address
      const response = await fetch(`/api/tokens/${address}/balance?wallet=${balanceAddress}`);

      if (response.ok) {
        const data = await response.json();
        setBalanceResult({
          address: balanceAddress,
          balance: data.balance || '0',
          percentage: data.percentage || '0.00',
          rank: data.rank || null,
        });
      } else {
        // Fallback: Find balance for the address in current holders data
        const holder = tokenData.holders?.find(
          (h) => h.address.toLowerCase() === balanceAddress.toLowerCase()
        );

        if (holder) {
          setBalanceResult({
            address: balanceAddress,
            balance: holder.balance,
            percentage: holder.percentage,
            rank: holder.rank,
          });
        } else {
          setBalanceResult({
            address: balanceAddress,
            balance: '0',
            percentage: '0.00',
            rank: null,
          });
        }
      }
    } catch (err) {
      console.error('Error checking balance:', err);
      // Fallback to local holders data
      const holder = tokenData.holders?.find(
        (h) => h.address.toLowerCase() === balanceAddress.toLowerCase()
      );
      if (holder) {
        setBalanceResult({
          address: balanceAddress,
          balance: holder.balance,
          percentage: holder.percentage,
          rank: holder.rank,
        });
      } else {
        setBalanceResult({
          address: balanceAddress,
          balance: '0',
          percentage: '0.00',
          rank: null,
        });
      }
    } finally {
      setBalanceLoading(false);
    }
  };

  // Load metadata when tokenids tab is active and we have token data
  useEffect(() => {
    if (activeTab === 'tokenids' && tokenData && tokenData.nftItems) {
      // nftItemsからtokenIdを取得してメタデータを読み込む
      tokenData.nftItems.forEach(({ tokenId }) => {
        if (!tokenMetadata[tokenId] && !metadataLoading[tokenId]) {
          fetchTokenMetadata(tokenId);
        }
      });
    }
  }, [activeTab, tokenData, address, fetchTokenMetadata, metadataLoading, tokenMetadata]);

  // スクロール用useEffect
  useEffect(() => {
    if (activeTab === 'tokenids') {
      // タブ切り替え後に少し遅延してからスクロール
      const timer = setTimeout(() => {
        const tokenIdsSection = document.querySelector('[data-tab-content="tokenids"]');
        if (tokenIdsSection) {
          const element = tokenIdsSection as HTMLElement;
          const rect = element.getBoundingClientRect();
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const targetY = scrollTop + rect.top - 120; // ヘッダー分のオフセット

          window.scrollTo({
            top: targetY,
            behavior: 'smooth',
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // NFT固有の情報を表示するかどうかを判定
  const isNFT = tokenData?.token?.isNFT || tokenData?.token?.type === 'VRC-721';

  // Pagination component
  const PaginationUI = ({
    currentPage,
    totalPages,
    total,
    itemsPerPage,
    onPageChange,
    itemName = 'items',
  }: {
    currentPage: number;
    totalPages: number;
    total: number;
    itemsPerPage: number;
    onPageChange: (page: number) => void;
    itemName?: string;
  }) => {
    if (totalPages <= 1) return null;

    return (
      <div className="mt-6">
        <div className="flex justify-center items-center gap-4">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Previous
          </button>

          <div className="flex items-center gap-2">
            {currentPage > 3 && (
              <>
                <button
                  onClick={() => onPageChange(1)}
                  className="px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors font-medium"
                >
                  1
                </button>
                {currentPage > 4 && <span className="text-gray-500">...</span>}
              </>
            )}

            {Array.from({ length: 5 }, (_, i) => currentPage - 2 + i)
              .filter((page) => page >= 1 && page <= totalPages)
              .map((page) => (
                <button
                  key={page}
                  onClick={() => onPageChange(page)}
                  className={`px-3 py-2 rounded-lg transition-colors font-medium ${
                    page === currentPage
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {page}
                </button>
              ))}

            {currentPage < totalPages - 2 && (
              <>
                {currentPage < totalPages - 3 && <span className="text-gray-500">...</span>}
                <button
                  onClick={() => onPageChange(totalPages)}
                  className="px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors font-medium"
                >
                  {totalPages}
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Next
          </button>
        </div>

        <div className="text-center mt-4 text-gray-400 text-sm">
          Showing {itemName} {(currentPage - 1) * itemsPerPage + 1} to{' '}
          {Math.min(currentPage * itemsPerPage, total)} of {total.toLocaleString()} total
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'holders', label: 'Token Holders', icon: UsersIcon },
    { id: 'transfers', label: 'Recent Transfers', icon: ArrowPathIcon },
    { id: 'balance', label: 'Get Balance', icon: UsersIcon },
    ...(isNFT ? [{ id: 'tokenids', label: 'NFT Collections', icon: PhotoIcon }] : []),
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'balance':
        return (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                placeholder="Enter wallet address to check balance"
                className="flex-1 bg-gray-700 border border-gray-600 text-gray-200 rounded px-4 py-2 focus:border-blue-500 focus:outline-none"
                value={balanceAddress}
                onChange={(e) => setBalanceAddress(e.target.value)}
              />
              <button
                onClick={checkBalance}
                disabled={balanceLoading || !balanceAddress}
                className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white rounded transition-colors"
              >
                {balanceLoading ? 'Checking...' : 'Check Balance'}
              </button>
            </div>

            {balanceResult && (
              <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                <h4 className="text-lg font-semibold text-gray-100 mb-3">Balance Result</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Address:</span>
                    <span className="text-blue-400 font-mono text-sm">{balanceResult.address}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Token Balance:</span>
                    <span className="text-green-400 font-bold">
                      {balanceResult.balance} {tokenData?.token?.symbol || ''}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Percentage of Supply:</span>
                    <span className="text-purple-400">{balanceResult.percentage}%</span>
                  </div>
                  {balanceResult.rank && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Holder Rank:</span>
                      <span className="text-yellow-400">#{balanceResult.rank}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'transfers':
        // MetaMask準拠のトランザクションタイプバッジを生成（他のページと統一）
        const getTransferTypeBadge = (from: string | null | undefined, to: string | null | undefined) => {
          const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
          const DEAD_ADDR = '0x000000000000000000000000000000000000dead';
          
          const fromLower = (from || '').toLowerCase();
          const toLower = (to || '').toLowerCase();

          // Mint (from zero address or "System")
          if (fromLower === ZERO_ADDR || from === 'System') {
            return (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
                <span>✨</span>
                <span>Mint</span>
              </span>
            );
          }

          // Burn (to zero address or dead address)
          if (toLower === ZERO_ADDR || toLower === DEAD_ADDR || to === 'System') {
            return (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">
                <span>🔥</span>
                <span>Burn</span>
              </span>
            );
          }

          // Regular transfer
          return (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
              <span>⇄</span>
              <span>Token Transfer</span>
            </span>
          );
        };

        const transfersList = isNFT
          ? (tokenData?.transfers || [])
              .filter((tx) => tx.tokenId !== undefined)
              .sort((a, b) => Number(b.tokenId) - Number(a.tokenId))
          : tokenData?.transfers || [];

        return (
          <div className="space-y-4">
            {transfersList.length > 0 ? (
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
                        From
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">To</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Value
                      </th>
                      {isNFT && (
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                          Token ID
                        </th>
                      )}
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {transfersList.map((transfer, index) => (
                      <tr key={index} className="hover:bg-gray-700/50 transition-colors">
                        <td className="py-3 px-4">
                          <Link
                            href={transfer.hash ? `/tx/${transfer.hash}` : '#'}
                            className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors"
                          >
                            {transfer.hash
                              ? `${transfer.hash.slice(0, 10)}...${transfer.hash.slice(-6)}`
                              : 'N/A'}
                          </Link>
                        </td>
                        <td className="py-3 px-4">
                          {getTransferTypeBadge(transfer.from, transfer.to)}
                        </td>
                        <td className="py-3 px-4">
                          {transfer.from === 'System' ||
                          transfer.from === '0x0000000000000000000000000000000000000000' ? (
                            <span className="text-emerald-400 text-sm">System (Mint)</span>
                          ) : (
                            <Link
                              href={`/address/${transfer.from}`}
                              className="text-green-400 hover:text-green-300 font-mono text-sm transition-colors"
                            >
                              {formatAddress(transfer.from)}
                            </Link>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {(() => {
                            const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
                            const DEAD_ADDR = '0x000000000000000000000000000000000000dead';
                            const toLower = transfer.to?.toLowerCase() || '';
                            const isBurn =
                              transfer.to === 'System' ||
                              toLower === ZERO_ADDR ||
                              toLower === DEAD_ADDR;

                            return isBurn ? (
                              <span className="text-red-400 text-sm">Burn Address</span>
                            ) : (
                              <Link
                                href={`/address/${transfer.to}`}
                                className="text-red-400 hover:text-red-300 font-mono text-sm transition-colors"
                              >
                                {formatAddress(transfer.to)}
                              </Link>
                            );
                          })()}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-green-400 font-medium">
                            {transfer.value} {tokenData?.token?.symbol || ''}
                          </span>
                        </td>
                        {isNFT && (
                          <td className="py-3 px-4">
                            <Link
                              href={`/token/${address}/${transfer.tokenId}`}
                              className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors"
                            >
                              #
                              {transfer.tokenId === undefined || transfer.tokenId === null
                                ? '0'
                                : transfer.tokenId}
                            </Link>
                          </td>
                        )}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <ClockIcon className="w-4 h-4 text-gray-500" />
                            <div>
                              <div className="text-sm text-gray-300">{transfer.timeAgo}</div>
                              <div className="text-xs text-gray-500">
                                {new Date(transfer.timestamp).toLocaleString(undefined, {
                                  timeZoneName: 'short',
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <ArrowPathIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">No transfers found</p>
              </div>
            )}

            {/* Transfers Pagination */}
            {tokenData?.pagination?.transfers && (
              <PaginationUI
                currentPage={transfersPage}
                totalPages={tokenData.pagination.transfers.totalPages}
                total={tokenData.pagination.transfers.total}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setTransfersPage}
                itemName="transfers"
              />
            )}
          </div>
        );

      case 'source':
        // Redirect to contract page
        return (
          <div className="text-center py-12">
            <CodeBracketIcon className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-100 mb-2">
              Contract Source Code
            </h3>
            <p className="text-gray-400 mb-6">
              View contract source code, ABI, and bytecode on the contract page.
            </p>
            <Link
              href={`/contract/${address}?tab=code`}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <CodeBracketIcon className="w-5 h-5" />
              View Contract Code
            </Link>
          </div>
        );

      case 'tokenids':
        return (
          <div
            data-tab-content="tokenids"
            className="space-y-4 animate-fadeIn"
            style={{
              animation: 'fadeIn 0.6s ease-out',
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tokenData?.nftItems && tokenData.nftItems.length > 0 ? (
                // nftItemsを使用してNFT一覧を表示（既にtokenId降順でソート済み）
                tokenData.nftItems.map(({ tokenId, owner }) => {
                  const metadata = tokenMetadata[tokenId];
                  const isLoading = metadataLoading[tokenId];

                  return (
                    <div
                      key={`nft-${tokenId}`}
                      className="bg-gray-700/50 rounded-lg p-4 border border-gray-600 hover:border-gray-500 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-gray-400">Token ID:</span>
                        <Link
                          href={`/token/${address}/${tokenId}`}
                          className="text-blue-400 font-bold hover:underline"
                        >
                          #{tokenId}
                        </Link>
                      </div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-gray-400">Owner:</span>
                        <Link
                          href={`/address/${owner}`}
                          className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all"
                        >
                          {formatAddress(owner)}
                        </Link>
                      </div>

                      {/* NFT Image and Metadata */}
                      <div className="w-full bg-gray-800 rounded border border-gray-600 overflow-hidden">
                        {isLoading ? (
                          <div className="h-48 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                          </div>
                        ) : metadata ? (
                          <div>
                            {metadata.image ? (
                              <Link
                                href={`/token/${address}/${tokenId}`}
                                className="block w-full h-48 rounded-t-lg overflow-hidden shadow hover:opacity-90 transition-opacity cursor-pointer"
                                title="View NFT detail page"
                              >
                                {/* Loading state */}
                                {imageLoadState[tokenId] === 'loading' && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-gray-800 z-15">
                                    <div className="text-center">
                                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                                      <span className="text-xs text-gray-400">
                                        Loading image...
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Error state */}
                                {imageLoadState[tokenId] === 'error' && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-red-900/20 z-15">
                                    <div className="text-center">
                                      <span className="text-xs text-red-400">Load failed</span>
                                      <div className="text-xs text-gray-500 mt-1 px-2 break-all">
                                        {metadata.image}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Main image with link */}
                                <Image
                                  src={metadata.image}
                                  alt={metadata.name || `Token #${tokenId}`}
                                  width={320}
                                  height={192}
                                  style={{ objectFit: 'cover', width: '100%', height: '192px' }}
                                  className={`w-full h-48 object-cover z-10 ${
                                    imageLoadState[tokenId] === 'loaded'
                                      ? 'opacity-100'
                                      : 'opacity-0'
                                  }`}
                                  onLoadStart={() => {
                                    setImageLoadState((prev) => ({
                                      ...prev,
                                      [tokenId]: 'loading',
                                    }));
                                  }}
                                  onLoad={() => {
                                    setImageLoadState((prev) => ({ ...prev, [tokenId]: 'loaded' }));
                                  }}
                                  onError={() => {
                                    setImageLoadState((prev) => ({ ...prev, [tokenId]: 'error' }));
                                  }}
                                  unoptimized
                                />
                              </Link>
                            ) : (
                              <div className="h-48 flex items-center justify-center bg-gray-800">
                                <span className="text-gray-500 text-sm">No image</span>
                              </div>
                            )}

                            {/* Metadata info */}
                            <div className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <h5 className="font-semibold text-gray-200 flex items-center gap-2">
                                  {(() => {
                                    // const txHash = getTransactionForTokenId(tokenId);
                                    const title = metadata.name || `Token #${tokenId}`;
                                    const tokenDetailUrl = `/token/${address}/${tokenId}`;
                                    return (
                                      <Link
                                        href={tokenDetailUrl}
                                        className="text-blue-400 hover:text-blue-300 transition-colors"
                                        title="NFT詳細ページへ"
                                      >
                                        {title}
                                      </Link>
                                    );
                                  })()}
                                </h5>
                                {/* createdAtを右側に表示 */}
                                {metadata.createdAt && (
                                  <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
                                    Created: {new Date(metadata.createdAt).toLocaleString()}
                                  </span>
                                )}
                              </div>
                              {/* descriptionを必ず表示 */}
                              <p className="text-sm text-gray-400 mb-2">
                                {metadata.description || '-'}
                              </p>
                              {/* Attributes */}
                              {metadata.attributes && metadata.attributes.length > 0 && (
                                <div className="space-y-1">
                                  <span className="text-xs text-gray-500 font-medium">
                                    Attributes:
                                  </span>
                                  <div className="flex flex-wrap gap-1">
                                    {metadata.attributes.map((attr, idx) => (
                                      <span
                                        key={idx}
                                        className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded"
                                      >
                                        {attr.trait_type}: {attr.value}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* Add to MetaMask button - right aligned */}
                              <div className="flex justify-end mt-2">
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    addNFTToMetaMask(tokenId);
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg transition-colors text-xs font-medium"
                                  title="Add this NFT to MetaMask"
                                >
                                  🦊 Add to MetaMask
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="h-48 flex items-center justify-center bg-gray-800">
                            <span className="text-gray-500 text-sm">No metadata</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="col-span-full text-center py-8">
                  <p className="text-gray-400">No token IDs found</p>
                </div>
              )}
            </div>

            {/* NFT Collections Pagination */}
            {tokenData?.pagination?.nfts && (
              <PaginationUI
                currentPage={nftsPage}
                totalPages={tokenData.pagination.nfts.totalPages}
                total={tokenData.pagination.nfts.total}
                itemsPerPage={NFTS_PER_PAGE}
                onPageChange={setNftsPage}
                itemName="NFTs"
              />
            )}
          </div>
        );

      default:
        return (
          <div className="space-y-4">
            {tokenData?.holders && tokenData.holders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Rank
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Address
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Balance
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                        Percentage
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {tokenData.holders.map((holder) => (
                      <tr
                        key={`${holder.address}-${holder.rank}`}
                        className="hover:bg-gray-700/50 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <span className="text-yellow-400 font-bold">#{holder.rank}</span>
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/address/${holder.address}`}
                            className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors"
                          >
                            {formatAddress(holder.address)}
                          </Link>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-green-400 font-medium">
                            {holder.balance} {tokenData?.token?.symbol || ''}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-gray-300">{holder.percentage}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <UsersIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">No holders found</p>
              </div>
            )}

            {/* Holders Pagination */}
            {tokenData?.pagination?.holders && (
              <PaginationUI
                currentPage={holdersPage}
                totalPages={tokenData.pagination.holders.totalPages}
                total={tokenData.pagination.holders.total}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setHoldersPage}
                itemName="holders"
              />
            )}
          </div>
        );
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header-container">
          <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-2 text-gray-100">Token Details</h1>
            <p className="text-gray-400">Loading token information...</p>
          </div>
        </div>
        <main className="container mx-auto px-4 py-8">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
              <p className="text-gray-400 mt-2">Loading token data...</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-header-container">
          <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-2 text-gray-100">Token Details</h1>
            <p className="text-gray-400">Error loading token information</p>
          </div>
        </div>
        <main className="container mx-auto px-4 py-8">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="text-center py-8">
              <p className="text-red-400">Error: {error}</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (!tokenData) {
    return null;
  }

  return (
    <>
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-blue-500/20 p-2 rounded-lg">
              <UsersIcon className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  tokenData?.token?.type === 'VRC-721'
                    ? 'bg-purple-500/20 text-purple-400'
                    : tokenData?.token?.type === 'VRC-1155'
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {tokenData?.token?.type || 'Token'}
                </span>
                <h1 className="text-2xl font-bold text-gray-100">
                  {tokenData?.token?.name || 'Token'} ({tokenData?.token?.symbol || ''})
                </h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="font-mono text-gray-400 text-sm">{tokenData?.token?.address}</span>
            <button
              onClick={copyAddressToClipboard}
              className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
              title="Copy address"
            >
              <ClipboardDocumentIcon className="w-4 h-4" />
            </button>
            {copiedAddress && <span className="text-green-400 text-xs">Copied!</span>}
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6">
        {/* Overview Section - GnosisScan Style 2 Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Left Column - Overview */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <UsersIcon className="w-5 h-5 text-blue-400" />
                Overview
              </h3>
              
              <div className="space-y-4">
                {/* Max Total Supply */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">Max Total Supply</span>
                  <span className="text-white font-medium">
                    {tokenData?.token?.totalSupply || '0'} {tokenData?.token?.symbol || ''}
                  </span>
                </div>
                
                {/* Holders */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">Holders</span>
                  <span className="text-white font-medium">
                    {(tokenData?.statistics?.holders || 0).toLocaleString()} addresses
                  </span>
                </div>
                
                {/* Total Transfers */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">Total Transfers</span>
                  <span className="text-white font-medium">
                    {(tokenData?.statistics?.transfers || tokenData?.transfers?.length || 0).toLocaleString()}
                  </span>
                </div>

                {/* 24h Transfers */}
                <div className="flex justify-between items-center py-3">
                  <span className="text-gray-400">24h Transfers</span>
                  <span className="text-white font-medium">
                    {(tokenData?.statistics?.transfers24h || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - More Info */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <CodeBracketIcon className="w-5 h-5 text-purple-400" />
                More Info
              </h3>
              
              <div className="space-y-4">
                {/* Contract */}
                <div className="py-3 border-b border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">Contract</div>
                  <Link 
                    href={`/contract/${tokenData?.token?.address}`}
                    className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all"
                  >
                    {tokenData?.token?.address?.slice(0, 10)}...{tokenData?.token?.address?.slice(-8)}
                  </Link>
                </div>

                {/* Creator */}
                {tokenData?.token?.creator && (
                  <div className="py-3 border-b border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Creator</div>
                    <Link 
                      href={`/address/${tokenData.token.creator}`}
                      className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all"
                    >
                      {formatAddress(tokenData.token.creator)}
                    </Link>
                  </div>
                )}

                {/* Decimals */}
                <div className="py-3 border-b border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">Decimals</div>
                  <span className="text-white font-medium">{tokenData?.token?.decimals ?? 18}</span>
                </div>

                {/* Verification Status */}
                <div className="py-3">
                  <div className="text-gray-400 text-sm mb-1">Contract Verification</div>
                  {tokenData?.contract?.verified ? (
                    <div className="flex items-center gap-2 text-green-400">
                      <CheckCircleIcon className="w-5 h-5" />
                      <span className="font-medium">Verified</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-yellow-400">
                      <span className="font-medium">Not Verified</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="flex flex-col gap-2">
                {tokenData?.token?.type && !isNFTToken(tokenData.token.type) && (
                  <button
                    onClick={addToMetaMask}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm font-medium"
                  >
                    🦊 Add to MetaMask
                  </button>
                )}
                <Link
                  href={`/contract/${tokenData?.token?.address}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                >
                  <PlayIcon className="w-4 h-4" />
                  View Contract
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Section */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="border-b border-gray-700">
            <div className="flex gap-1 px-4 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'text-blue-400 border-b-2 border-blue-400'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-6" data-tab-content={activeTab}>
            {renderTabContent()}
          </div>
        </div>
      </main>
    </>
  );
}
