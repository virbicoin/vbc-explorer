'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  CubeIcon, 
  ClockIcon, 
  CalendarIcon,
  ArrowPathIcon,
  BoltIcon
} from '@heroicons/react/24/outline';
import SummaryCard from '../components/SummaryCard';

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
  number: string;
  hash: string;
  miner: string;
  timestamp: string;
  transactions: string;
  gasUsed: string;
  gasLimit: string;
  difficulty: string;
  totalDifficulty: string;
  size: string;
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

export default function BlocksPage() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stats, setStats] = useState({
    avgBlockTime: '-',
    totalTransactions: 0,
    lastBlockTimestamp: 0,
    lastBlockTime: 'Unknown'
  });
  const [latestBlockTimestamp, setLatestBlockTimestamp] = useState(0);

  useEffect(() => {
    // 設定を取得
    const fetchConfig = async () => {
      try {
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
            lastBlockTime: statsData.lastBlockTime || 'Unknown'
          });
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
      }
    };
    fetchStats();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ブロック一覧を取得（ポーリング付き）
  useEffect(() => {
    let isMounted = true;
    
    const fetchBlocks = async (isInitial: boolean = false) => {
      try {
        if (isInitial) {
          setLoading(true);
        }
        setError(null);
        
        // キャッシュを無効化してフェッチ
        const response = await fetch(`/api/blocks?page=${currentPage}&limit=50&_t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        if (!response.ok) {
          throw new Error('Failed to fetch blocks');
        }
        const data = await response.json();
        
        if (isMounted) {
          const blocksData = Array.isArray(data.blocks) ? data.blocks : [];
          setBlocks(blocksData);
          setTotalPages(data.pagination?.totalPages || 1);
          setTotalBlocks(data.pagination?.total || 0);
          // 最新ブロックのタイムスタンプをリアルタイムで更新
          if (blocksData.length > 0 && blocksData[0].timestamp) {
            setLatestBlockTimestamp(Number(blocksData[0].timestamp));
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'An error occurred');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    // 初回ロード
    fetchBlocks(true);
    
    // ページ1の場合のみポーリング（5秒間隔）
    let interval: NodeJS.Timeout | null = null;
    if (currentPage === 1) {
      interval = setInterval(() => fetchBlocks(false), 5000);
    }
    
    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [currentPage]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const getTimeAgo = (timestamp: string) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - Number(timestamp);

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

  // サマリーカード用ダミー値（本番ではAPIや集計値を利用）
  const summaryStats = [
    {
      title: 'Latest Block',
      value: blocks.length > 0 ? Number(blocks[0].number).toLocaleString() : '-',
      sub: 'Most recent block number',
      icon: <CubeIcon className='w-5 h-5 text-green-400' />,
      colorClass: 'text-green-400'
    },
    {
      title: 'Total Transactions',
      value: stats.totalTransactions.toLocaleString(),
      sub: 'Total transactions in chain',
      icon: <ArrowPathIcon className='w-5 h-5 text-blue-400' />,
      colorClass: 'text-blue-400'
    },
    {
      title: 'Average Block Time',
      value: `${stats.avgBlockTime}s`,
      sub: 'Average time between blocks',
      icon: <ClockIcon className='w-5 h-5 text-yellow-400' />,
      colorClass: 'text-yellow-400'
    },
    {
      title: 'Last Block Found',
      value: (() => {
        // blocksから取得したリアルタイムのタイムスタンプを優先
        const timestamp = latestBlockTimestamp > 0 ? latestBlockTimestamp : stats.lastBlockTimestamp;
        if (timestamp && timestamp > 0) {
          const secondsAgo = Math.floor(now / 1000 - timestamp);
          if (secondsAgo < 0) return '0s ago';
          if (secondsAgo < 60) return `${secondsAgo}s ago`;
          if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
          if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
          return `${Math.floor(secondsAgo / 86400)}d ago`;
        }
        return stats.lastBlockTime || 'Unknown';
      })(),
      sub: 'Time since last block',
      icon: <CalendarIcon className='w-5 h-5 text-emerald-400' />,
      colorClass: 'text-emerald-400'
    }
  ];

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
            <span className='block sm:inline'> {error}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-900 text-white'>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <CubeIcon className='w-8 h-8 text-green-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Latest Blocks</h1>
          </div>
          <p className='text-gray-400'>Most recent blocks on the network</p>
        </div>
      </div>
      <main className='container mx-auto px-4 py-8'>
        {/* Summary Cards */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-8'>
          {summaryStats.map((stat, idx) => (
            <SummaryCard key={idx} {...stat} />
          ))}
        </div>
        {/* Block List Table */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
          <div className='flex items-center justify-between mb-6'>
            <h2 className='text-xl font-semibold text-gray-100'>Block List</h2>
            <div className='text-sm text-gray-400'>
              Showing {blocks.length} of {totalBlocks.toLocaleString()} blocks
            </div>
          </div>
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead>
                <tr className='border-b border-gray-600'>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Block</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Miner</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Transactions</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Gas Used</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Hash</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-700'>
                {blocks.map((block) => (
                  <tr key={block.number} className='hover:bg-gray-700/50 transition-colors'>
                    <td className='py-3 px-4 whitespace-nowrap'>
                      <Link href={`/block/${block.number}`} className='text-blue-400 hover:text-blue-300 font-medium transition-colors'>
                          {block.number.toLocaleString()}
                        </Link>
                    </td>
                    <td className='py-3 px-4 whitespace-nowrap'>
                      {block.number === '0' ? (
                        <div className='flex items-center gap-2'>
                          <span className='bg-yellow-600/20 text-yellow-400 text-xs font-bold px-2 py-1 rounded border border-yellow-600/50'>GENESIS</span>
                        </div>
                      ) : (
                        <div className='flex items-center gap-2'>
                          <ClockIcon className='w-4 h-4 text-gray-500 flex-shrink-0' />
                          <div>
                            <div className='text-sm text-gray-300'>{getTimeAgo(block.timestamp)}</div>
                            <div className='text-xs text-gray-500'>{formatTimestamp(block.timestamp)}</div>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className='py-3 px-4 whitespace-nowrap'>
                      {block.miner === '0x0000000000000000000000000000000000000000' ? (
                        <span className='text-gray-400 font-mono text-sm'>System</span>
                      ) : (
                        (() => {
                          const minerInfo = getMinerDisplayInfo(block.miner);
                          return (
                            <Link
                              href={`/address/${minerInfo.address || ''}`} 
                              className='text-green-400 hover:text-green-300 font-mono text-sm transition-colors hover:underline'
                              title={minerInfo.address || ''}
                            >
                              {minerInfo.isPool ? minerInfo.name : (minerInfo.address || 'Unknown')}
                            </Link>
                          );
                        })()
                      )}
                    </td>
                    <td className='py-3 px-4 whitespace-nowrap'>
                      <span className='text-gray-300 font-medium'>{block.transactions || '0'}</span>
                    </td>
                    <td className='py-3 px-4 whitespace-nowrap'>
                      <div className='flex items-center gap-2'>
                        <BoltIcon className='w-4 h-4 text-orange-400' />
                        <span className='text-orange-400 font-medium'>{block.gasUsed ? Number(block.gasUsed).toLocaleString() : 'N/A'}</span>
                          {block.gasLimit && (
                          <span className='text-xs text-gray-500'> / {Number(block.gasLimit).toLocaleString()}</span>
                          )}
                      </div>
                    </td>
                    <td className='py-3 px-4 whitespace-nowrap'>
                      <Link href={`/block/${block.hash}`} className='text-gray-400 hover:text-gray-300 font-mono text-sm transition-colors' title={block.hash}>
                        {`${block.hash.slice(0, 10)}...${block.hash.slice(-8)}`}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Pagination UI */}
        {totalPages > 1 && (
          <div className='flex justify-center items-center gap-4 mt-8'>
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className='px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium'
            >
              Previous
            </button>
            
            <div className='flex items-center gap-2'>
              {/* 最初のページ */}
              {currentPage > 3 && (
                <>
              <button
                    onClick={() => setCurrentPage(1)}
                    className='px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors font-medium'
              >
                1
              </button>
                  {currentPage > 4 && <span className='text-gray-500'>...</span>}
                </>
              )}
              
              {/* 現在のページ周辺 */}
              {Array.from({ length: 5 }, (_, i) => currentPage - 2 + i)
                .filter(page => page >= 1 && page <= totalPages)
                .map(page => (
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
                  {currentPage < totalPages - 3 && <span className='text-gray-500'>...</span>}
                <button
                    onClick={() => setCurrentPage(totalPages)}
                    className='px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors font-medium'
                >
                  {totalPages}
                </button>
                </>
              )}
            </div>
            
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className='px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium'
            >
              Next
            </button>
          </div>
        )}

        {/* ページ情報 */}
        <div className='text-center mt-4 text-gray-400 text-sm'>
          Showing blocks {((currentPage - 1) * 50) + 1} to {Math.min(currentPage * 50, totalBlocks)} of {totalBlocks.toLocaleString()} total blocks
        </div>
      </main>
    </div>
  );
}
