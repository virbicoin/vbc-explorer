'use client';
import Link from 'next/link';
import { CubeTransparentIcon, CheckCircleIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { getCurrencyName, getCurrencySymbol } from '../../lib/client-config';
import { initializeCurrency } from '../../lib/bigint-utils';

type Token = {
  symbol: string;
  name: string;
  address: string;
  holders: number;
  supply: string;
  type: string;
  verified?: boolean;
};

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [currencyName, setCurrencyName] = useState<string>('');
  const [currencySymbol, setCurrencySymbol] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'all' | 'nft'>('all');
  const [vbcSupply, setVbcSupply] = useState<string>('0');

  // Fetch VBC total supply from richlist API
  const fetchVBCSupply = async () => {
    try {
      const res = await fetch('/api/richlist?page=1&limit=1');
      if (res.ok) {
        const data = await res.json();
        const totalSupply = data.statistics?.totalSupply || 0;
        // Convert from Wei to VBC and format
        const vbcSupply = (totalSupply / 1e18).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        });
        setVbcSupply(vbcSupply);
      }
    } catch (error) {
      console.error('Error fetching VBC supply:', error);
      setVbcSupply('0');
    }
  };

  useEffect(() => {
    async function fetchTokens() {
      try {
        // Initialize currency conversion factors
        await initializeCurrency();
        
        // Load config values
        const [name, symbol] = await Promise.all([
          getCurrencyName(),
          getCurrencySymbol()
        ]);
        setCurrencyName(name);
        setCurrencySymbol(symbol);
        
        const res = await fetch('/api/tokens');
        if (!res.ok) throw new Error('Failed to fetch tokens');
        const data = await res.json();
        // トークンを新しい順（降順）にソート
        const sortedTokens = (data.tokens || []).sort((a: Token, b: Token) => {
          // Nativeトークン（VBC）は最も古いので最後に表示
          if (a.type === 'Native') return 1;
          if (b.type === 'Native') return -1;
          
          // その他のトークンはアドレスでソート（新しい順）
          return b.address.localeCompare(a.address);
        });
        setTokens(sortedTokens);
      } catch {
        setTokens([]);
      } finally {
        setLoading(false);
      }
    }
    fetchTokens();
    
    // VBC supplyをリッチリストAPIから取得
    fetchVBCSupply();
  }, []);

  // Filter tokens based on active tab
  const filteredTokens = activeTab === 'nft' 
    ? tokens.filter(token => 
        (token.type === 'VRC-721' || token.type === 'VRC-1155') &&
        (token.holders > 0 || (token.supply && token.supply !== '0' && token.supply !== ''))
      )
    : tokens.filter(token => 
        token.type === 'Native' || token.type === 'VRC-20'
      );

  return (
    <div className='min-h-screen bg-gray-900 text-white'>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <CubeTransparentIcon className='w-8 h-8 text-purple-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Tokens & NFTs</h1>
          </div>
          <p className='text-gray-400'>Explore tokens and NFT collections on the {currencyName} network</p>
        </div>
      </div>

      <main className='container mx-auto px-4 py-8'>
        {/* Summary Stats */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-6'>
          <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
            <h3 className='text-sm font-medium text-gray-300 mb-2'>Total Tokens</h3>
            <p className='text-2xl font-bold text-blue-400'>{loading ? '-' : tokens.length}</p>
            <p className='text-xs text-gray-400'>Contracts deployed</p>
          </div>
          <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
            <h3 className='text-sm font-medium text-gray-300 mb-2'>NFT Collections</h3>
            <p className='text-2xl font-bold text-purple-400'>{loading ? '-' : tokens.filter(t => t.type === 'VRC-721' || t.type === 'VRC-1155').length}</p>
            <p className='text-xs text-gray-400'>NFT contracts</p>
          </div>
          <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
            <h3 className='text-sm font-medium text-gray-300 mb-2'>Total Holders</h3>
            <p className='text-2xl font-bold text-yellow-400'>{loading ? '-' : tokens.reduce((sum, token) => sum + (token.holders || 0), 0).toLocaleString()}</p>
            <p className='text-xs text-gray-400'>Unique addresses</p>
          </div>
          <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
            <h3 className='text-sm font-medium text-gray-300 mb-2'>Contract Types</h3>
            <p className='text-2xl font-bold text-orange-400'>{loading ? '-' : new Set(tokens.map(t => t.type)).size}</p>
            <p className='text-xs text-gray-400'>Different standards</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6'>
          <div className='flex items-center gap-4 mb-6'>
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <CubeTransparentIcon className='w-4 h-4' />
              VRC-20 Tokens
            </button>
            <button
              onClick={() => setActiveTab('nft')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'nft'
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <PhotoIcon className='w-4 h-4' />
              NFT Collections
            </button>
          </div>

          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead>
                <tr className='border-b border-gray-700'>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-300'>Token</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-300'>Type</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-300'>Contract Address</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-300 w-32'>Verify</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-300'>Holders</th>
                  <th className='text-left py-3 px-4 text-sm font-medium text-gray-300'>Total Supply</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-700'>
                {loading ? (
                  <tr>
                    <td colSpan={6} className='py-12'>
                      <div className='flex justify-center items-center'>
                        <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500'></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredTokens.length === 0 ? (
                  <tr>
                    <td colSpan={6} className='py-6 text-center text-gray-400'>
                      {activeTab === 'nft' ? 'No NFT collections found' : 'No tokens found'}
                    </td>
                  </tr>
                ) : (
                  filteredTokens.map((token, index) => (
                    <tr key={`${token.address}-${index}`} className='hover:bg-gray-700/50 transition-colors'>
                      <td className='py-3 px-4'>
                        <div>
                          <div className='font-bold text-gray-200'>{token.symbol}</div>
                          <div className='text-sm text-gray-400'>{token.name}</div>
                        </div>
                      </td>
                      <td className='py-3 px-4'>
                        <span className={`px-3 py-1 rounded text-sm font-medium ${
                          token.type === 'Native' ?
                            'bg-cyan-500/20 text-cyan-400' :
                            token.type === 'VRC-20' ?
                              'bg-blue-500/20 text-blue-400' :
                            token.type === 'VRC-721' ?
                              'bg-purple-500/20 text-purple-400' :
                            token.type === 'VRC-1155' ?
                              'bg-orange-500/20 text-orange-400' :
                              'bg-gray-500/20 text-gray-400'
                        }`}>
                          {token.type}
                        </span>
                      </td>
                      <td className='py-3 px-4'>
                        <div className='flex items-center gap-2'>
                          {token.type === 'Native' ? (
                            <span className='font-mono text-gray-400 break-all'>N/A</span>
                          ) : token.address === 'N/A' ? (
                            <span className='font-mono text-gray-400 break-all'>N/A</span>
                          ) : (
                            <Link
                              href={`/token/${token.address}`}
                              className='font-mono text-blue-400 hover:text-blue-300 transition-colors break-all'
                            >
                              {token.address}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className='py-3 px-4 w-32'>
                        {token.type !== 'Native' && token.verified ? (
                          <span className='flex items-center gap-1 px-3 py-1 bg-green-500/20 text-green-400 rounded text-sm font-medium w-fit'>
                            <CheckCircleIcon className='w-4 h-4' />
                            <span>Verified</span>
                          </span>
                        ) : (
                          <span className='text-gray-400 text-xs'>-</span>
                        )}
                      </td>
                      <td className='py-3 px-4'>
                        <span className='text-yellow-400 text-lg font-bold'>{token.holders?.toLocaleString?.() ?? '-'}</span>
                      </td>
                      <td className='py-3 px-4'>
                        <span className='text-green-400 text-lg font-bold'>
                          {token.type === 'Native' ? `${vbcSupply} ${currencySymbol}` : (token.supply ? `${token.supply} ${token.symbol}` : '-')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}