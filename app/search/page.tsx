'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  MagnifyingGlassIcon, 
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CubeIcon,
  ClockIcon,
  UserIcon,
  CurrencyDollarIcon
} from '@heroicons/react/24/outline';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../lib/client-config';

interface Config {
  miners: Record<string, string>;
  explorer: {
    name: string;
    description: string;
    version: string;
    url: string;
  };
}

interface SearchResult {
  type: 'block' | 'transaction' | 'address';
  data: {
    number?: number;
    hash?: string;
    timestamp?: Date;
    miner?: string;
    from?: string;
    to?: string;
    value?: string;
    address?: string;
    balance?: string;
  };
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    // 設定を取得
    const fetchConfig = async () => {
      try {
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

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      
      if (!response.ok) {
        throw new Error('Search failed');
        }
      
      const data = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
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

  return (
    <div className='min-h-screen bg-gray-900 text-white'>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <MagnifyingGlassIcon className='w-8 h-8 text-blue-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Search Results</h1>
          </div>
          <div className='flex items-center gap-4'>
            <Link
              href='/'
              className='inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors'
            >
              <ArrowPathIcon className='w-4 h-4' />
              Back to Explorer
            </Link>
            {query && (
              <span className='text-gray-400'>
                Results for: <span className='font-mono text-blue-400'>&quot;{query}&quot;</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <main className='container mx-auto px-4 py-8'>
        {/* Search Form */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <form onSubmit={handleSubmit} className='flex gap-4'>
            <input
              type='text'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search by block number, block hash, or miner address...'
              className='flex-1 bg-gray-700 border border-gray-600 text-gray-200 rounded px-4 py-2 focus:border-blue-500 focus:outline-none'
            />
            <button
              type='submit'
              className='bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition-colors'
              disabled={loading}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
        </div>

        {/* Results */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
          {loading ? (
            <div className='text-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4'></div>
              <p className='text-gray-400'>Searching...</p>
            </div>
          ) : error ? (
            <div className='text-center py-8'>
              <ExclamationTriangleIcon className='w-16 h-16 text-red-500 mx-auto mb-4' />
              <p className='text-gray-400 text-lg mb-2'>Error: {error}</p>
              <p className='text-gray-500 text-sm'>
                Try searching with a different block number, hash, or address.
              </p>
            </div>
          ) : results.length > 0 ? (
            <div className='space-y-4'>
              <h2 className='text-xl font-bold text-gray-100 mb-4'>
                Found {results.length} result{results.length !== 1 ? 's' : ''}
              </h2>
              {results.map((result, index) => (
                <div key={index} className='bg-gray-700/50 rounded-lg border border-gray-600 p-4'>
                  {result.type === 'block' && (
                    <div>
                      <div className='flex items-center justify-between mb-2'>
                        <span className='text-sm text-blue-400 font-medium'>Block</span>
                        <Link
                          href={`/block/${result.data.number}`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View Details →
                        </Link>
                      </div>
                      <h3 className='text-lg font-bold text-gray-100 mb-2 flex items-center gap-2'>
                        <CubeIcon className='w-5 h-5 text-blue-400 mr-2' />
                        <Link
                          href={`/block/${result.data.number}`}
                          className='text-blue-400 hover:text-blue-300 transition-colors hover:underline'
                        >
                          {result.data.number?.toLocaleString()}
                        </Link>
                        {result.data.number === 0 && (
                          <span className='bg-yellow-600/20 text-yellow-400 text-xs font-bold px-2 py-1 rounded border border-yellow-600/50'>
                            GENESIS
                          </span>
                        )}
                      </h3>
                      <div className='grid grid-cols-1 md:grid-cols-2 gap-4 text-sm'>
                        <div>
                          <span className='text-gray-400'>Hash:</span>
                          <Link
                            href={`/block/${result.data.hash}`}
                            className='font-mono text-blue-400 hover:text-blue-300 ml-2 break-all transition-colors hover:underline'
                            title={String(result.data.hash)}
                          >
                            {String(result.data.hash)}
                          </Link>
                        </div>
                        <div className='flex items-center'>
                          <span className='text-gray-400'>Miner:</span>
                          <div className='ml-2'>
                          {(() => {
                              const minerInfo = getMinerDisplayInfo(result.data.miner || '');
                              return (
                                <Link
                                  href={`/address/${minerInfo.address}`}
                                  className='text-blue-400 hover:text-blue-300 transition-colors hover:underline'
                                >
                                  {minerInfo.name}
                                </Link>
                              );
                          })()}
                          </div>
                        </div>
                        <div className='flex items-center'>
                          <ClockIcon className='w-4 h-4 text-gray-400 mr-2' />
                          <span className='text-gray-400'>
                            {result.data.timestamp ? new Date(result.data.timestamp).toLocaleString(undefined, { timeZoneName: 'short' }) : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {result.type === 'transaction' && (
                    <div>
                      <div className='flex items-center justify-between mb-2'>
                        <span className='text-sm text-green-400 font-medium'>Transaction</span>
                        <Link
                          href={`/tx/${result.data.hash}`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View Details →
                        </Link>
                      </div>
                      <h3 className='text-lg font-bold text-gray-100 mb-2'>
                        <Link
                          href={`/tx/${result.data.hash}`}
                          className='font-mono text-green-400 hover:text-green-300 transition-colors hover:underline'
                          title={String(result.data.hash)}
                        >
                          {String(result.data.hash).slice(0, 16)}...{String(result.data.hash).slice(-16)}
                        </Link>
                      </h3>
                      <div className='grid grid-cols-1 md:grid-cols-2 gap-4 text-sm'>
                        <div>
                          <span className='text-gray-400'>From:</span>
                          <Link
                            href={`/address/${result.data.from}`}
                            className='font-mono text-blue-400 hover:text-blue-300 ml-2 transition-colors hover:underline'
                          >
                            {String(result.data.from)}
                          </Link>
                        </div>
                        <div>
                          <span className='text-gray-400'>To:</span>
                          <Link
                            href={`/address/${result.data.to}`}
                            className='font-mono text-blue-400 hover:text-blue-300 ml-2 transition-colors hover:underline'
                          >
                            {String(result.data.to)}
                          </Link>
                        </div>
                        <div className='flex items-center'>
                          <CurrencyDollarIcon className='w-4 h-4 text-gray-400 mr-2' />
                          <span className='text-gray-400'>
                            Value: <span className='text-green-400'>{result.data.value || '0'} {getCurrencySymbol()}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {result.type === 'address' && (
                    <div>
                      <div className='flex items-center justify-between mb-2'>
                        <span className='text-sm text-purple-400 font-medium'>Address</span>
                        <Link
                          href={`/address/${result.data.address}`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View Details →
                        </Link>
                      </div>
                      <h3 className='text-lg font-bold text-gray-100 mb-2 flex items-center gap-2'>
                        <UserIcon className='w-5 h-5 text-purple-400 mr-2' />
                        <Link
                          href={`/address/${result.data.address}`}
                          className='font-mono text-purple-400 hover:text-purple-300 transition-colors hover:underline'
                          title={String(result.data.address)}
                        >
                          {String(result.data.address)}
                        </Link>
                      </h3>
                      <div className='text-sm'>
                        <span className='text-gray-400'>Balance:</span>
                        <span className='text-green-400 ml-2'>{result.data.balance || '0'} {getCurrencySymbol()}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : query && !loading ? (
            <div className='text-center py-8'>
              <MagnifyingGlassIcon className='w-16 h-16 text-gray-500 mx-auto mb-4' />
              <p className='text-gray-400 text-lg mb-2'>No results found</p>
              <p className='text-gray-500 text-sm'>
                Try searching with a different block number, hash, or address.
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}