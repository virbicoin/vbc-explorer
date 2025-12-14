'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { type Token, DEFAULT_TOKENS } from '@/lib/dex/config';

interface TokenSelectorProps {
  selectedToken: Token;
  onSelect: (token: Token) => void;
  otherToken?: Token;
  tokens?: Token[];
}

// Token colors based on symbol
const getTokenColor = (symbol: string): string => {
  const colors: Record<string, string> = {
    'VBC': 'from-green-500 to-emerald-600',
    'WVBC': 'from-green-400 to-teal-500',
    'TEST': 'from-purple-500 to-pink-500',
    'USDT': 'from-green-400 to-green-600',
    'USDC': 'from-blue-400 to-blue-600',
  };
  return colors[symbol] || 'from-gray-500 to-gray-600';
};

// Check if token has custom icon
const hasCustomIcon = (symbol: string): boolean => {
  return symbol === 'VBC' || symbol === 'WVBC';
};

// Get custom icon path
const getTokenIcon = (symbol: string): string | null => {
  if (symbol === 'VBC' || symbol === 'WVBC') {
    return '/img/VBC.svg';
  }
  return null;
};

// Token Icon Component
function TokenIcon({ token, size = 28 }: { token: Token; size?: number }) {
  const iconPath = getTokenIcon(token.symbol);
  
  if (iconPath) {
    return (
      <div className={`rounded-full bg-gradient-to-br ${getTokenColor(token.symbol)} flex items-center justify-center shadow-md overflow-hidden`} style={{ width: size, height: size }}>
        <Image 
          src={iconPath} 
          alt={token.symbol} 
          width={size - 4} 
          height={size - 4}
          className="object-contain"
        />
      </div>
    );
  }
  
  return (
    <div className={`rounded-full bg-gradient-to-br ${getTokenColor(token.symbol)} flex items-center justify-center shadow-md`} style={{ width: size, height: size }}>
      <span className="font-bold text-white" style={{ fontSize: size * 0.4 }}>{token.symbol.charAt(0)}</span>
    </div>
  );
}

export function TokenSelector({
  selectedToken,
  onSelect,
  otherToken,
  tokens = DEFAULT_TOKENS,
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelect = useCallback((token: Token) => {
    onSelect(token);
    setIsOpen(false);
    setSearchQuery('');
  }, [onSelect]);

  // Check if VBC or WVBC (they are equivalent and can't be swapped with each other)
  const isVBCOrWVBC = (symbol: string): boolean => {
    return symbol === 'VBC' || symbol === 'WVBC';
  };

  const availableTokens = tokens.filter(t => {
    // Exclude the same token
    if (t.address === otherToken?.address) return false;
    
    // If other token is VBC or WVBC, exclude both VBC and WVBC
    if (otherToken && isVBCOrWVBC(otherToken.symbol) && isVBCOrWVBC(t.symbol)) {
      return false;
    }
    
    // Search filter
    return (
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-3 bg-gray-700/80 hover:bg-gray-600/80 rounded-xl transition-all border border-gray-600 hover:border-gray-500 shadow-lg"
      >
        <TokenIcon token={selectedToken} size={28} />
        <span className="font-semibold text-white">{selectedToken.symbol}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 max-w-[90vw] bg-gray-800/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">Select Token</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Search */}
            <div className="p-3 border-b border-gray-700">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tokens..."
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-xl text-sm outline-none focus:border-blue-500 transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Token List */}
            <div className="max-h-72 overflow-y-auto p-2">
              {availableTokens.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No tokens found
                </div>
              ) : (
                availableTokens.map((token) => (
                  <button
                    key={token.address}
                    onClick={() => handleSelect(token)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-700/50 transition-all ${
                      selectedToken.address === token.address ? 'bg-gray-700/50 ring-1 ring-blue-500/50' : ''
                    }`}
                  >
                    <TokenIcon token={token} size={36} />
                    <div className="text-left flex-1">
                      <div className="font-semibold text-white">{token.symbol}</div>
                      <div className="text-xs text-gray-400">{token.name}</div>
                    </div>
                    {selectedToken.address === token.address && (
                      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
