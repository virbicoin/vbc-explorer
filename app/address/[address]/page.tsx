'use client';

import { use } from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  UserIcon, 
  ArrowUpIcon,
  CurrencyDollarIcon,
  CubeIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import SummaryCard from '../../components/SummaryCard';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../../lib/client-config';
import { initializeCurrency } from '../../../lib/bigint-utils';

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

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  blockNumber: number;
  gasUsed?: number;
  status?: number;
  type?: string;
}

export default function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const resolvedParams = use(params);
  const [account, setAccount] = useState<Account | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<'transactions' | 'mining'>('transactions');
  const [transactionStats, setTransactionStats] = useState<{
    regularCount: number;
    miningCount: number;
    totalCount: number;
  } | null>(null);
  const [currencySymbol, setCurrencySymbol] = useState<string>('');

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
        const response = await fetch(`/api/address/${resolvedParams.address}`);
        if (!response.ok) {
          throw new Error('Address not found');
        }
        const data = await response.json();
        setAccount(data.account);
        setContract(data.contract);
        setTransactions(data.transactions || []);
        setTransactionStats(data.transactionStats || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch address data');
      } finally {
        setLoading(false);
      }
    };
    if (resolvedParams.address) {
      fetchAddressData();
    }
  }, [resolvedParams.address]);

  // 通貨記号が取得できるまでローディング表示
  if (!currencySymbol) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex justify-center items-center h-64'>
            <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500'></div>
          </div>
          <div className='text-center text-gray-400 mt-4'>Loading currency symbol...</div>
        </div>
      </div>
    );
  }

  const copyToClipboard = async (text: string) => {
    try {
      // モダンなブラウザでは Clipboard API を使用
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // フォールバック: 古いブラウザや非セキュアコンテキスト用
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
      
      // コピー成功時のフィードバック
      setCopiedItem(text);
      setTimeout(() => {
        setCopiedItem(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const formatValue = (value: string) => {
    try {
      const weiValue = BigInt(value);
      const nativeValue = Number(weiValue) / 1e18;
      if (nativeValue === 0) return `0 ${currencySymbol}`;
      if (nativeValue < 0.000001) return `<0.000001 ${currencySymbol}`;
      return `${nativeValue.toFixed(4)} ${currencySymbol}`;
    } catch {
      return `${value} ${currencySymbol}`;
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    if (address === '0x0000000000000000000000000000000000000000') return 'System';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const getTimeAgo = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const parseDate = (dateString: string) => {
    if (!dateString || dateString === 'Invalid Date') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  };

  // Filter transactions by type
  const regularTransactions = transactions.filter(tx => 
    tx.type === 'native' || tx.type === 'token'
  );
  
  const miningRewards = transactions.filter(tx => 
    tx.type === 'mining_reward'
  );

  // 統計情報を使用して件数を表示（APIから取得した正確な件数）
  const regularCount = transactionStats?.regularCount || regularTransactions.length;
  const miningCount = transactionStats?.miningCount || miningRewards.length;

  const getMinerDisplayInfo = (miner: string) => {
    if (!miner || !config?.miners) return { name: 'Unknown', isPool: false, address: null };

    const minerKey = Object.keys(config.miners).find(
      key => key.toLowerCase() === miner.toLowerCase()
    );
    
    if (minerKey) {
      return {
        name: config.miners[minerKey],
        isPool: true,
        address: miner
      };
    }

    return {
      name: miner,
      isPool: false,
      address: miner
    };
  };

  const getAddressType = () => {
    if (contract) return 'Contract Address';
    if (resolvedParams.address === '0x0000000000000000000000000000000000000000') return 'System Address';
    return 'Wallet Address';
  };

  const getAddressName = () => {
    // コントラクトの場合
    if (contract) {
      return contract.name;
    }
    
    // プールアドレスの場合
    const minerInfo = getMinerDisplayInfo(resolvedParams.address);
    if (minerInfo.isPool) {
      return minerInfo.name;
    }
    
    // システムアドレスの場合
    if (resolvedParams.address === '0x0000000000000000000000000000000000000000') {
      return 'System';
    }
    
    return null;
  };

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
          <div className='container mx-auto px-4 py-8'>
          <div className='flex justify-center items-center h-64'>
            <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500'></div>
          </div>
        </div>
          </div>
    );
  }

  if (error) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
          <div className='container mx-auto px-4 py-8'>
          <div className='bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded mb-4'>
            <strong className='font-bold'>Error:</strong>
            <span className='block sm:inline'> {error || 'Address not found'}</span>
          </div>
            <Link
              href='/'
              className='inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors'
            >
              <ArrowUpIcon className='w-4 h-4' />
              Back to Explorer
            </Link>
      </div>
      </div>
    );
  }
  
  // Summary cards
  console.log('Account data:', account);
  console.log('Currency symbol:', currencySymbol);
  
  const balanceValue = account ? (() => {
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
  })() : `0 ${currencySymbol || 'ETH'}`;
  
  console.log('Final balance value:', balanceValue);
  
  const summaryStats = [
    {
      title: 'Balance',
      value: balanceValue,
      sub: 'Current account balance',
      icon: <CurrencyDollarIcon className='w-5 h-5 text-green-400' />,
      colorClass: 'text-green-400'
    },
    {
      title: 'Transactions',
      value: account?.transactionCount?.toString() || '0',
      sub: 'Total transactions',
      icon: <ArrowPathIcon className='w-5 h-5 text-blue-400' />,
      colorClass: 'text-blue-400'
    },
    {
      title: 'Token Transfers',
      value: account?.tokenTransferCount?.toString() || '0',
      sub: 'Total token transfers',
      icon: <ArrowUpIcon className='w-5 h-5 text-purple-400' />,
      colorClass: 'text-purple-400'
    },
    {
      title: 'Blocks Mined',
      value: account?.blocksMined?.toString() || '0',
      sub: 'Blocks mined by this address',
      icon: <CubeIcon className='w-5 h-5 text-yellow-400' />,
      colorClass: 'text-yellow-400'
    }
  ];

  return (
    <div className='min-h-screen bg-gray-900 text-white'>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <UserIcon className='w-8 h-8 text-blue-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Address Details</h1>
          </div>
          <p className='text-gray-400'>
            Account information and transaction history for {formatAddress(resolvedParams.address)}
          </p>
        </div>
      </div>

      <main className='container mx-auto px-4 py-8'>
        {/* Summary Cards */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-8'>
          {summaryStats.map((stat, idx) => (
            <SummaryCard key={idx} {...stat} />
          ))}
            </div>

        {/* Account Information */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-semibold text-gray-100 mb-4'>Account Information</h2>
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Address</label>
                <div className='bg-gray-700 rounded p-3 flex items-center justify-between'>
                  <span className='text-white font-mono text-sm break-all'>{resolvedParams.address}</span>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => copyToClipboard(resolvedParams.address)}
                      className='p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-all duration-200'
                      title='Copy to clipboard'
                    >
                      <ClipboardDocumentIcon className='w-4 h-4' />
                    </button>
                    {copiedItem === resolvedParams.address && (
                      <span className='text-green-400 text-sm font-mono'>Copied!</span>
                    )}
                  </div>
                </div>
            </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Type</label>
                  <div className='text-blue-400 text-lg font-semibold'>
                    {getAddressType()}
                  </div>
                </div>
                {getAddressName() && (
                  <div>
                    <label className='block text-sm font-medium text-gray-400 mb-2'>Name</label>
                    <div className='text-green-400 text-lg font-semibold'>
                      {getAddressName()}
                    </div>
                  </div>
                )}
            </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Balance</label>
                  <div className='text-green-400 text-lg font-semibold'>
                    {account ? formatValue(account.balance) : '0 VBC'}
                  </div>
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Transaction Count</label>
                  <div className='text-blue-400 text-lg font-semibold'>
                    {account?.transactionCount?.toLocaleString() || '0'}
                  </div>
            </div>
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Token Transfers</label>
                  <div className='text-purple-400 text-lg font-semibold'>
                    {account?.tokenTransferCount?.toLocaleString() || '0'}
                  </div>
            </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Blocks Mined</label>
                  <div className='text-yellow-400 text-lg font-semibold'>
                    {account?.blocksMined?.toLocaleString() || '0'}
                  </div>
                </div>
              </div>


            </div>

            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>First Seen</label>
                <div className='text-white'>
                  {(() => {
                    if (!account?.firstSeen) return 'Unknown';
                    
                    // APIから返される形式: "2025-06-14 7:46:26 AM GMT+9 (36 days ago)"
                    if (account.firstSeen.includes('(') && account.firstSeen.includes(')')) {
                      const [datePart, agoPart] = account.firstSeen.split(' (');
                      const ago = agoPart?.replace(')', '');
                      
                      // 日付部分をDateオブジェクトに変換
                      const dateMatch = datePart.match(/(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} [AP]M)/);
                      if (dateMatch) {
                        const dateStr = dateMatch[1];
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime())) {
                          return (
                            <div>
                              <div className='text-sm text-gray-300'>{ago}</div>
                              <div className='text-xs text-gray-500'>{date.toLocaleString(undefined, { timeZoneName: 'short' })}</div>
                            </div>
                          );
                        }
                      }
                      
                      // パースに失敗した場合は元の形式を表示
                      return (
                        <div>
                          <div className='text-sm text-gray-300'>{ago}</div>
                          <div className='text-xs text-gray-500'>{datePart}</div>
                        </div>
                      );
                    }
                    
                    // フォールバック: 古い形式の場合
                    const firstSeenDate = parseDate(account.firstSeen);
                    if (!firstSeenDate) return 'Unknown';
                    return firstSeenDate.toLocaleString(undefined, { timeZoneName: 'short' });
                  })()}
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Last Activity</label>
                <div className='text-white'>
                  {(() => {
                    if (!account?.lastActivity) return 'Unknown';
                    // APIから返される形式: "2025-06-17 16:09:06 JST (29 days ago)"
                    if (account.lastActivity.includes('(') && account.lastActivity.includes(')')) {
                      const [datePart, agoPart] = account.lastActivity.split(' (');
                      const ago = agoPart?.replace(')', '');

                      // 日付部分をDateオブジェクトに変換
                      const dateMatch = datePart.match(/(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} [AP]M)/);
                      if (dateMatch) {
                        const dateStr = dateMatch[1];
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime())) {
                          return (
                            <div>
                              <div className='text-sm text-gray-300'>{ago}</div>
                              <div className='text-xs text-gray-500'>{date.toLocaleString(undefined, { timeZoneName: 'short' })}</div>
                            </div>
                          );
                        }
                      }
                      
                      // パースに失敗した場合は元の形式を表示

                      return (
                        <div>
                          <div className='text-sm text-gray-300'>{ago}</div>
                          <div className='text-xs text-gray-500'>{datePart}</div>
                        </div>
                      );
                    }
                    // フォールバック: 古い形式の場合
                    const lastActivityDate = parseDate(account.lastActivity);
                    if (!lastActivityDate) return 'Unknown';
                    const timestamp = Math.floor(lastActivityDate.getTime() / 1000);
                    return (
                <div>
                        <div className='text-sm text-gray-300'>{getTimeAgo(timestamp)}</div>
                        <div className='text-xs text-gray-500'>{formatTimestamp(timestamp)}</div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {account?.rank && (
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Rank</label>
                  <div className='text-purple-400 text-lg font-semibold'>
                    #{account.rank.toLocaleString()}
                  </div>
                </div>
              )}

              {account?.percentage && (
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Percentage</label>
                  <div className='text-gray-200'>
                    {parseFloat(account.percentage).toFixed(4)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contract Information (if applicable) */}
        {contract && (
          <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
            <h2 className='text-xl font-semibold text-gray-100 mb-4'>Contract Information</h2>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Name</label>
                <div className='text-white'>{contract.name}</div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Symbol</label>
                <div className='text-white'>{contract.symbol}</div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Type</label>
                <div className='text-white'>{contract.type}</div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Decimals</label>
                <div className='text-white'>{contract.decimals}</div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Total Supply</label>
                <div className='text-white'>{contract.totalSupply}</div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Verified</label>
                <div className={contract.verified ? 'text-green-400' : 'text-red-400'}>
                  {contract.verified ? 'Yes' : 'No'}
                </div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Creation Block</label>
                <div className='text-blue-400'>
                  {contract.blockNumber ? (
                    <Link
                      href={`/block/${contract.blockNumber}`}
                      className='hover:text-blue-300 transition-colors hover:underline'
                    >
                      {contract.blockNumber.toLocaleString()}
                    </Link>
                  ) : 'Unknown'}
                </div>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Creation Transaction</label>
                <div className='text-blue-400'>
                  {contract.creationTransaction ? (
                    <Link
                      href={`/tx/${contract.creationTransaction}`}
                      className='hover:text-blue-300 transition-colors hover:underline'
                    >
                      {formatAddress(contract.creationTransaction)}
                    </Link>
                  ) : 'Unknown'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transactions */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
          <div className='flex items-center justify-between mb-6'>
            <h2 className='text-xl font-semibold text-gray-100'>Transactions</h2>
          </div>
          
          {/* Tab Navigation */}
          <div className='flex flex-wrap gap-2 mb-6 border-b border-gray-700'>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`group relative px-4 py-2 rounded-t-lg font-medium transition-all duration-300 ${
                activeTab === 'transactions'
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
              }`}
            >
              <span className='relative z-10'>Regular Transactions ({regularCount})</span>
              {activeTab === 'transactions' && (
                <div className='absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-600/20 rounded-t-lg'></div>
              )}
            </button>
            <button
              onClick={() => setActiveTab('mining')}
              className={`group relative px-4 py-2 rounded-t-lg font-medium transition-all duration-300 ${
                activeTab === 'mining'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
              }`}
            >
              <span className='relative z-10'>Mining Rewards ({miningCount})</span>
              {activeTab === 'mining' && (
                <div className='absolute inset-0 bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 rounded-t-lg'></div>
              )}
            </button>
          </div>
          
          {/* Tab Content */}
          <div className='min-h-[400px] relative overflow-hidden'>
            <div 
              key={activeTab}
              className='animate-tabSlideIn'
              style={{
                animation: 'tabSlideIn 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              {activeTab === 'transactions' ? (
                <>
                  {regularTransactions.length === 0 ? (
                    <>
                      <p className='text-gray-400'>No regular transactions for this address.</p>
                      <div className='mt-4 text-center'>
                        <Link
                          href={`/address/${resolvedParams.address}/transactions`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View all {regularCount} transactions →
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className='overflow-x-auto'>
                        <table className='w-full'>
                          <thead>
                            <tr className='border-b border-gray-600'>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Transaction Hash</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>From</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>To</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Value</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Status</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                            </tr>
                          </thead>
                          <tbody className='divide-y divide-gray-600'>
                            {regularTransactions.slice(0, 10).map((tx) => (
                              <tr key={tx.hash} className='hover:bg-gray-700/50 transition-colors'>
                                <td className='py-3 px-4'>
                                  <Link
                                    href={`/tx/${tx.hash}`}
                                    className='text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors'
                                    title={tx.hash}
                                  >
                                    {formatAddress(tx.hash)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4'>
                                  <Link
                                    href={`/address/${tx.from}`}
                                    className='text-green-400 hover:text-green-300 font-mono text-sm transition-colors'
                                    title={tx.from}
                                  >
                                    {formatAddress(tx.from)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4'>
                                  {tx.to ? (
                                    <Link
                                      href={`/address/${tx.to}`}
                                      className='text-red-400 hover:text-red-300 font-mono text-sm transition-colors'
                                      title={tx.to}
                                    >
                                      {formatAddress(tx.to)}
                                    </Link>
                                  ) : (
                                    <span className='text-gray-500 text-sm'>Contract Creation</span>
                                  )}
                                </td>
                                <td className='py-3 px-4'>
                                  <span className='text-green-400'>{formatValue(tx.value)}</span>
                                </td>
                                <td className='py-3 px-4'>
                                  {(() => {
                                    const statusStr = String(tx.status || '');
                                    const isSuccess = 
                                      tx.status === 1 || 
                                      statusStr === '1' || 
                                      statusStr === 'true' ||
                                      statusStr === 'success' ||
                                      statusStr === 'Success' ||
                                      tx.status === 0x1 ||
                                      statusStr === '0x1';
                                    
                                    return isSuccess ? 
                                      <span className='text-green-400'>Success</span> : 
                                      <span className='text-red-400'>Failed</span>;
                                  })()}
                                </td>
                                <td className='py-3 px-4'>
                                  <div className='text-sm'>
                                    <div className='text-gray-300'>{getTimeAgo(tx.timestamp)}</div>
                                    <div className='text-gray-500 text-xs'>{formatTimestamp(tx.timestamp)}</div>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className='mt-4 text-center'>
                        <Link
                          href={`/address/${resolvedParams.address}/transactions`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View all {regularCount} transactions →
                        </Link>
            </div>
                    </>
                  )}
                </>
          ) : (
            <>
              {miningRewards.length === 0 ? (
                <>
                  <p className='text-gray-400'>No mining rewards for this address.</p>
                  <div className='mt-4 text-center'>
                    <Link
                      href={`/address/${resolvedParams.address}/mining`}
                      className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                    >
                      View all {miningCount} mining rewards →
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className='overflow-x-auto'>
                    <table className='w-full'>
                      <thead>
                        <tr className='border-b border-gray-600'>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Transaction Hash</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>From</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>To</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Value</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Status</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                        </tr>
                      </thead>
                      <tbody className='divide-y divide-gray-600'>
                        {miningRewards.slice(0, 10).map((tx) => (
                          <tr key={tx.hash} className='hover:bg-gray-700/50 transition-colors'>
                            <td className='py-3 px-4'>
                              <Link
                                href={`/tx/${tx.hash}`}
                                className='text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors'
                                title={tx.hash}
                              >
                                {formatAddress(tx.hash)}
                              </Link>
                            </td>
                            <td className='py-3 px-4'>
                              <span className='text-gray-400 font-mono text-sm'>System</span>
                            </td>
                            <td className='py-3 px-4'>
                              <Link
                                href={`/address/${tx.to}`}
                                className='text-red-400 hover:text-red-300 font-mono text-sm transition-colors'
                                title={tx.to}
                              >
                                {formatAddress(tx.to)}
                              </Link>
                            </td>
                            <td className='py-3 px-4'>
                              <span className='text-yellow-400'>{formatValue(tx.value)}</span>
                            </td>
                            <td className='py-3 px-4'>
                              <span className='text-green-400'>Success</span>
                            </td>
                            <td className='py-3 px-4'>
                              <div className='text-sm'>
                                <div className='text-gray-300'>{getTimeAgo(tx.timestamp)}</div>
                                <div className='text-gray-500 text-xs'>{formatTimestamp(tx.timestamp)}</div>
                    </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className='mt-4 text-center'>
                    <Link
                      href={`/address/${resolvedParams.address}/mining`}
                      className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                    >
                      View all {miningCount} mining rewards →
                    </Link>
                  </div>
                </>
              )}
            </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 