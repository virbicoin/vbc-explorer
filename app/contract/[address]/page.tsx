'use client';

import { useState, useEffect, useCallback, use } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  CodeBracketIcon,
  ClockIcon,
  CubeIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  PlayIcon,
  DocumentTextIcon,
  ArrowTopRightOnSquareIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

interface ContractData {
  address: string;
  name: string;
  verified: boolean;
  compilerVersion?: string;
  optimization?: boolean;
  optimizationRuns?: number;
  evmVersion?: string;
  license?: string;
  verifiedAt?: string;
  sourceCode?: string;
  abi?: string;
  byteCode?: string;
  balance?: string;
  transactionCount?: number;
  creator?: string;
  creationTx?: string;
  blockNumber?: number;
  // Token info (if this contract is a token)
  isToken?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenTotalSupply?: string;
  tokenHolders?: number;
  tokenType?: string;
}

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number | string | Date | null;
  blockNumber: number;
  method?: string;
  type?: string;
  action?: string;
  tokenInfo?: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    type: string;
    value: string;
    tokenId?: number;
  };
}

interface TokenTransfer {
  transactionHash: string;
  from: string;
  to: string;
  value: string;
  tokenAddress: string;
  timestamp: number | string | Date | null;
  blockNumber: number;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

interface TokenHolding {
  address: string;
  name: string;
  symbol: string;
  balance: string;
  decimals: number;
  type: string;
}

export default function ContractPage({ params }: { params: Promise<{ address: string }> }) {
  const resolvedParams = use(params);
  const address = resolvedParams.address;

  const [contract, setContract] = useState<ContractData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tokenTransfers, setTokenTransfers] = useState<TokenTransfer[]>([]);
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'code' | 'transactions' | 'tokenTransfers'>('overview');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  // Transactions pagination
  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const [txLoading, setTxLoading] = useState(false);
  const [totalTxCount, setTotalTxCount] = useState(0);
  const txPerPage = 25;

  const fetchContractData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch contract status
      const statusRes = await fetch(`/api/contract/status/${address}`);
      const statusData = await statusRes.json();

      // Fetch address data for balance and transactions
      const addressRes = await fetch(`/api/address/${address}`);
      const addressData = await addressRes.json();

      if (!addressData.contract?.isContract) {
        setError('This address is not a contract');
        setLoading(false);
        return;
      }

      setContract({
        address: address,
        name: statusData.contractName || addressData.contract?.name || 'Unverified Contract',
        verified: statusData.verified || false,
        compilerVersion: statusData.compilerVersion || null,
        optimization: statusData.optimization,
        optimizationRuns: statusData.optimizationRuns || 200,
        evmVersion: statusData.evmVersion || 'default',
        license: statusData.license || 'None',
        verifiedAt: statusData.verifiedAt,
        sourceCode: statusData.sourceCode,
        abi: statusData.abi,
        byteCode: statusData.byteCode,
        balance: addressData.account?.balance || '0',
        transactionCount: addressData.account?.transactionCount || 0,
        creator: statusData.owner || addressData.contract?.creator || '',
        creationTx:
          statusData.creationTransaction || addressData.contract?.creationTransaction || '',
        blockNumber: statusData.blockNumber || addressData.contract?.blockNumber || 0,
      });

      // Don't set transactions here - will be fetched separately

      // Fetch token info if this is a token contract
      try {
        const tokenRes = await fetch(`/api/tokens/${address}`);
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData && tokenData.address) {
            setContract(prev => prev ? {
              ...prev,
              isToken: true,
              tokenName: tokenData.name,
              tokenSymbol: tokenData.symbol,
              tokenDecimals: tokenData.decimals,
              tokenTotalSupply: tokenData.totalSupply,
              tokenHolders: tokenData.holders,
              tokenType: tokenData.type || 'VRC-20',
            } : prev);

            // Set token transfers
            if (tokenData.transfers) {
              setTokenTransfers(tokenData.transfers);
            }
          }
        }
      } catch {
        // Not a token contract, ignore
      }

      // Fetch token holdings for this contract
      try {
        const holdingsRes = await fetch(`/api/address/${address}/tokens`);
        if (holdingsRes.ok) {
          const holdingsData = await holdingsRes.json();
          if (holdingsData.tokens) {
            setTokenHoldings(holdingsData.tokens);
          }
        }
      } catch {
        // No token holdings, ignore
      }
    } catch (err) {
      setError('Failed to fetch contract data');
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Fetch transactions with pagination
  const fetchTransactions = useCallback(async (page: number) => {
    try {
      setTxLoading(true);
      const response = await fetch(
        `/api/address/${address}/transactions?page=${page}&limit=${txPerPage}`
      );
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
        setTxTotalPages(data.totalPages || 1);
        setTotalTxCount(data.totalTransactions || 0);
      }
    } catch {
      // ignore
    } finally {
      setTxLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchContractData();
  }, [fetchContractData]);

  // Fetch transactions when page changes or tab becomes active
  useEffect(() => {
    if (activeTab === 'transactions') {
      fetchTransactions(txPage);
    }
  }, [activeTab, txPage, fetchTransactions]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(label);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedItem(label);
      setTimeout(() => setCopiedItem(null), 2000);
    }
  };

  const formatAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
  };

  // Format token value with decimals
  const formatTokenValue = (value: string, decimals: number = 18) => {
    try {
      const numValue = BigInt(value);
      const divisor = BigInt(10 ** decimals);
      const integerPart = numValue / divisor;
      const remainder = numValue % divisor;
      
      // Format with up to 6 decimal places
      const decimalStr = remainder.toString().padStart(decimals, '0');
      const significantDecimals = decimalStr.slice(0, 6).replace(/0+$/, '');
      
      if (significantDecimals) {
        return `${integerPart.toLocaleString()}.${significantDecimals}`;
      }
      return integerPart.toLocaleString();
    } catch {
      return value;
    }
  };

  const formatTimestamp = (timestamp: number | string | Date | null | undefined) => {
    if (timestamp === null || timestamp === undefined) return 'Unknown';
    
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else if (typeof timestamp === 'number') {
      // Unix timestamp (seconds) - convert to milliseconds
      date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    } else {
      return 'Unknown';
    }
    
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const getTimeAgo = (timestamp: number | string | Date | null | undefined) => {
    if (timestamp === null || timestamp === undefined) return 'Unknown';
    
    let targetTime: number;
    if (timestamp instanceof Date) {
      targetTime = timestamp.getTime();
    } else if (typeof timestamp === 'string') {
      targetTime = new Date(timestamp).getTime();
    } else if (typeof timestamp === 'number') {
      // Unix timestamp (seconds) - convert to milliseconds
      targetTime = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
    } else {
      return 'Unknown';
    }
    
    if (isNaN(targetTime)) return 'Unknown';
    
    const now = Date.now();
    const diff = Math.floor((now - targetTime) / 1000);
    
    if (diff < 0) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // MetaMask準拠のトランザクションタイプバッジを生成
  const getTransactionTypeBadge = (type?: string, action?: string) => {
    const typeConfig: Record<string, { bg: string; text: string; icon: string }> = {
      send: { bg: 'bg-red-100', text: 'text-red-700', icon: '↑' },
      receive: { bg: 'bg-green-100', text: 'text-green-700', icon: '↓' },
      token_transfer: { bg: 'bg-purple-100', text: 'text-purple-700', icon: '⇆' },
      nft_transfer: { bg: 'bg-pink-100', text: 'text-pink-700', icon: '🖼' },
      approve: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '✓' },
      swap: { bg: 'bg-blue-100', text: 'text-blue-700', icon: '⇋' },
      liquidity: { bg: 'bg-cyan-100', text: 'text-cyan-700', icon: '💧' },
      stake: { bg: 'bg-orange-100', text: 'text-orange-700', icon: '📌' },
      unstake: { bg: 'bg-amber-100', text: 'text-amber-700', icon: '📤' },
      harvest: { bg: 'bg-lime-100', text: 'text-lime-700', icon: '🌾' },
      mint: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: '✨' },
      burn: { bg: 'bg-red-200', text: 'text-red-800', icon: '🔥' },
      contract_creation: { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: '📄' },
      contract_interaction: { bg: 'bg-violet-100', text: 'text-violet-700', icon: '📝' },
      mining_reward: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '⛏️' },
    };

    const config = typeConfig[type || 'contract_interaction'] || typeConfig.contract_interaction;
    const displayAction = action || type || 'Transaction';

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}
      >
        <span>{config.icon}</span>
        <span>{displayAction}</span>
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading contract details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="bg-red-900/20 border border-red-600 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <XCircleIcon className="w-6 h-6 text-red-400" />
              <h1 className="text-xl font-semibold text-red-400">Error</h1>
            </div>
            <p className="text-red-300 mb-4">{error}</p>
            <button
              onClick={fetchContractData}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Page Header */}
      <div className="page-header-container">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold mb-2 text-gray-100">Contract Details</h1>
          <p className="text-gray-400">
            Smart contract information and source code for {contract?.name || 'this contract'}
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Token Tracker Banner (if this is a token contract) */}
        {contract?.isToken && (
          <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 rounded-lg border border-purple-500/30 p-4 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-purple-500/20 p-2 rounded-lg">
                  <CubeIcon className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <div className="text-sm text-gray-400">Token Tracker</div>
                  <Link 
                    href={`/token/${address}`}
                    className="text-lg font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    {contract.tokenType}: {contract.tokenName} ({contract.tokenSymbol})
                  </Link>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-gray-400">Total Supply:</span>
                  <span className="ml-2 text-white font-medium">
                    {contract.tokenTotalSupply ? formatTokenValue(contract.tokenTotalSupply, contract.tokenDecimals || 18) : '0'} {contract.tokenSymbol}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Holders:</span>
                  <span className="ml-2 text-white font-medium">{contract.tokenHolders?.toLocaleString() || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Overview Section - 2 Column Layout like GnosisScan */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Left Column - Overview */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <CubeIcon className="w-5 h-5 text-blue-400" />
                Overview
              </h3>
              
              <div className="space-y-4">
                {/* Balance */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">VBC Balance</span>
                  <span className="text-white font-medium">{contract?.balance || '0'} VBC</span>
                </div>
                
                {/* Token Holdings */}
                {tokenHoldings.length > 0 && (
                  <div className="flex justify-between items-center py-3 border-b border-gray-700">
                    <span className="text-gray-400">Token Holdings</span>
                    <div className="text-right">
                      <span className="text-blue-400 font-medium">{tokenHoldings.length} Token{tokenHoldings.length !== 1 ? 's' : ''}</span>
                      <div className="text-xs text-gray-500 mt-1">
                        {tokenHoldings.slice(0, 3).map((token, i) => (
                          <span key={token.address}>
                            {i > 0 && ', '}
                            <Link href={`/token/${token.address}`} className="text-blue-400 hover:text-blue-300">
                              {token.symbol}
                            </Link>
                          </span>
                        ))}
                        {tokenHoldings.length > 3 && <span className="text-gray-500"> +{tokenHoldings.length - 3} more</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Transaction Count */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">Transactions</span>
                  <span className="text-white font-medium">{(contract?.transactionCount || 0).toLocaleString()}</span>
                </div>

                {/* Token Transfers (if token) */}
                {contract?.isToken && tokenTransfers.length > 0 && (
                  <div className="flex justify-between items-center py-3 border-b border-gray-700">
                    <span className="text-gray-400">Token Transfers</span>
                    <span className="text-white font-medium">{tokenTransfers.length.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - More Info */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <DocumentTextIcon className="w-5 h-5 text-purple-400" />
                More Info
              </h3>
              
              <div className="space-y-4">
                {/* Creator */}
                {contract?.creator && (
                  <div className="py-3 border-b border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Creator</div>
                    <Link 
                      href={`/address/${contract.creator}`}
                      className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all"
                    >
                      {formatAddress(contract.creator)}
                    </Link>
                    {contract.creationTx && (
                      <span className="text-gray-500 text-xs ml-2">
                        at <Link href={`/tx/${contract.creationTx}`} className="text-blue-400 hover:text-blue-300">txn</Link>
                      </span>
                    )}
                  </div>
                )}

                {/* Created at Block */}
                {contract?.blockNumber !== undefined && contract.blockNumber > 0 && (
                  <div className="py-3 border-b border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Created at Block</div>
                    <Link 
                      href={`/block/${contract.blockNumber}`}
                      className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {contract.blockNumber.toLocaleString()}
                    </Link>
                  </div>
                )}

                {/* Token Tracker Link */}
                {contract?.isToken && (
                  <div className="py-3 border-b border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Token Tracker</div>
                    <Link 
                      href={`/token/${address}`}
                      className="text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1"
                    >
                      <span className="bg-purple-500/20 px-2 py-0.5 rounded text-xs">{contract.tokenType}</span>
                      {contract.tokenName} ({contract.tokenSymbol})
                    </Link>
                  </div>
                )}

                {/* Verification Status */}
                <div className="py-3">
                  <div className="text-gray-400 text-sm mb-1">Verification</div>
                  {contract?.verified ? (
                    <div className="flex items-center gap-2 text-green-400">
                      <ShieldCheckIcon className="w-5 h-5" />
                      <span className="font-medium">Verified</span>
                      {contract.verifiedAt && (
                        <span className="text-xs text-gray-500">
                          ({new Date(contract.verifiedAt).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-400">
                      <ShieldExclamationIcon className="w-5 h-5" />
                      <span className="font-medium">Not Verified</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="flex flex-col gap-2">
                <Link
                  href={`/contract/verify?address=${address}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  <CheckCircleIcon className="w-4 h-4" />
                  {contract?.verified ? 'Re-verify' : 'Verify Contract'}
                </Link>
                <Link
                  href={`/contract/interact?address=${address}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                >
                  <PlayIcon className="w-4 h-4" />
                  Interact with Contract
                </Link>
                <button
                  onClick={fetchContractData}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Contract Information Card */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-100">Contract Information</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Contract Address - 2 columns */}
            <div className="md:col-span-2">
              <div className="text-sm font-medium text-gray-300 mb-2">Contract Address</div>
              <div className="flex items-center gap-2 font-mono text-blue-400 text-sm break-all bg-white/10 rounded px-3 py-2">
                <span>{address}</span>
                <button
                  onClick={() => copyToClipboard(address, 'address')}
                  className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
                  title="Copy address to clipboard"
                >
                  {copiedItem === 'address' ? (
                    <CheckCircleIcon className="w-4 h-4 text-green-400" />
                  ) : (
                    <ClipboardDocumentIcon className="w-4 h-4" />
                  )}
                </button>
                {copiedItem === 'address' && (
                  <span className="text-green-400 text-xs">Copied!</span>
                )}
              </div>
            </div>

            {/* Contract Name */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Contract Name</div>
              <div className="text-orange-400 text-lg font-semibold">
                {contract?.name || 'Unverified Contract'}
              </div>
            </div>

            {/* Verification Badge */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Verification</div>
              {contract?.verified ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 text-green-400 rounded text-sm font-medium w-fit border border-green-500/30">
                  <ShieldCheckIcon className="w-5 h-5" />
                  <span>Source Verified</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 text-red-400 rounded text-sm font-medium w-fit border border-red-500/30">
                  <ShieldExclamationIcon className="w-5 h-5" />
                  <span>Not Verified</span>
                </div>
              )}
            </div>

            {/* Compiler Version */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Compiler Version</div>
              <div className="text-blue-400 text-lg font-bold">
                {contract?.compilerVersion || '-'}
              </div>
            </div>

            {/* Optimization */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Optimization</div>
              <div
                className={`text-lg font-bold ${contract?.optimization ? 'text-green-400' : 'text-gray-400'}`}
              >
                {contract?.optimization !== undefined
                  ? contract.optimization
                    ? `Enabled (${contract.optimizationRuns || 200} runs)`
                    : 'Disabled'
                  : '-'}
              </div>
            </div>

            {/* EVM Version */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">EVM Version</div>
              <div className="text-purple-400 text-lg font-bold">
                {contract?.evmVersion || 'default'}
              </div>
            </div>

            {/* License */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">License</div>
              <div className="text-yellow-400 text-lg font-bold">{contract?.license || 'None'}</div>
            </div>

            {/* Balance */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Balance</div>
              <div className="text-green-400 text-lg font-bold">{contract?.balance || '0'} VBC</div>
            </div>

            {/* Transaction Count */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Transactions</div>
              <div className="text-purple-400 text-lg font-bold">
                {(contract?.transactionCount || 0).toLocaleString()}
              </div>
            </div>

            {/* Creator - only show if data exists */}
            {contract?.creator && (
              <div>
                <div className="text-sm font-medium text-gray-300 mb-2">Creator</div>
                <Link
                  href={`/address/${contract.creator}`}
                  className="font-mono text-blue-400 hover:text-blue-300 transition-colors break-all text-sm"
                >
                  {formatAddress(contract.creator)}
                </Link>
              </div>
            )}

            {/* Creation Tx - only show if data exists */}
            {contract?.creationTx && (
              <div>
                <div className="text-sm font-medium text-gray-300 mb-2">Creation Tx</div>
                <Link
                  href={`/tx/${contract.creationTx}`}
                  className="font-mono text-blue-400 hover:text-blue-300 transition-colors break-all text-sm"
                >
                  {formatAddress(contract.creationTx)}
                </Link>
              </div>
            )}

            {/* Block Number - only show if data exists */}
            {contract?.blockNumber ? (
              <div>
                <div className="text-sm font-medium text-gray-300 mb-2">Created at Block</div>
                <Link
                  href={`/block/${contract.blockNumber}`}
                  className="text-blue-400 hover:text-blue-300 transition-colors text-lg font-bold"
                >
                  {contract.blockNumber.toLocaleString()}
                </Link>
              </div>
            ) : null}

            {/* Verified At */}
            {contract?.verified && contract?.verifiedAt && (
              <div>
                <div className="text-sm font-medium text-gray-300 mb-2">Verified At</div>
                <div className="flex items-center gap-2 text-gray-300">
                  <ClockIcon className="w-4 h-4 text-gray-500" />
                  <span>
                    {new Date(contract.verifiedAt).toLocaleString(undefined, {
                      timeZoneName: 'short',
                    })}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="border-b border-gray-700">
            <div className="flex gap-1 px-4 overflow-x-auto">
              {[
                { id: 'overview', label: 'Overview', icon: CubeIcon },
                { id: 'code', label: 'Code', icon: CodeBracketIcon },
                { id: 'transactions', label: 'Transactions', icon: DocumentTextIcon, count: totalTxCount || contract?.transactionCount },
                ...(contract?.isToken ? [{ id: 'tokenTransfers', label: 'Token Transfers', icon: ArrowTopRightOnSquareIcon, count: tokenTransfers.length }] : []),
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'text-purple-400 border-b-2 border-purple-400'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <tab.icon className="w-5 h-5" />
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="ml-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs">
                      {tab.count.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Contract Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-100">Contract Details</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Name:</span>
                        <span className="text-gray-200 font-medium">
                          {contract?.name || 'Unverified Contract'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Compiler:</span>
                        <span className="text-gray-200 font-medium">
                          {contract?.compilerVersion || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Optimization:</span>
                        <span className="text-gray-200 font-medium">
                          {contract?.optimization !== undefined
                            ? contract.optimization
                              ? `Yes (${contract.optimizationRuns || 200} runs)`
                              : 'No'
                            : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">EVM Version:</span>
                        <span className="text-gray-200 font-medium">
                          {contract?.evmVersion || 'default'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">License:</span>
                        <span className="text-gray-200 font-medium">
                          {contract?.license || 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-100">Deployment Info</h3>
                    <div className="space-y-3">
                      {contract?.creator && (
                        <div className="flex justify-between">
                          <span className="text-gray-400">Creator:</span>
                          <Link
                            href={`/address/${contract.creator}`}
                            className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                          >
                            {formatAddress(contract.creator)}
                          </Link>
                        </div>
                      )}
                      {contract?.creationTx && (
                        <div className="flex justify-between">
                          <span className="text-gray-400">Creation Tx:</span>
                          <Link
                            href={`/tx/${contract.creationTx}`}
                            className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                          >
                            {formatAddress(contract.creationTx)}
                          </Link>
                        </div>
                      )}
                      {contract?.blockNumber ? (
                        <div className="flex justify-between">
                          <span className="text-gray-400">Block:</span>
                          <Link
                            href={`/block/${contract.blockNumber}`}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            {contract.blockNumber.toLocaleString()}
                          </Link>
                        </div>
                      ) : null}
                      {contract?.verified && contract?.verifiedAt && (
                        <div className="flex justify-between">
                          <span className="text-gray-400">Verified At:</span>
                          <span className="text-gray-200">
                            {new Date(contract.verifiedAt).toLocaleString(undefined, {
                              timeZoneName: 'short',
                            })}
                          </span>
                        </div>
                      )}
                      {!contract?.creator &&
                        !contract?.creationTx &&
                        !contract?.blockNumber &&
                        !contract?.verifiedAt && (
                          <div className="text-gray-500 text-sm">
                            No deployment information available
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'code' && (
              <div className="space-y-4">
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-600">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-gray-400">Contract Address:</span>
                    <span className="font-mono text-blue-400">{address}</span>
                  </div>

                  {contract?.verified && contract?.sourceCode ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                          <span className="text-green-400 font-medium">Contract Verified</span>
                        </div>
                        <Link
                          href={`/contract/status/${address}`}
                          className="text-xs text-blue-400 hover:text-blue-300 underline"
                        >
                          View Verification Details
                        </Link>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-gray-800 rounded p-3">
                          <div className="text-gray-400 text-sm">Contract Name</div>
                          <div className="text-gray-200 font-medium">
                            {contract.name || 'Unknown'}
                          </div>
                        </div>
                        <div className="bg-gray-800 rounded p-3">
                          <div className="text-gray-400 text-sm">Compiler</div>
                          <div className="text-gray-200 font-medium">
                            {contract.compilerVersion || '-'}
                          </div>
                        </div>
                        <div className="bg-gray-800 rounded p-3">
                          <div className="text-gray-400 text-sm">Optimization</div>
                          <div className="text-gray-200 font-medium">
                            {contract.optimization !== undefined
                              ? contract.optimization
                                ? `Enabled (${contract.optimizationRuns || 200} runs)`
                                : 'Disabled'
                              : '-'}
                          </div>
                        </div>
                      </div>

                      {/* Contract Source Code */}
                      <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                          <span className="text-sm font-medium text-gray-300">
                            Contract Source Code
                          </span>
                        </div>
                        <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-96 overflow-y-auto">
                          <code className="whitespace-pre-wrap break-all">
                            {contract.sourceCode}
                          </code>
                        </pre>
                      </div>

                      {/* Contract ABI */}
                      {contract.abi && (
                        <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                            <span className="text-sm font-medium text-gray-300">Contract ABI</span>
                          </div>
                          <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-64 overflow-y-auto">
                            <code className="whitespace-pre-wrap break-all">
                              {(() => {
                                try {
                                  const parsed =
                                    typeof contract.abi === 'string'
                                      ? JSON.parse(contract.abi)
                                      : contract.abi;
                                  return JSON.stringify(parsed, null, 2);
                                } catch {
                                  return contract.abi;
                                }
                              })()}
                            </code>
                          </pre>
                        </div>
                      )}

                      {/* Contract Bytecode */}
                      {contract.byteCode && (
                        <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                            <span className="text-sm font-medium text-gray-300">
                              Contract Bytecode
                            </span>
                          </div>
                          <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-96 overflow-y-auto">
                            <code className="whitespace-pre-wrap break-all">
                              {contract.byteCode}
                            </code>
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                        <span className="text-red-400 font-medium">Contract Not Verified</span>
                      </div>

                      {/* Always show bytecode */}
                      <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-300">
                            Contract Bytecode
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">
                              Contract Address: {address.slice(0, 10)}...{address.slice(-8)}
                            </span>
                          </div>
                        </div>
                        <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-96 overflow-y-auto">
                          <code className="whitespace-pre-wrap break-all">
                            {contract?.byteCode || '0x'}
                          </code>
                        </pre>
                      </div>

                      {/* Verify & Push Button */}
                      <div className="bg-gray-800 rounded-lg p-6 border border-gray-600">
                        <div className="text-center">
                          <CodeBracketIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                          <h3 className="text-lg font-semibold text-gray-100 mb-2">
                            Verify Contract Source Code
                          </h3>
                          <p className="text-gray-400 text-sm mb-6">
                            Verify and publish the source code for this contract to make it readable
                            and auditable.
                          </p>

                          <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <Link
                              href={`/contract/verify?address=${address}`}
                              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                            >
                              <CodeBracketIcon className="w-5 h-5" />
                              Verify & Push
                            </Link>

                            <Link
                              href={`/contract/interact?address=${address}`}
                              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
                            >
                              <PlayIcon className="w-5 h-5" />
                              Interact
                            </Link>
                          </div>

                          <div className="mt-4 text-xs text-gray-500">
                            <p>• Verify the source code to make it readable</p>
                            <p>• Interact with the contract functions</p>
                            <p>• View contract bytecode and metadata</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'transactions' && (
              <div>
                {txLoading ? (
                  <div className="flex justify-center items-center h-32">
                    <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500" />
                  </div>
                ) : transactions.length > 0 ? (
                  <>
                    <div className="mb-4 text-sm text-gray-400">
                      Showing {((txPage - 1) * txPerPage) + 1} - {Math.min(txPage * txPerPage, totalTxCount)} of {totalTxCount.toLocaleString()} transactions
                    </div>
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
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              To
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Value
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Age
                            </th>
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
                                {getTransactionTypeBadge(tx.type, tx.action)}
                              </td>
                              <td className="py-3 px-4">
                                <Link
                                  href={`/block/${tx.blockNumber}`}
                                  className="text-blue-400 hover:text-blue-300"
                                >
                                  {tx.blockNumber}
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
                                  <span className="text-gray-500">Contract Creation</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-yellow-400">
                                {tx.tokenInfo ? (
                                  <span title={`${tx.tokenInfo.value} (raw)`}>
                                    {formatTokenValue(tx.tokenInfo.value, tx.tokenInfo.decimals)} {tx.tokenInfo.symbol}
                                  </span>
                                ) : (
                                  <span>{tx.value} VBC</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <ClockIcon className="w-4 h-4 text-gray-500" />
                                  <div>
                                    <div className="text-sm text-gray-300">
                                      {getTimeAgo(tx.timestamp)}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {formatTimestamp(tx.timestamp)}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Pagination */}
                    {txTotalPages > 1 && (
                      <div className="mt-6 flex items-center justify-center gap-2">
                        <button
                          onClick={() => setTxPage(1)}
                          disabled={txPage === 1}
                          className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
                        >
                          First
                        </button>
                        <button
                          onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                          disabled={txPage === 1}
                          className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
                        >
                          Prev
                        </button>
                        <span className="px-4 py-1 text-gray-400">
                          Page {txPage} of {txTotalPages}
                        </span>
                        <button
                          onClick={() => setTxPage((p) => Math.min(txTotalPages, p + 1))}
                          disabled={txPage === txTotalPages}
                          className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
                        >
                          Next
                        </button>
                        <button
                          onClick={() => setTxPage(txTotalPages)}
                          disabled={txPage === txTotalPages}
                          className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
                        >
                          Last
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <DocumentTextIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400">No transactions found</p>
                  </div>
                )}
              </div>
            )}

            {/* Token Transfers Tab */}
            {activeTab === 'tokenTransfers' && (
              <div>
                {tokenTransfers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-600">
                          <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                            Tx Hash
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                            Block
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                            From
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                            To
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                            Value
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                            Age
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {tokenTransfers.slice(0, 25).map((transfer, index) => (
                          <tr key={`${transfer.transactionHash}-${index}`} className="hover:bg-gray-700/50 transition-colors">
                            <td className="py-3 px-4">
                              <Link
                                href={`/tx/${transfer.transactionHash}`}
                                className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                              >
                                {formatAddress(transfer.transactionHash)}
                              </Link>
                            </td>
                            <td className="py-3 px-4">
                              <Link
                                href={`/block/${transfer.blockNumber}`}
                                className="text-blue-400 hover:text-blue-300"
                              >
                                {transfer.blockNumber}
                              </Link>
                            </td>
                            <td className="py-3 px-4">
                              <Link
                                href={`/address/${transfer.from}`}
                                className="text-green-400 hover:text-green-300 font-mono text-sm"
                              >
                                {formatAddress(transfer.from)}
                              </Link>
                            </td>
                            <td className="py-3 px-4">
                              <Link
                                href={`/address/${transfer.to}`}
                                className="text-red-400 hover:text-red-300 font-mono text-sm"
                              >
                                {formatAddress(transfer.to)}
                              </Link>
                            </td>
                            <td className="py-3 px-4 text-yellow-400">
                              {formatTokenValue(transfer.value, transfer.tokenDecimals || contract?.tokenDecimals || 18)} {transfer.tokenSymbol || contract?.tokenSymbol}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <ClockIcon className="w-4 h-4 text-gray-500" />
                                <div>
                                  <div className="text-sm text-gray-300">
                                    {getTimeAgo(transfer.timestamp)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {formatTimestamp(transfer.timestamp)}
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
                  <div className="text-center py-12">
                    <DocumentTextIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400">No token transfers found</p>
                  </div>
                )}
                {tokenTransfers.length > 25 && (
                  <div className="mt-4 text-center">
                    <Link
                      href={`/token/${address}`}
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                    >
                      View all token transfers
                      <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
