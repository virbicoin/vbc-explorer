'use client';

import { useState, useEffect } from 'react';
import { use } from 'react';
import Link from 'next/link';
import {
  CubeIcon,
  ClockIcon,
  ArrowUpIcon,
  ArrowPathIcon,
  BoltIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import SummaryCard from '../../components/SummaryCard';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../../lib/client-config';
import { initializeCurrency } from '../../../lib/bigint-utils';

interface Config {
  miners: Record<string, string>;
  explorer: {
    name: string;
    description: string;
    version: string;
    url: string;
  };
}

interface Block {
  number: number;
  hash: string;
  miner: string;
  timestamp: number;
  transactions: number;
  gasUsed: number;
  gasLimit: number;
  difficulty: string;
  totalDifficulty: string;
  size: number;
  nonce: string;
  extraData: string;
  parentHash: string;
  stateRoot: string;
  receiptsRoot: string;
  transactionsRoot: string;
  logsBloom: string;
  sha3Uncles: string;
  uncles: string[];
}

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  blockNumber: number;
  gasUsed?: number;
  status?: number | string;
  type?: string;
  action?: string;
}

export default function BlockDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const resolvedParams = use(params);
  const [block, setBlock] = useState<Block | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  useEffect(() => {
    // 設定を取得
    const fetchConfig = async () => {
      try {
        // Initialize currency conversion factors
        await initializeCurrency();
        // Initialize currency config cache
        await initializeCurrencyConfig();
        
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
    const fetchBlockData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/block/${resolvedParams.number}`);

        if (!response.ok) {
          throw new Error('Block not found');
        }

        const data = await response.json();
        setBlock(data.block);
        setTransactions(data.transactions || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch block data');
      } finally {
        setLoading(false);
      }
    };

    if (resolvedParams.number) {
      fetchBlockData();
    }
  }, [resolvedParams.number]);



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

  const formatValue = (value: string) => {
    try {
      const currencySymbol = getCurrencySymbol();
      // Convert from Wei to native currency (1 unit = 10^18 Wei)
      const weiValue = BigInt(value);
      const nativeValue = Number(weiValue) / 1e18;
      
      if (nativeValue === 0) return `0 ${currencySymbol}`;
      if (nativeValue < 0.000001) return `<0.000001 ${currencySymbol}`;
      if (nativeValue < 1) return `${nativeValue.toFixed(6)} ${currencySymbol}`;
      if (nativeValue < 1000) return `${nativeValue.toFixed(4)} ${currencySymbol}`;
      return `${nativeValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currencySymbol}`;
    } catch {
      const currencySymbol = getCurrencySymbol();
      return `${value} ${currencySymbol}`;
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
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
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        <span>{config.icon}</span>
        <span>{displayAction}</span>
      </span>
    );
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

  const formatDifficulty = (difficulty: string) => {
    const diff = parseFloat(difficulty);
    if (diff >= 1e12) return `${(diff / 1e12).toFixed(2)} TH`;
    if (diff >= 1e9) return `${(diff / 1e9).toFixed(2)} GH`;
    if (diff >= 1e6) return `${(diff / 1e6).toFixed(2)} MH`;
    if (diff >= 1e3) return `${(diff / 1e3).toFixed(2)} KH`;
    return diff.toLocaleString();
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

  if (error || !block) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
        <div className='container mx-auto px-4 py-8'>
          <div className='bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded mb-4'>
            <strong className='font-bold'>Error:</strong>
            <span className='block sm:inline'> {error || 'Block not found'}</span>
          </div>
          <Link href='/' className='inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors'>
            <ArrowUpIcon className='w-4 h-4' />
            Back to Explorer
          </Link>
        </div>
      </div>
    );
  }

  // サマリーカード
  const summaryStats = [
    {
      title: 'Block Number',
      value: block.number.toString(),
      sub: 'Current block number',
      icon: <CubeIcon className='w-5 h-5 text-green-400' />,
      colorClass: 'text-green-400'
    },
    {
      title: 'Transactions',
      value: block.transactions.toString(),
      sub: 'Transactions in block',
      icon: <ArrowPathIcon className='w-5 h-5 text-blue-400' />,
      colorClass: 'text-blue-400'
    },
    {
      title: 'Gas Used',
      value: `${block.gasUsed.toLocaleString()}`,
      sub: `Limit: ${block.gasLimit.toLocaleString()}`,
      icon: <BoltIcon className='w-5 h-5 text-orange-400' />,
      colorClass: 'text-orange-400'
    },
    {
      title: 'Timestamp',
      value: block.number === 0 ? (
        <div className='flex items-center gap-2'>
          <span className='bg-yellow-600/20 text-yellow-400 text-xs font-bold px-2 py-1 rounded border border-yellow-600/50'>GENESIS</span>
        </div>
      ) : getTimeAgo(block.timestamp),
      sub: block.number === 0 ? 'Genesis block' : formatTimestamp(block.timestamp),
      icon: <ClockIcon className='w-5 h-5 text-yellow-400' />,
      colorClass: 'text-yellow-400'
    }
  ];

  return (
    <div className='min-h-screen bg-gray-900 text-white'>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <CubeIcon className='w-8 h-8 text-green-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Block Details</h1>
          </div>
          <p className='text-gray-400'>
            {block.number === 0 ? (
              'Genesis block information and transaction details.'
            ) : (
              `Block #${block.number} information and transaction details.`
            )}
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

        {/* Block Information */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-semibold text-gray-100 mb-4'>Block Information</h2>
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Block Hash</label>
                <div className='bg-gray-700 rounded p-3 flex items-center justify-between'>
                  <span className='text-white font-mono text-sm break-all'>{block.hash}</span>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => copyToClipboard(block.hash)}
                      className='p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-all duration-200'
                      title='Copy to clipboard'
                    >
                      <ClipboardDocumentIcon className='w-4 h-4' />
                    </button>
                    {copiedItem === block.hash && (
                      <span className='text-green-400 text-sm font-mono'>Copied!</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Difficulty</label>
                  <div className='text-white'>{formatDifficulty(block.difficulty)}</div>
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Total Difficulty</label>
                  <div className='text-white'>{formatDifficulty(block.totalDifficulty)}</div>
                </div>
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Gas Used</label>
                  <div className='text-orange-400'>{block.gasUsed.toLocaleString()}</div>
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Gas Limit</label>
                  <div className='text-white'>{block.gasLimit.toLocaleString()}</div>
                </div>
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Nonce</label>
                  <div className='text-white font-mono text-sm'>{block.nonce}</div>
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Timestamp</label>
                  <div className='text-white'>
                    <div className='text-medium'>{formatTimestamp(block.timestamp)}</div>
                    <div className='text-xs text-gray-400'>{getTimeAgo(block.timestamp)}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Extra Data</label>
                <div className='bg-gray-700 rounded p-3'>
                  <span className='text-white font-mono text-sm break-all'>{block.extraData}</span>
                </div>
              </div>
            </div>

            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Parent Hash</label>
                <div className='bg-gray-700 rounded p-3 flex items-center justify-between'>
                  <Link href={`/block/${block.parentHash}`} className='text-blue-400 hover:text-blue-300 font-mono text-sm break-all'>
                    {block.parentHash}
                  </Link>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => copyToClipboard(block.parentHash)}
                      className='p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-all duration-200'
                      title='Copy to clipboard'
                    >
                      <ClipboardDocumentIcon className='w-4 h-4' />
                    </button>
                    {copiedItem === block.parentHash && (
                      <span className='text-green-400 text-sm font-mono'>Copied!</span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Miner</label>
                <div className='bg-gray-700 rounded p-3 flex items-center justify-between'>
                  {(() => {
                    const minerInfo = getMinerDisplayInfo(block.miner);
                    return (
                      <div className='text-white font-mono text-sm break-all'>
                        {block.miner === '0x0000000000000000000000000000000000000000' ? 
                          'System' : 
                          (minerInfo.isPool ? (
                            <Link
                              href={`/address/${minerInfo.address || ''}`}
                              className='text-green-400 hover:text-green-300 transition-colors hover:underline'
                              title={minerInfo.address || ''}
                            >
                              {minerInfo.name}
                            </Link>
                          ) : (
                            <Link
                              href={`/address/${block.miner}`}
                              className='text-green-400 hover:text-green-300 transition-colors hover:underline'
                              title={block.miner}
                            >
                              {block.miner}
                            </Link>
                          ))
                        }
                      </div>
                    );
                  })()}
                  {block.miner !== '0x0000000000000000000000000000000000000000' && (
                    <div className='flex items-center gap-2'>
                      <button
                        onClick={() => {
                          const minerInfo = getMinerDisplayInfo(block.miner);
                          const addressToCopy = minerInfo.isPool ? minerInfo.address || block.miner : block.miner;
                          copyToClipboard(addressToCopy);
                        }}
                        className='p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-all duration-200'
                        title='Copy to clipboard'
                      >
                        <ClipboardDocumentIcon className='w-4 h-4' />
                      </button>
                      {copiedItem === (getMinerDisplayInfo(block.miner).isPool ? getMinerDisplayInfo(block.miner).address || block.miner : block.miner) && (
                        <span className='text-green-400 text-sm font-mono'>Copied!</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>State Root</label>
                <div className='text-white font-mono text-sm break-all'>{block.stateRoot}</div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Receipts Root</label>
                <div className='text-white font-mono text-sm break-all'>{block.receiptsRoot}</div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Transactions Root</label>
                <div className='text-white font-mono text-sm break-all'>{block.transactionsRoot}</div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Size</label>
                <div className='text-white'>{block.size} bytes</div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-semibold text-gray-100 mb-4'>Block Navigation</h2>
          <div className='flex items-center justify-between'>
            <Link
              href={`/block/${block.number + 1}`}
              className='flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl'
            >
              <ChevronLeftIcon className='w-4 h-4' />
              Next Block
            </Link>
            
            <div className='flex flex-col items-center'>
              <div className='text-2xl font-bold text-white'>
                Block #{block.number}
              </div>
              <div className='text-sm text-gray-300 mt-1'>
                {block.number === 0 ? 'Genesis Block' : `${block.transactions} transactions`}
              </div>
            </div>
            
            <Link
              href={`/block/${block.number - 1}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl ${
                block.number === 0 ? 
                  'text-gray-500 cursor-not-allowed bg-gray-700 opacity-50' : 
                  'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
              onClick={(e) => block.number === 0 && e.preventDefault()}
            >
              Previous Block
              <ChevronRightIcon className='w-4 h-4' />
            </Link>
          </div>
        </div>

        {/* Transactions */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
          <h2 className='text-xl font-semibold text-gray-100 mb-4'>Transactions</h2>
          {transactions.length === 0 ? (
            <p className='text-gray-400'>No transactions in this block.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full'>
                <thead>
                  <tr className='border-b border-gray-600'>
                    <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Transaction Hash</th>
                    <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Type</th>
                    <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>From</th>
                    <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>To</th>
                    <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Value</th>
                    <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Status</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-600'>
                  {transactions.map((tx) => (
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
                        {getTransactionTypeBadge(tx.type, tx.action)}
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
                          const isSuccess = 
                            tx.status === 1 || 
                            tx.status === '1' || 
                            tx.status === 'true' ||
                            tx.status === 'success' ||
                            tx.status === 'Success' ||
                            tx.status === 0x1 ||
                            tx.status === '0x1';
                          
                          return isSuccess ? 
                            <span className='text-green-400'>Success</span> : 
                            <span className='text-red-400'>Failed</span>;
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>


    </div>
  );
}