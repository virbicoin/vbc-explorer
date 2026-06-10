'use client';

import { use } from 'react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  UserIcon,
  ArrowUpIcon,
  CurrencyDollarIcon,
  CubeIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  CodeBracketIcon,
  PlayIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import SummaryCard from '../../components/SummaryCard';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../../lib/client-config';
import { initializeCurrency } from '../../../lib/bigint-utils';
import { useTokenConfig } from '../../../hooks/useTokenConfig';
import {
  formatAddress as formatAddressShared,
  formatTimestamp,
  getTimeAgo,
  parseDate,
  formatTokenBalance,
  formatNativeValueShort,
  type AddressTransaction as Transaction,
} from '../../../lib/address/format';
import { getTransactionTypeBadge, formatTokenValue } from './components/transaction-display';

interface Account {
  address: string;
  balance: string;
  balanceRaw: string;
  percentage: string;
  rank: number | null;
  transactionCount: number;
  blocksMined: number;
  tokenTransferCount: number;
  firstSeen: string;
  lastActivity: string;
}

interface Contract {
  address: string;
  name: string;
  symbol: string;
  type: string;
  decimals: number;
  totalSupply: string;
  verified: boolean;
  creationTransaction: string;
  blockNumber: number;
  isContract?: boolean;
  bytecodeSize?: number;
  sourceCode?: string;
  abi?: string;
  byteCode?: string;
  compilerVersion?: string;
  optimization?: boolean;
}

interface Config {
  miners: Record<string, string>;
  explorer: {
    name: string;
    description: string;
    version: string;
    url: string;
  };
}

interface TokenHolding {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  type: string;
  percentage?: number;
  rank?: number;
  logoUrl?: string | null;
}

export default function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<
    'transactions' | 'mining' | 'tokens' | 'transfers' | 'source'
  >('transactions');
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>([]);
  const [tokenTransfers, setTokenTransfers] = useState<Transaction[]>([]);
  const [transactionStats, setTransactionStats] = useState<{
    regularCount: number;
    miningCount: number;
    totalCount: number;
  } | null>(null);
  const [currencySymbol, setCurrencySymbol] = useState<string>('');
  const [contractDetails, setContractDetails] = useState<{
    sourceCode?: string;
    abi?: string;
    byteCode?: string;
    compilerVersion?: string;
    optimization?: boolean;
  } | null>(null);

  // Get token icon/color functions from config
  const { getTokenIcon, getTokenColor } = useTokenConfig();

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        await initializeCurrency();
        await initializeCurrencyConfig();
        const symbol = getCurrencySymbol();
        setCurrencySymbol(symbol);
        const response = await fetch('/api/config');
        if (response.ok) {
          const configData = await response.json();
          setConfig(configData);
        }
      } catch (err) {
        console.error('Error fetching config:', err);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    const fetchAddressData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Note: Middleware handles redirects for tokens and contracts
        // This page should only be reached for wallet addresses

        const response = await fetch(`/api/address/${resolvedParams.address}`);
        if (!response.ok) {
          throw new Error('Address not found');
        }
        const data = await response.json();

        // Fallback redirect in case middleware didn't catch it
        if (data.contract?.isContract) {
          window.location.href = `/contract/${resolvedParams.address}`;
          return;
        }

        setAccount(data.account);
        setContract(data.contract);
        setTransactions(data.transactions || []);
        setTransactionStats(data.transactionStats || null);

        // Fetch token holdings
        try {
          const tokensResponse = await fetch(`/api/address/${resolvedParams.address}/tokens`);
          if (tokensResponse.ok) {
            const tokensData = await tokensResponse.json();
            setTokenHoldings(tokensData.tokens || []);
          }
        } catch (err) {
          console.error('Error fetching token holdings:', err);
        }

        // Filter token transfers from transactions
        const transfers = (data.transactions || []).filter(
          (tx: Transaction) =>
            tx.type === 'token_transfer' || tx.type === 'nft_transfer' || tx.tokenInfo
        );
        setTokenTransfers(transfers);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch address data');
      } finally {
        setLoading(false);
      }
    };
    if (resolvedParams.address) {
      fetchAddressData();
    }
  }, [resolvedParams.address, router]);

  // Show loading until the currency symbol is available
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

  const copyToClipboard = async (text: string) => {
    try {
      // Use the Clipboard API in modern browsers
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: for older browsers or non-secure contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }

      // Feedback on successful copy
      setCopiedItem(text);
      setTimeout(() => {
        setCopiedItem(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const formatValue = (value: string) => formatNativeValueShort(value, currencySymbol);

  const formatAddress = (address: string) => formatAddressShared(address, true);

  const getMinerDisplayInfo = (miner: string) => {
    if (!miner || !config?.miners) return { name: 'Unknown', isPool: false, address: null };

    const minerKey = Object.keys(config.miners).find(
      (key) => key.toLowerCase() === miner.toLowerCase()
    );

    if (minerKey) {
      return {
        name: config.miners[minerKey],
        isPool: true,
        address: miner,
      };
    }

    return {
      name: miner,
      isPool: false,
      address: miner,
    };
  };

  const getAddressType = () => {
    if (contract?.isContract) {
      if (contract.type === 'ERC20' || contract.type === 'VRC-20') return 'Token Contract';
      if (contract.type === 'VRC-721' || contract.type === 'ERC721') return 'NFT Contract';
      return 'Smart Contract';
    }
    if (resolvedParams.address === '0x0000000000000000000000000000000000000000')
      return 'System Address';
    return 'Wallet Address';
  };

  const getAddressName = () => {
    // Contract case
    if (
      contract?.name &&
      contract.name !== 'Unknown Contract' &&
      contract.name !== 'Unverified Contract'
    ) {
      return contract.name;
    }

    // Pool address case
    const minerInfo = getMinerDisplayInfo(resolvedParams.address);
    if (minerInfo.isPool) {
      return minerInfo.name;
    }

    // System address case
    if (resolvedParams.address === '0x0000000000000000000000000000000000000000') {
      return 'System';
    }

    return null;
  };

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
            <span className="block sm:inline"> {error || 'Address not found'}</span>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
          >
            <ArrowUpIcon className="w-4 h-4" />
            Back to Explorer
          </Link>
        </div>
      </div>
    );
  }

  // Filter transactions by type (needed for both contract and wallet views)
  // Show all transactions except mining rewards as regular transactions
  const regularTransactions = transactions.filter((tx) => tx.type !== 'mining_reward');

  const miningRewards = transactions.filter((tx) => tx.type === 'mining_reward');

  // Display counts using the stats info (accurate counts from the API)
  const regularCount = transactionStats?.regularCount || regularTransactions.length;
  const miningCount = transactionStats?.miningCount || miningRewards.length;
  const tokenTransferCount = tokenTransfers.length;
  const tokenHoldingsCount = tokenHoldings.length;

  // Check if this is a contract address
  const isContractAddress = contract?.isContract === true;

  // Contract Page (Token-like design)
  if (isContractAddress) {
    const tabs = [
      { id: 'transactions', label: 'Transactions', icon: ArrowPathIcon },
      ...(miningCount > 0 ? [{ id: 'mining', label: 'Mining Rewards', icon: CubeIcon }] : []),
      { id: 'source', label: 'Contract Source', icon: CodeBracketIcon },
    ];

    return (
      <div className="min-h-screen bg-gray-900 text-white">
        {/* Page Header */}
        <div className="bg-gray-800 border-b border-gray-700">
          <div className="container mx-auto px-4 py-8">
            <div className="flex items-center gap-3 mb-2">
              <CodeBracketIcon className="w-8 h-8 text-purple-400" />
              <h1 className="text-3xl font-bold text-gray-100">Contract Details</h1>
            </div>
            <p className="text-gray-400">
              {contract?.name || 'Smart Contract'} {contract?.symbol ? `(${contract.symbol})` : ''}{' '}
              - {formatAddress(resolvedParams.address)}
            </p>
          </div>
        </div>

        <main className="container mx-auto px-4 py-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Balance</h3>
              <p className="text-2xl font-bold text-green-400">
                {account
                  ? (() => {
                      try {
                        const weiValue = BigInt(account.balanceRaw);
                        const nativeValue = Number(weiValue) / 1e18;
                        if (nativeValue === 0) return '0';
                        if (nativeValue < 0.0001) return '<0.0001';
                        return nativeValue.toFixed(4);
                      } catch {
                        return account.balance;
                      }
                    })()
                  : '0'}{' '}
                {currencySymbol}
              </p>
              <p className="text-xs text-gray-400">Contract balance</p>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Transactions</h3>
              <p className="text-2xl font-bold text-blue-400">
                {(account?.transactionCount || 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-400">Total interactions</p>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Token Transfers</h3>
              <p className="text-2xl font-bold text-purple-400">
                {(account?.tokenTransferCount || 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-400">ERC20/721 transfers</p>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Verification</h3>
              <p className="text-2xl font-bold">
                {contract?.verified ? (
                  <span className="text-green-400 flex items-center gap-2">
                    <CheckCircleIcon className="w-6 h-6" />
                    Verified
                  </span>
                ) : (
                  <span className="text-yellow-400">Unverified</span>
                )}
              </p>
              <p className="text-xs text-gray-400">Source code status</p>
            </div>
          </div>

          {/* Contract Info Card */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-100">Contract Information</h2>
              <div className="flex gap-2">
                <Link
                  href={`/contract/interact?address=${resolvedParams.address}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm"
                >
                  <PlayIcon className="w-4 h-4" />
                  Interact
                </Link>
                {!contract?.verified && (
                  <Link
                    href={`/contract/verify?address=${resolvedParams.address}&contractName=${contract?.name?.replace(/\s+/g, '') || 'Contract'}`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
                  >
                    <CodeBracketIcon className="w-4 h-4" />
                    Verify
                  </Link>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="md:col-span-2">
                <div className="text-sm font-medium text-gray-300 mb-2">Contract Address</div>
                <div className="flex items-center gap-2 font-mono text-blue-400 text-sm break-all bg-white/10 rounded px-3 py-2">
                  <span>{resolvedParams.address}</span>
                  <button
                    onClick={() => copyToClipboard(resolvedParams.address)}
                    className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
                    title="Copy address"
                  >
                    <ClipboardDocumentIcon className="w-4 h-4" />
                  </button>
                  {copiedItem === resolvedParams.address && (
                    <span className="text-green-400 text-xs">Copied!</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-300 mb-2">Contract Name</div>
                <div className="text-orange-400 text-lg font-semibold">
                  {contract?.name || 'Unknown'}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-300 mb-2">Type</div>
                <span
                  className={`px-3 py-1 rounded text-sm font-medium ${
                    contract?.type === 'ERC20' || contract?.type === 'VRC-20'
                      ? 'bg-blue-500/20 text-blue-400'
                      : contract?.type === 'VRC-721' || contract?.type === 'ERC721'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {contract?.type || 'Contract'}
                </span>
              </div>

              {contract?.symbol && (
                <div>
                  <div className="text-sm font-medium text-gray-300 mb-2">Symbol</div>
                  <div className="text-green-400 text-lg font-bold">{contract.symbol}</div>
                </div>
              )}

              {contract?.decimals !== undefined && contract.decimals > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-300 mb-2">Decimals</div>
                  <div className="text-gray-200 text-lg font-bold">{contract.decimals}</div>
                </div>
              )}

              {contract?.blockNumber && contract.blockNumber > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-300 mb-2">Created at Block</div>
                  <Link
                    href={`/block/${contract.blockNumber}`}
                    className="text-blue-400 hover:text-blue-300 text-lg font-bold"
                  >
                    #{contract.blockNumber.toLocaleString()}
                  </Link>
                </div>
              )}

              {contract?.creationTransaction && (
                <div>
                  <div className="text-sm font-medium text-gray-300 mb-2">Creation Tx</div>
                  <Link
                    href={`/tx/${contract.creationTransaction}`}
                    className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                  >
                    {formatAddress(contract.creationTransaction)}
                  </Link>
                </div>
              )}

              {contract?.verified && (
                <div>
                  <div className="text-sm font-medium text-gray-300 mb-2">Verification</div>
                  <div className="flex items-center gap-1 px-3 py-1 bg-green-500/20 text-green-400 rounded text-sm font-medium w-fit">
                    <CheckCircleIcon className="w-4 h-4" />
                    <span>Verified</span>
                  </div>
                </div>
              )}

              {contractDetails?.compilerVersion && (
                <div>
                  <div className="text-sm font-medium text-gray-300 mb-2">Compiler</div>
                  <div className="text-gray-200">Solidity {contractDetails.compilerVersion}</div>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="border-b border-gray-700">
              <div className="flex flex-wrap">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as 'transactions' | 'mining' | 'source')}
                      className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'bg-gray-700/50 text-blue-400 border-b-2 border-blue-400'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-6">
              {/* Transactions Tab */}
              {activeTab === 'transactions' && (
                <div className="space-y-4">
                  {regularTransactions.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">
                      No transactions found for this contract.
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
                          <tbody className="divide-y divide-gray-600">
                            {regularTransactions.slice(0, 10).map((tx) => (
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
                                  <Link
                                    href={`/address/${tx.to}`}
                                    className="text-red-400 hover:text-red-300 font-mono text-sm"
                                  >
                                    {formatAddress(tx.to)}
                                  </Link>
                                </td>
                                <td className="py-3 px-4 text-yellow-400">
                                  {formatValue(tx.value)}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <ClockIcon className="w-4 h-4 text-gray-500" />
                                    <span className="text-gray-300 text-sm">
                                      {getTimeAgo(tx.timestamp)}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-center">
                        <Link
                          href={`/address/${resolvedParams.address}/transactions`}
                          className="text-blue-400 hover:text-blue-300 text-sm"
                        >
                          View all {regularCount} transactions →
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Mining Tab */}
              {activeTab === 'mining' && (
                <div className="space-y-4">
                  {miningRewards.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">
                      No mining rewards for this address.
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-gray-600">
                              <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                                Block Hash
                              </th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                                Reward
                              </th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                                Age
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-600">
                            {miningRewards.slice(0, 10).map((tx) => (
                              <tr key={tx.hash} className="hover:bg-gray-700/50 transition-colors">
                                <td className="py-3 px-4">
                                  <Link
                                    href={`/tx/${tx.hash}`}
                                    className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                                  >
                                    {formatAddress(tx.hash)}
                                  </Link>
                                </td>
                                <td className="py-3 px-4 text-yellow-400">
                                  {formatValue(tx.value)}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <ClockIcon className="w-4 h-4 text-gray-500" />
                                    <span className="text-gray-300 text-sm">
                                      {getTimeAgo(tx.timestamp)}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-center">
                        <Link
                          href={`/address/${resolvedParams.address}/mining`}
                          className="text-blue-400 hover:text-blue-300 text-sm"
                        >
                          View all {miningCount} mining rewards →
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Source Code Tab */}
              {activeTab === 'source' && (
                <div className="space-y-4">
                  {contract?.verified && contractDetails?.sourceCode ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                        <span className="text-green-400 font-medium">Contract Verified</span>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="bg-gray-700/50 rounded p-3">
                          <div className="text-gray-400 text-sm">Contract Name</div>
                          <div className="text-gray-200 font-medium">{contract.name}</div>
                        </div>
                        <div className="bg-gray-700/50 rounded p-3">
                          <div className="text-gray-400 text-sm">Compiler</div>
                          <div className="text-gray-200 font-medium">
                            Solidity {contractDetails.compilerVersion || 'Unknown'}
                          </div>
                        </div>
                        <div className="bg-gray-700/50 rounded p-3">
                          <div className="text-gray-400 text-sm">Optimization</div>
                          <div className="text-gray-200 font-medium">
                            {contractDetails.optimization ? 'Enabled' : 'Disabled'}
                          </div>
                        </div>
                      </div>

                      {/* Source Code */}
                      <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                          <span className="text-sm font-medium text-gray-300">
                            Contract Source Code
                          </span>
                        </div>
                        <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-96 overflow-y-auto">
                          <code className="whitespace-pre-wrap break-all">
                            {contractDetails.sourceCode}
                          </code>
                        </pre>
                      </div>

                      {/* ABI */}
                      {contractDetails.abi && (
                        <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                            <span className="text-sm font-medium text-gray-300">Contract ABI</span>
                          </div>
                          <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-48 overflow-y-auto">
                            <code className="whitespace-pre-wrap break-all">
                              {contractDetails.abi}
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

                      {/* Bytecode */}
                      <div className="bg-gray-950 rounded border border-gray-700 overflow-hidden">
                        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                          <span className="text-sm font-medium text-gray-300">
                            Contract Bytecode
                          </span>
                        </div>
                        <pre className="p-4 overflow-x-auto text-sm text-gray-300 max-h-48 overflow-y-auto">
                          <code className="whitespace-pre-wrap break-all">
                            {contractDetails?.byteCode || contract?.byteCode || '0x'}
                          </code>
                        </pre>
                      </div>

                      {/* Verify Button */}
                      <div className="bg-gray-700/50 rounded-lg p-6 border border-gray-600">
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
                              href={`/contract/verify?address=${resolvedParams.address}&contractName=${contract?.name?.replace(/\s+/g, '') || 'Contract'}`}
                              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                            >
                              <CodeBracketIcon className="w-5 h-5" />
                              Verify & Push
                            </Link>

                            <Link
                              href={`/contract/interact?address=${resolvedParams.address}`}
                              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                            >
                              <PlayIcon className="w-5 h-5" />
                              Interact
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Summary cards
  console.log('Account data:', account);
  console.log('Currency symbol:', currencySymbol);

  const balanceValue = account
    ? (() => {
        try {
          const weiValue = BigInt(account.balanceRaw);
          const nativeValue = Number(weiValue) / 1e18;
          const symbol = currencySymbol || 'ETH';
          console.log('Balance formatting:', { weiValue: account.balanceRaw, nativeValue, symbol });
          if (nativeValue === 0) return `0 ${symbol}`;
          if (nativeValue < 0.000001) return `<0.000001 ${symbol}`;
          const result = `${nativeValue.toFixed(4)} ${symbol}`;
          console.log('Formatted balance:', result);
          return result;
        } catch (error) {
          console.error('Balance formatting error:', error);
          const symbol = currencySymbol || 'ETH';
          return `${account.balance} ${symbol}`;
        }
      })()
    : `0 ${currencySymbol || 'ETH'}`;

  console.log('Final balance value:', balanceValue);

  const summaryStats = [
    {
      title: 'Balance',
      value: balanceValue,
      sub: 'Current account balance',
      icon: <CurrencyDollarIcon className="w-5 h-5 text-green-400" />,
      colorClass: 'text-green-400',
    },
    {
      title: 'Transactions',
      value: account?.transactionCount?.toString() || '0',
      sub: 'Total transactions',
      icon: <ArrowPathIcon className="w-5 h-5 text-blue-400" />,
      colorClass: 'text-blue-400',
    },
    {
      title: 'Token Transfers',
      value: account?.tokenTransferCount?.toString() || '0',
      sub: 'Total token transfers',
      icon: <ArrowUpIcon className="w-5 h-5 text-purple-400" />,
      colorClass: 'text-purple-400',
    },
    {
      title: 'Blocks Mined',
      value: account?.blocksMined?.toString() || '0',
      sub: 'Blocks mined by this address',
      icon: <CubeIcon className="w-5 h-5 text-yellow-400" />,
      colorClass: 'text-yellow-400',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-blue-500/20 p-2 rounded-lg">
              <UserIcon className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 mr-2">
                Address
              </span>
              <h1 className="text-2xl font-bold text-gray-100 inline">
                {formatAddress(resolvedParams.address)}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="font-mono text-gray-400 text-sm">{resolvedParams.address}</span>
            <button
              onClick={() => copyToClipboard(resolvedParams.address)}
              className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
              title="Copy address"
            >
              <ClipboardDocumentIcon className="w-4 h-4" />
            </button>
            {copiedItem === resolvedParams.address && (
              <span className="text-green-400 text-xs">Copied!</span>
            )}
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
                <CurrencyDollarIcon className="w-5 h-5 text-blue-400" />
                Overview
              </h3>

              <div className="space-y-4">
                {/* Balance */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">{currencySymbol} Balance</span>
                  <span className="text-white font-medium">
                    {account ? formatValue(account.balanceRaw) : `0 ${currencySymbol}`}
                  </span>
                </div>

                {/* Transaction Count */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">Transactions</span>
                  <span className="text-white font-medium">
                    {account?.transactionCount?.toLocaleString() || '0'}
                  </span>
                </div>

                {/* Token Transfers */}
                <div className="flex justify-between items-center py-3 border-b border-gray-700">
                  <span className="text-gray-400">Token Transfers</span>
                  <span className="text-white font-medium">
                    {account?.tokenTransferCount?.toLocaleString() || '0'}
                  </span>
                </div>

                {/* Blocks Mined */}
                <div className="flex justify-between items-center py-3">
                  <span className="text-gray-400">Blocks Mined</span>
                  <span className="text-white font-medium">
                    {account?.blocksMined?.toLocaleString() || '0'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - More Info */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <ClockIcon className="w-5 h-5 text-purple-400" />
                More Info
              </h3>

              <div className="space-y-4">
                {/* First Seen */}
                <div className="py-3 border-b border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">First Seen</div>
                  <span className="text-white font-medium">
                    {(() => {
                      if (!account?.firstSeen) return 'Unknown';
                      if (account.firstSeen.includes('(') && account.firstSeen.includes(')')) {
                        const [, agoPart] = account.firstSeen.split(' (');
                        const ago = agoPart?.replace(')', '');
                        return ago || 'Unknown';
                      }
                      const date = parseDate(account.firstSeen);
                      return date ? getTimeAgo(Math.floor(date.getTime() / 1000)) : 'Unknown';
                    })()}
                  </span>
                </div>

                {/* Last Activity */}
                <div className="py-3 border-b border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">Last Activity</div>
                  <span className="text-white font-medium">
                    {(() => {
                      if (!account?.lastActivity) return 'Unknown';
                      if (
                        account.lastActivity.includes('(') &&
                        account.lastActivity.includes(')')
                      ) {
                        const [, agoPart] = account.lastActivity.split(' (');
                        const ago = agoPart?.replace(')', '');
                        return ago || 'Unknown';
                      }
                      const date = parseDate(account.lastActivity);
                      return date ? getTimeAgo(Math.floor(date.getTime() / 1000)) : 'Unknown';
                    })()}
                  </span>
                </div>

                {/* Rank */}
                {account?.rank && (
                  <div className="py-3 border-b border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Rank</div>
                    <span className="text-yellow-400 font-medium">
                      #{account.rank.toLocaleString()}
                    </span>
                  </div>
                )}

                {/* Percentage */}
                {account?.percentage && (
                  <div className="py-3">
                    <div className="text-gray-400 text-sm mb-1">Percentage of Supply</div>
                    <span className="text-white font-medium">
                      {parseFloat(account.percentage).toFixed(4)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Transactions Section */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="border-b border-gray-700">
            <div className="flex gap-1 px-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab('transactions')}
                className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'transactions'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <ArrowPathIcon className="w-5 h-5" />
                Transactions
                <span className="ml-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs">
                  {regularCount.toLocaleString()}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('tokens')}
                className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'tokens'
                    ? 'text-green-400 border-b-2 border-green-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <CurrencyDollarIcon className="w-5 h-5" />
                Token Holdings
                <span className="ml-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs">
                  {tokenHoldingsCount.toLocaleString()}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('transfers')}
                className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'transfers'
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <ArrowUpIcon className="w-5 h-5" />
                Token Transfers
                <span className="ml-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs">
                  {tokenTransferCount.toLocaleString()}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('mining')}
                className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'mining'
                    ? 'text-yellow-400 border-b-2 border-yellow-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <CubeIcon className="w-5 h-5" />
                Mining Rewards
                <span className="ml-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs">
                  {miningCount.toLocaleString()}
                </span>
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'transactions' ? (
              <>
                {regularTransactions.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400">No transactions for this address.</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 text-sm text-gray-400">
                      Latest 10 from a total of {regularCount.toLocaleString()} transactions
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
                        <tbody className="divide-y divide-gray-600">
                          {regularTransactions.slice(0, 10).map((tx) => (
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
                                ) : tx.from.toLowerCase() ===
                                  resolvedParams.address.toLowerCase() ? (
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
                                {!tx.to ||
                                tx.to === '0x0000000000000000000000000000000000000000' ? (
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
                                  {parseFloat(tx.value) === 0 &&
                                    !tx.tokenInfo &&
                                    !tx.tokenTransfers && <span className="text-gray-500">-</span>}
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
                    <div className="mt-4 text-center">
                      <Link
                        href={`/address/${resolvedParams.address}/transactions`}
                        className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                      >
                        View all {regularCount.toLocaleString()} transactions →
                      </Link>
                    </div>
                  </>
                )}
              </>
            ) : activeTab === 'tokens' ? (
              <>
                {tokenHoldings.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400">No token holdings for this address.</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 text-sm text-gray-400">
                      {tokenHoldingsCount.toLocaleString()} token
                      {tokenHoldingsCount !== 1 ? 's' : ''} held by this address
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-600">
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Token
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Type
                            </th>
                            <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">
                              Balance
                            </th>
                            <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">
                              % of Supply
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-600">
                          {tokenHoldings.map((token) => {
                            // Prefer logoUrl from API (Launchpad tokens), fallback to config
                            const iconUrl = token.logoUrl || getTokenIcon(token.symbol);
                            return (
                              <tr
                                key={token.address}
                                className="hover:bg-gray-700/50 transition-colors"
                              >
                                <td className="py-3 px-4">
                                  <Link
                                    href={`/token/${token.address}`}
                                    className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
                                  >
                                    <div
                                      className={`w-8 h-8 rounded-full bg-gradient-to-br ${getTokenColor(token.symbol)} flex items-center justify-center shadow-md overflow-hidden`}
                                    >
                                      {iconUrl ? (
                                        <Image
                                          src={iconUrl}
                                          alt={token.symbol || ''}
                                          width={28}
                                          height={28}
                                          className="object-contain w-7 h-7"
                                          unoptimized={iconUrl.startsWith('http')}
                                        />
                                      ) : (
                                        <span className="font-bold text-white text-xs">
                                          {token.symbol?.charAt(0) || '?'}
                                        </span>
                                      )}
                                    </div>
                                    <div>
                                      <div className="font-medium">{token.name}</div>
                                      <div className="text-xs text-gray-400">{token.symbol}</div>
                                    </div>
                                  </Link>
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`px-2 py-1 rounded text-xs font-medium ${
                                      token.type === 'VRC-20' || token.type === 'ERC20'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : token.type === 'VRC-721' || token.type === 'ERC721'
                                          ? 'bg-purple-500/20 text-purple-400'
                                          : 'bg-gray-500/20 text-gray-400'
                                    }`}
                                  >
                                    {/* Normalize token type display */}
                                    {token.type === 'ERC20'
                                      ? 'VRC-20'
                                      : token.type === 'ERC721'
                                        ? 'VRC-721'
                                        : token.type}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <span className="text-green-400 font-medium">
                                    {formatTokenBalance(
                                      token.balance,
                                      token.decimals,
                                      token.symbol
                                    )}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <span className="text-gray-300">
                                    {token.percentage ? `${token.percentage.toFixed(4)}%` : '-'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            ) : activeTab === 'transfers' ? (
              <>
                {tokenTransfers.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400">No token transfers for this address.</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 text-sm text-gray-400">
                      Latest token transfers for this address
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
                              Token
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
                        <tbody className="divide-y divide-gray-600">
                          {tokenTransfers.slice(0, 10).map((tx) => (
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
                                {tx.tokenInfo ? (
                                  <Link
                                    href={`/token/${tx.tokenInfo.address}`}
                                    className="text-purple-400 hover:text-purple-300 text-sm transition-colors"
                                  >
                                    {tx.tokenInfo.symbol || tx.tokenInfo.name || 'Unknown'}
                                  </Link>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                {tx.from.toLowerCase() === resolvedParams.address.toLowerCase() ? (
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
                                {tx.to.toLowerCase() === resolvedParams.address.toLowerCase() ? (
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
                                {tx.tokenTransfers || tx.tokenInfo ? (
                                  <div className="text-sm">{formatTokenValue(tx)}</div>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
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
                  </>
                )}
              </>
            ) : activeTab === 'mining' ? (
              <>
                {miningRewards.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400">No mining rewards for this address.</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 text-sm text-gray-400">
                      Latest 10 from a total of {miningCount.toLocaleString()} mining rewards
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-600">
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Block Hash
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Reward
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                              Age
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-600">
                          {miningRewards.slice(0, 10).map((tx) => (
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
                              <td className="py-3 px-4">
                                <span className="text-yellow-400">{formatValue(tx.value)}</span>
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
                    <div className="mt-4 text-center">
                      <Link
                        href={`/address/${resolvedParams.address}/mining`}
                        className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                      >
                        View all {miningCount.toLocaleString()} mining rewards →
                      </Link>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
