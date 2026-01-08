'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { type Token, DEFAULT_TOKENS } from '@/lib/dex/config';
import { useTokenConfig } from '@/hooks/useTokenConfig';
import { isValidImageUrl } from '@/lib/security/validation';

interface TokenSelectorProps {
  selectedToken: Token;
  onSelect: (token: Token) => void;
  otherToken?: Token;
  tokens?: Token[];
}

// Default color for unknown tokens
const DEFAULT_COLOR = 'from-gray-500 to-gray-600';

// Token Icon Component
function TokenIcon({
  token,
  size = 28,
  getIcon,
  getColor,
}: {
  token: Token;
  size?: number;
  getIcon: (symbol: string) => string | null;
  getColor: (symbol: string) => string;
}) {
  const iconPath = getIcon(token.symbol);
  const color = getColor(token.symbol) || DEFAULT_COLOR;

  // Priority: 1. Config icon, 2. logoURI from database (with security validation)
  if (iconPath) {
    return (
      <div
        className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center shadow-md overflow-hidden`}
        style={{ width: size, height: size }}
      >
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

  // Use logoURI from database (e.g., Launchpad tokens) - validate URL for security
  if (token.logoURI && isValidImageUrl(token.logoURI)) {
    return (
      <div
        className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center shadow-md overflow-hidden`}
        style={{ width: size, height: size }}
      >
        <Image
          src={token.logoURI}
          alt={token.symbol}
          width={size - 4}
          height={size - 4}
          className="object-contain"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center shadow-md`}
      style={{ width: size, height: size }}
    >
      <span className="font-bold text-white" style={{ fontSize: size * 0.4 }}>
        {token.symbol.charAt(0)}
      </span>
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
  const { getTokenIcon, getTokenColor } = useTokenConfig();

  const handleSelect = useCallback(
    (token: Token) => {
      onSelect(token);
      setIsOpen(false);
      setSearchQuery('');
    },
    [onSelect]
  );

  // Check if native token - uses zero address
  const isNativeTokenAddress = (address: string): boolean => {
    return address === '0x0000000000000000000000000000000000000000';
  };

  const availableTokens = tokens.filter((t) => {
    // Exclude the exact same token (by address)
    if (t.address === otherToken?.address) return false;

    // If other token is native, exclude wrapped native - they represent the same value
    // Native token has zero address, wrapped native has a real address but symbol starts with 'W'
    if (otherToken && isNativeTokenAddress(otherToken.address)) {
      // Get wrapped native symbol (assuming it's 'W' + native symbol)
      const wrappedSymbol = 'W' + otherToken.symbol;
      if (t.symbol === wrappedSymbol) return false;
    }

    // If other token is wrapped native, exclude native
    if (otherToken && otherToken.symbol.startsWith('W') && isNativeTokenAddress(t.address)) {
      const nativeSymbol = otherToken.symbol.substring(1);
      if (t.symbol === nativeSymbol) return false;
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
        <TokenIcon
          token={selectedToken}
          size={28}
          getIcon={getTokenIcon}
          getColor={getTokenColor}
        />
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
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-gray-700">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
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
                <div className="text-center py-8 text-gray-400">No tokens found</div>
              ) : (
                availableTokens.map((token) => (
                  <button
                    key={token.address}
                    onClick={() => handleSelect(token)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-700/50 transition-all ${
                      selectedToken.address === token.address
                        ? 'bg-gray-700/50 ring-1 ring-blue-500/50'
                        : ''
                    }`}
                  >
                    <TokenIcon
                      token={token}
                      size={36}
                      getIcon={getTokenIcon}
                      getColor={getTokenColor}
                    />
                    <div className="text-left flex-1">
                      <div className="font-semibold text-white">{token.symbol}</div>
                      <div className="text-xs text-gray-400">{token.name}</div>
                    </div>
                    {selectedToken.address === token.address && (
                      <svg
                        className="w-5 h-5 text-blue-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
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
