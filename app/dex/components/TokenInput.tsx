'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { type Token, VBC_TOKEN } from '@/lib/dex/config';
import { useVBCBalance, useTokenBalance, formatTokenAmount, isNativeToken } from '@/lib/dex/hooks';
import { TokenSelector } from './TokenSelector';
import type { Address } from 'viem';

interface TokenInputProps {
  label: string;
  token: Token;
  amount: string;
  onAmountChange: (amount: string) => void;
  onTokenChange: (token: Token) => void;
  otherToken?: Token;
  readOnly?: boolean;
  showBalance?: boolean;
}

export function TokenInput({
  label,
  token,
  amount,
  onAmountChange,
  onTokenChange,
  otherToken,
  readOnly = false,
  showBalance = true,
}: TokenInputProps) {
  const { address } = useAccount();
  
  const { data: vbcBalance } = useVBCBalance(address);
  const { data: tokenBalance } = useTokenBalance(
    token.address as Address,
    address
  );

  const balance = isNativeToken(token)
    ? vbcBalance?.value
    : (tokenBalance as bigint | undefined);

  const handleMax = () => {
    if (balance) {
      // Leave some gas for native token
      const maxAmount = isNativeToken(token) 
        ? (balance > 100000000000000000n ? balance - 100000000000000000n : 0n) // Leave 0.1 VBC for gas
        : balance;
      onAmountChange(formatTokenAmount(maxAmount, token.decimals, 18));
    }
  };

  const handleHalf = () => {
    if (balance) {
      const halfAmount = balance / 2n;
      onAmountChange(formatTokenAmount(halfAmount, token.decimals, 18));
    }
  };

  // Calculate USD value (placeholder)
  const usdValue = amount ? `≈ $${(parseFloat(amount || '0') * 0.001).toFixed(2)}` : '';

  return (
    <div className={`relative bg-gradient-to-br ${readOnly ? 'from-gray-800/80 to-gray-900/80' : 'from-gray-800 to-gray-850'} rounded-2xl p-5 border ${readOnly ? 'border-gray-700/50' : 'border-gray-700 hover:border-gray-600'} transition-all`}>
      {/* Label & Balance */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-medium text-gray-400">{label}</span>
        {showBalance && address && balance !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              Balance: <span className="text-gray-300 font-medium">{formatTokenAmount(balance, token.decimals)}</span>
            </span>
            {!readOnly && (
              <div className="flex gap-1">
                <button
                  onClick={handleHalf}
                  className="px-2 py-0.5 text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors"
                >
                  HALF
                </button>
                <button
                  onClick={handleMax}
                  className="px-2 py-0.5 text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors"
                >
                  MAX
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Input & Token Selector */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const value = e.target.value;
              // Allow only numbers and decimals
              if (/^[0-9]*\.?[0-9]*$/.test(value)) {
                onAmountChange(value);
              }
            }}
            placeholder="0.0"
            readOnly={readOnly}
            className={`w-full bg-transparent text-3xl font-bold outline-none placeholder-gray-600 ${
              readOnly ? 'text-gray-400 cursor-not-allowed' : 'text-white'
            }`}
          />
          {amount && parseFloat(amount) > 0 && (
            <div className="text-sm text-gray-500 mt-1">{usdValue}</div>
          )}
        </div>
        <TokenSelector
          selectedToken={token}
          onSelect={onTokenChange}
          otherToken={otherToken}
        />
      </div>
    </div>
  );
}
