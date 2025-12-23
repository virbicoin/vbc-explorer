'use client';

import { useState, useEffect } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { 
  ArrowUpIcon, 
  ClockIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CubeIcon,
  BoltIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../../lib/client-config';
import { initializeCurrency, formatGasUnit } from '../../../lib/bigint-utils';

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
  gas: string;
  gasPrice: string;
  gasUsed?: number;
  nonce: number;
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  status: string;
  timestamp: number;
  isContractCreation: boolean;
  inputData?: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
    logIndex: number;
    transactionIndex: number;
    transactionHash: string;
    blockHash: string;
    blockNumber: number;
  }>;
  internalTransactions: Array<{
    from: string;
    to: string;
    value: string;
    type: string;
  }>;
  block?: {
    number: number;
    hash: string;
    timestamp: number;
    miner: string;
  };
  isMiningReward?: boolean; // Added for mining reward
  txType?: string; // MetaMask compliant type
  txAction?: string; // MetaMask compliant action
  // Additional fields for mining reward transactions
  cumulativeGasUsed?: number;
  effectiveGasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  type?: number;
  accessList?: Array<{ address: string; storageKeys: string[] }>;
  v?: string;
  r?: string;
  s?: string;
}

export default function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const resolvedParams = use(params);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [currencySymbol, setCurrencySymbol] = useState<string>('');

  useEffect(() => {
    // 設定を取得
    const fetchConfig = async () => {
      try {
        // Initialize currency conversion factors
        await initializeCurrency();
        
        // Load config values from API
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
    const fetchTransactionData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/tx/${resolvedParams.hash}`);
        
        if (!response.ok) {
          throw new Error('Transaction not found');
        }
        
        const data = await response.json();
        setTransaction(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch transaction data');
      } finally {
        setLoading(false);
      }
    };

    if (resolvedParams.hash) {
      fetchTransactionData();
    }
  }, [resolvedParams.hash]);

  const formatValue = (value: string) => {
    try {
      // Convert from Wei to native currency (1 unit = 10^18 Wei)
      const weiValue = BigInt(value);
      const nativeValue = Number(weiValue) / 1e18;
      
      if (nativeValue === 0) return `0 ${currencySymbol}`;
      if (nativeValue < 0.000001) return `<0.000001 ${currencySymbol}`;
      // Display without rounding decimals
      return `${nativeValue} ${currencySymbol}`;
    } catch {
      return `${value} ${currencySymbol}`;
    }
  };

  const formatGasPrice = (gasPrice: string) => {
    try {
      const weiValue = BigInt(gasPrice);
      const gasUnitValue = Number(weiValue) / 1e9;
      
      if (gasUnitValue >= 1) {
        return formatGasUnit(gasUnitValue.toString());
      } else {
        return `${Number(weiValue)} wei`;
      }
    } catch {
      return `${gasPrice} wei`;
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
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
      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
        <span>{config.icon}</span>
        <span>{displayAction}</span>
      </span>
    );
  };

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

  if (loading) {
    return (
      <>
        <div className='bg-gray-800 border-b border-gray-700'>
          <div className='container mx-auto px-4 py-8'>
            <div className='flex items-center gap-3 mb-4'>
              <ArrowUpIcon className='w-8 h-8 text-blue-400' />
              <h1 className='text-3xl font-bold text-gray-100'>Transaction Details</h1>
            </div>
            <p className='text-gray-400'>Loading transaction information...</p>
          </div>
        </div>
        <main className='container mx-auto px-4 py-8'>
          <div className='bg-gray-800 rounded-lg border border-gray-700 p-8 text-center'>
            <div className='animate-spin w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full mx-auto mb-4'></div>
            <p className='text-gray-400'>Loading transaction details...</p>
          </div>
        </main>
      </>
    );
  }

  if (error || !transaction) {
    return (
      <>
        <div className='bg-gray-800 border-b border-gray-700'>
          <div className='container mx-auto px-4 py-8'>
            <div className='flex items-center gap-3 mb-4'>
              <ArrowUpIcon className='w-8 h-8 text-red-400' />
              <h1 className='text-3xl font-bold text-gray-100'>Transaction Not Found</h1>
            </div>
            <p className='text-gray-400'>The requested transaction could not be found.</p>
          </div>
        </div>
        <main className='container mx-auto px-4 py-8'>
          <div className='bg-gray-800 rounded-lg border border-gray-700 p-8 text-center'>
            <p className='text-red-400 mb-4'>{error || 'Transaction not found'}</p>
            <Link
              href='/'
              className='inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors'
            >
              <ArrowUpIcon className='w-4 h-4' />
              Back to Explorer
            </Link>
      </div>
        </main>
      </>
    );
  }

  if (!loading && transaction) {
    // Summary cards
    const summaryStats = [
      {
        title: 'Value',
        value: (() => {
          try {
            const weiValue = BigInt(transaction.value);
            const nativeValue = Number(weiValue) / 1e18;
            const symbol = currencySymbol || 'ETH';
            if (nativeValue === 0) return `0 ${symbol}`;
            if (nativeValue < 0.000001) return `<0.000001 ${symbol}`;
            return `${nativeValue.toFixed(4)} ${symbol}`;
          } catch {
            const symbol = currencySymbol || 'ETH';
            return `${transaction.value} ${symbol}`;
          }
        })(),
        sub: 'Transaction amount',
        icon: <CurrencyDollarIcon className='w-5 h-5 text-green-400' />,
        colorClass: 'text-green-400'
      },
      {
        title: 'Gas Used',
        value: transaction.gasUsed !== undefined ? `${transaction.gasUsed.toLocaleString()} ${formatGasUnit('1').split(' ')[1] || 'Gwei'}` : `0 ${formatGasUnit('1').split(' ')[1] || 'Gwei'}`,
        sub: 'Gas consumed by transaction',
        icon: <BoltIcon className='w-5 h-5 text-orange-400' />,
        colorClass: 'text-orange-400'
      },
      {
        title: 'Status',
        value: transaction.status === 'success' ? 'Success' : 'Failed',
        sub: 'Transaction execution status',
        icon: <ExclamationTriangleIcon className={`w-5 h-5 ${transaction.status === 'success' ? 'text-green-400' : 'text-red-400'}`} />,
        colorClass: transaction.status === 'success' ? 'text-green-400' : 'text-red-400'
      },
      {
        title: 'Timestamp',
        value: transaction.block ? getTimeAgo(transaction.block.timestamp) : 'Unknown',
        sub: transaction.block ? formatTimestamp(transaction.block.timestamp) : 'No block info',
        icon: <ClockIcon className='w-5 h-5 text-yellow-400' />,
        colorClass: 'text-yellow-400'
      }
    ];

    // Transaction main info table
    const transactionInfo = [
      { 
        label: 'Hash', 
        value: (
          <div className='bg-gray-700 rounded p-3'>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-gray-400 text-sm'>Transaction Hash</span>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => copyToClipboard(transaction.hash)}
                  className='p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded transition-all duration-200'
                  title='Copy hash to clipboard'
            >
                  <ClipboardDocumentIcon className='w-4 h-4' />
                </button>
                {copiedItem === transaction.hash && (
                  <span className='text-green-400 text-sm font-mono'>Copied!</span>
                )}
      </div>
            </div>
            <code className='text-sm text-gray-300 break-all font-mono'>
              {transaction.hash}
            </code>
          </div>
        ),
        colSpan: 2
      },
      { 
        label: 'From', 
        value: (
          <div className='bg-gray-700 rounded p-3'>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-gray-400 text-sm'>From Address</span>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => copyToClipboard(transaction.from)}
                  className='p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded transition-all duration-200'
                  title='Copy address to clipboard'
                >
                  <ClipboardDocumentIcon className='w-4 h-4' />
                </button>
                {copiedItem === transaction.from && (
                  <span className='text-green-400 text-sm font-mono'>Copied!</span>
                )}
            </div>
            </div>
            {transaction.from === '0x0000000000000000000000000000000000000000' ? (
              <span className='text-gray-400 font-mono text-sm'>System</span>
            ) : (
              <Link href={`/address/${transaction.from}`} className='text-blue-400 hover:underline font-mono break-all text-sm'>
                {transaction.from}
              </Link>
            )}
          </div>
        )
      },
      { 
        label: 'To', 
        value: transaction.isContractCreation ? (
          <div className='bg-gray-700 rounded p-3'>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-gray-400 text-sm'>To Address</span>
            </div>
            <span className='text-yellow-400 font-mono text-sm'>Contract Creation</span>
          </div>
        ) : (
          <div className='bg-gray-700 rounded p-3'>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-gray-400 text-sm'>To Address</span>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => copyToClipboard(transaction.to)}
                  className='p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded transition-all duration-200'
                  title='Copy address to clipboard'
                >
                  <ClipboardDocumentIcon className='w-4 h-4' />
                </button>
                {copiedItem === transaction.to && (
                  <span className='text-green-400 text-sm font-mono'>Copied!</span>
              )}
            </div>
            </div>
            <Link href={`/address/${transaction.to}`} className='text-blue-400 hover:underline font-mono break-all text-sm'>
              {transaction.to}
            </Link>
          </div>
        )
      },
      { 
        label: 'Value', 
        value: <span className='text-green-400'>{formatValue(transaction.value)}</span>
      },
      { 
        label: 'Gas Used', 
        value: <span className='text-orange-400'>{transaction.gasUsed !== undefined ? transaction.gasUsed.toLocaleString() : '0'} {formatGasUnit('1').split(' ')[1] || 'Gwei'}</span>
      },
      { 
        label: 'Gas Price', 
        value: transaction.gasPrice ? formatGasPrice(transaction.gasPrice) : '0 wei'
      },
      { label: 'Gas Limit', value: transaction.gas || '0' },
      { label: 'Nonce', value: transaction.nonce },
      { label: 'Transaction Index', value: transaction.transactionIndex },
      { 
        label: 'Status', 
        value: (
          <span className={`font-semibold ${transaction.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {transaction.status === 'success' ? 'Success' : 'Failed'}
          </span>
        )
      },
      { 
        label: 'Timestamp', 
        value: transaction.block ? (
          <div>
            <div className='text-gray-200'>{formatTimestamp(transaction.block.timestamp)}</div>
            <div className='text-sm text-gray-400'>{getTimeAgo(transaction.block.timestamp)}</div>
          </div>
        ) : 'Unknown'
      }
    ];

    return (
      <>
        {/* Page Header */}
        <div className='bg-gray-800 border-b border-gray-700'>
          <div className='container mx-auto px-4 py-8'>
            <div className='flex items-center gap-3 mb-4'>
              <ArrowPathIcon className='w-8 h-8 text-blue-400' />
              <h1 className='text-3xl font-bold text-gray-100'>Transaction Details</h1>
              {getTransactionTypeBadge(transaction.txType, transaction.txAction)}
            </div>
            <p className='text-gray-400'>
              Transaction {formatAddress(transaction.hash)} details and information.
            </p>
          </div>
            </div>

        <main className='container mx-auto px-4 py-8'>
          {/* Summary Cards */}
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8'>
            {summaryStats.map((stat, idx) => (
              <div key={idx} className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
                <div className='flex items-center gap-3 mb-4'>
                  {stat.icon}
                  <h3 className='text-lg font-semibold text-gray-100'>{stat.title}</h3>
                </div>
                <div className={`text-2xl font-bold ${stat.colorClass}`}>
                  {stat.value}
                </div>
                <div className='text-sm text-gray-400 mt-2'>
                  {stat.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Transaction Information */}
          <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
            <h2 className='text-xl font-semibold text-gray-100 mb-4'>Transaction Information</h2>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
              {transactionInfo.map((info, idx) => (
                <div key={idx} className={info.colSpan === 2 ? 'md:col-span-2' : ''}>
                  <span className='text-gray-400 text-sm'>{info.label}</span>
                  <div className='text-lg font-semibold text-gray-200 mt-1'>
                    {info.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

        {/* Block Information */}
        {transaction.block && (
            <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
              <div className='flex items-center gap-3 mb-4'>
                <CubeIcon className='w-6 h-6 text-blue-400' />
                <h2 className='text-xl font-semibold text-gray-100'>Block Information</h2>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'>
                <div>
                  <span className='text-gray-400 text-sm'>Block Number</span>
                  <div className='text-lg font-semibold text-blue-400'>
                <Link
                  href={`/block/${transaction.block.number}`}
                      className='hover:text-blue-300 transition-colors hover:underline'
                >
                      {transaction.block.number.toLocaleString()}
                </Link>
              </div>
                </div>
                <div>
                  <span className='text-gray-400 text-sm'>Block Hash</span>
                  <div className='text-sm font-mono text-blue-400 break-all'>
                <Link
                  href={`/block/${transaction.block.hash}`}
                      className='hover:text-blue-300 transition-colors hover:underline'
                      title={transaction.block.hash}
                >
                      {`${transaction.block.hash.slice(0, 10)}...${transaction.block.hash.slice(-8)}`}
                </Link>
              </div>
                </div>
                <div>
                  <span className='text-gray-400 text-sm'>Timestamp</span>
                  <div className='text-sm font-semibold text-gray-200'>
                    {formatTimestamp(transaction.block.timestamp)}
                  </div>
                  <div className='text-sm text-gray-400'>
                    {getTimeAgo(transaction.block.timestamp)}
                  </div>
                </div>
                  <div>
                  <span className='text-gray-400 text-sm'>Miner</span>
                  <div className='text-sm font-semibold text-green-400'>
                    {(() => {
                      const minerInfo = getMinerDisplayInfo(transaction.block.miner);
                      return (
                        <Link
                          href={`/address/${minerInfo.address || ''}`}
                          className='hover:text-green-300 transition-colors hover:underline'
                          title={minerInfo.address || ''}
                        >
                          {minerInfo.isPool ? minerInfo.name : formatAddress(minerInfo.address || '')}
                        </Link>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Input Data */}
          {transaction.inputData && transaction.inputData !== '0x' && (
            <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
              <div className='flex items-center gap-3 mb-4'>
                <DocumentTextIcon className='w-6 h-6 text-purple-400' />
                <h2 className='text-xl font-semibold text-gray-100'>Input Data</h2>
              </div>
              <div className='bg-gray-700 rounded p-4'>
                <div className='flex items-center justify-between mb-2'>
                  <span className='text-gray-400 text-sm'>Transaction Input</span>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => copyToClipboard(transaction.inputData!)}
                      className='p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded transition-all duration-200'
                      title='Copy input data to clipboard'
                    >
                      <ClipboardDocumentIcon className='w-4 h-4' />
                    </button>
                    {copiedItem === transaction.inputData && (
                      <span className='text-green-400 text-sm font-mono'>Copied!</span>
                    )}
                  </div>
                </div>
                <code className='text-sm text-gray-300 break-all font-mono'>
                  {transaction.inputData}
                </code>
              </div>
            </div>
          )}

          {/* Logs */}
          {transaction.logs && transaction.logs.length > 0 && (
            <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
              <div className='flex items-center gap-3 mb-4'>
                <DocumentTextIcon className='w-6 h-6 text-blue-400' />
                <h2 className='text-xl font-semibold text-gray-100'>Logs ({transaction.logs.length})</h2>
              </div>
              <div className='space-y-4'>
                {transaction.logs.map((log, index) => (
                  <div key={index} className='bg-gray-700 rounded p-4'>
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-4 text-sm'>
                      <div>
                        <span className='text-gray-400'>Address:</span>
                        <div className='font-mono text-blue-400 break-all'>{log.address}</div>
                      </div>
                      <div>
                        <span className='text-gray-400'>Topics:</span>
                        <div className='space-y-1'>
                          {log.topics.map((topic, topicIndex) => (
                            <div key={topicIndex} className='font-mono text-sm text-gray-300 break-all'>
                              {topic}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Advanced Transaction Details */}
          {(transaction.cumulativeGasUsed !== undefined || transaction.effectiveGasPrice || transaction.maxFeePerGas || transaction.maxPriorityFeePerGas || transaction.v || transaction.r || transaction.s) && (
            <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
              <div className='flex items-center gap-3 mb-4'>
                <DocumentTextIcon className='w-6 h-6 text-yellow-400' />
                <h2 className='text-xl font-semibold text-gray-100'>Advanced Transaction Details</h2>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
                {transaction.cumulativeGasUsed !== undefined && (
                  <div>
                    <span className='text-gray-400 text-sm'>Cumulative Gas Used</span>
                    <div className='text-lg font-semibold text-orange-400'>
                      {transaction.cumulativeGasUsed.toLocaleString()} {formatGasUnit('1').split(' ')[1] || 'Gwei'}
                    </div>
                  </div>
                )}
                {transaction.effectiveGasPrice && (
                  <div>
                    <span className='text-gray-400 text-sm'>Effective Gas Price</span>
                    <div className='text-lg font-semibold text-blue-400'>
                      {formatGasPrice(transaction.effectiveGasPrice)}
                    </div>
                  </div>
                )}
                {transaction.maxFeePerGas && (
                  <div>
                    <span className='text-gray-400 text-sm'>Max Fee Per Gas</span>
                    <div className='text-lg font-semibold text-purple-400'>
                      {formatGasPrice(transaction.maxFeePerGas)}
                    </div>
                  </div>
                )}
                {transaction.maxPriorityFeePerGas && (
                  <div>
                    <span className='text-gray-400 text-sm'>Max Priority Fee Per Gas</span>
                    <div className='text-lg font-semibold text-green-400'>
                      {formatGasPrice(transaction.maxPriorityFeePerGas)}
                    </div>
                  </div>
                )}
                {transaction.v && (
                  <div>
                    <span className='text-gray-400 text-sm'>V (Recovery ID)</span>
                    <div className='text-sm font-mono text-gray-300 break-all'>
                      {transaction.v}
                    </div>
                  </div>
                )}
                {transaction.r && (
                  <div>
                    <span className='text-gray-400 text-sm'>R (Signature)</span>
                    <div className='text-sm font-mono text-gray-300 break-all'>
                      {transaction.r}
                    </div>
                  </div>
                )}
                {transaction.s && (
                  <div>
                    <span className='text-gray-400 text-sm'>S (Signature)</span>
                    <div className='text-sm font-mono text-gray-300 break-all'>
                      {transaction.s}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Access List */}
          {transaction.accessList && transaction.accessList.length > 0 && (
            <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
              <div className='flex items-center gap-3 mb-4'>
                <DocumentTextIcon className='w-6 h-6 text-indigo-400' />
                <h2 className='text-xl font-semibold text-gray-100'>Access List ({transaction.accessList.length})</h2>
              </div>
              <div className='space-y-4'>
                {transaction.accessList.map((access, index) => (
                  <div key={index} className='bg-gray-700 rounded p-4'>
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-4 text-sm'>
                      <div>
                        <span className='text-gray-400'>Address:</span>
                        <div className='font-mono text-blue-400 break-all'>{access.address}</div>
                      </div>
                      <div>
                        <span className='text-gray-400'>Storage Keys:</span>
                        <div className='space-y-1'>
                          {access.storageKeys.map((key, keyIndex) => (
                            <div key={keyIndex} className='font-mono text-sm text-gray-300 break-all'>
                              {key}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Internal Transactions */}
          {transaction.internalTransactions && transaction.internalTransactions.length > 0 && (
            <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
              <div className='flex items-center gap-3 mb-4'>
                <DocumentTextIcon className='w-6 h-6 text-purple-400' />
                <h2 className='text-xl font-semibold text-gray-100'>Internal Transactions ({transaction.internalTransactions.length})</h2>
              </div>
              <div className='space-y-4'>
                {transaction.internalTransactions.map((internalTx, index) => (
                  <div key={index} className='bg-gray-700 rounded p-4'>
                    <div className='grid grid-cols-1 md:grid-cols-3 gap-4 text-sm'>
                      <div>
                        <span className='text-gray-400'>From:</span>
                        <div className='font-mono text-blue-400 break-all'>{internalTx.from}</div>
                      </div>
                      <div>
                        <span className='text-gray-400'>To:</span>
                        <div className='font-mono text-blue-400 break-all'>{internalTx.to}</div>
                      </div>
                      <div>
                        <span className='text-gray-400'>Value:</span>
                        <div className='text-green-400'>{formatValue(internalTx.value)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
        )}
      </main>


    </>
  );
  }
} 