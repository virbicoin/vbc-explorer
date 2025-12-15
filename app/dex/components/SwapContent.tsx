'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { type Address, parseUnits } from 'viem';
import { TokenInput, SlippageSettings, SwapInfo } from './index';
import {
  type Token,
  VBC_TOKEN,
  DEFAULT_TOKENS,
  DEFAULT_SLIPPAGE,
  DEX_CONTRACTS,
} from '@/lib/dex/config';
import {
  useSwapQuote,
  useSwap,
  useApproveToken,
  useTokenAllowance,
  isNativeToken,
  getTokenAddress,
  formatTokenAmount,
  parseTokenAmount,
  calculateMinAmount,
  calculatePriceImpact,
  useReserves,
} from '@/lib/dex/hooks';
import { useDexTokens } from '@/hooks/useDexTokens';

export function SwapContent() {
  const { address, isConnected } = useAccount();
  
  // Fetch tokens from API
  const { tokens: availableTokens, isLoading: isTokensLoading } = useDexTokens();
  
  // State
  const [tokenIn, setTokenIn] = useState<Token>(VBC_TOKEN);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  
  // Set default tokenOut when tokens are loaded
  useEffect(() => {
    if (availableTokens.length > 2 && !tokenOut) {
      // Find a non-VBC/WVBC token for default output
      const defaultOut = availableTokens.find(t => 
        t.symbol !== 'VBC' && t.symbol !== 'WVBC'
      );
      setTokenOut(defaultOut || availableTokens[1]);
    } else if (availableTokens.length > 0 && !tokenOut) {
      setTokenOut(availableTokens.length > 1 ? availableTokens[1] : availableTokens[0]);
    }
  }, [availableTokens, tokenOut]);
  
  // Build swap path
  const swapPath = useMemo((): Address[] => {
    if (!tokenOut) return [];
    const fromAddress = getTokenAddress(tokenIn);
    const toAddress = getTokenAddress(tokenOut);
    return [fromAddress, toAddress];
  }, [tokenIn, tokenOut]);

  // Get quote
  const amountInParsed = useMemo(() => {
    return parseTokenAmount(amountIn, tokenIn.decimals);
  }, [amountIn, tokenIn.decimals]);

  const { data: quoteData, isLoading: isQuoteLoading } = useSwapQuote(amountInParsed, swapPath);
  
  const amountOut = useMemo(() => {
    if (quoteData && quoteData.length > 1) {
      return quoteData[quoteData.length - 1];
    }
    return 0n;
  }, [quoteData]);

  // Get reserves for price impact calculation
  const { data: reserves } = useReserves(swapPath[0], swapPath[1]);
  
  const priceImpact = useMemo(() => {
    if (reserves && amountInParsed > 0n && amountOut > 0n) {
      return calculatePriceImpact(
        amountInParsed,
        amountOut,
        reserves[0],
        reserves[1]
      );
    }
    return 0;
  }, [amountInParsed, amountOut, reserves]);

  // Calculate minimum output with slippage
  const minAmountOut = useMemo(() => {
    return calculateMinAmount(amountOut, slippage);
  }, [amountOut, slippage]);

  // Check allowance
  const { data: allowance } = useTokenAllowance(
    tokenIn.address as Address,
    address,
    DEX_CONTRACTS.router
  );
  
  const needsApproval = useMemo(() => {
    if (isNativeToken(tokenIn)) return false;
    if (!allowance) return true;
    return (allowance as bigint) < amountInParsed;
  }, [tokenIn, allowance, amountInParsed]);

  // Approve hook
  const {
    approve,
    isPending: isApproving,
    isConfirming: isApproveConfirming,
    isSuccess: isApproveSuccess,
  } = useApproveToken();

  // Swap hook
  const {
    swapVBCForTokens,
    swapTokensForVBC,
    swapTokensForTokens,
    isPending: isSwapping,
    isConfirming: isSwapConfirming,
    isSuccess: isSwapSuccess,
    error: swapError,
    hash: swapHash,
  } = useSwap();

  // Handle swap
  const handleSwap = useCallback(async () => {
    if (!address || amountInParsed === 0n || !tokenOut) return;

    try {
      if (isNativeToken(tokenIn)) {
        // VBC -> Token
        await swapVBCForTokens(amountInParsed, minAmountOut, swapPath, address);
      } else if (isNativeToken(tokenOut)) {
        // Token -> VBC
        await swapTokensForVBC(amountInParsed, minAmountOut, swapPath, address);
      } else {
        // Token -> Token
        await swapTokensForTokens(amountInParsed, minAmountOut, swapPath, address);
      }
    } catch (error) {
      console.error('Swap error:', error);
    }
  }, [address, amountInParsed, minAmountOut, swapPath, tokenIn, tokenOut, swapVBCForTokens, swapTokensForVBC, swapTokensForTokens]);

  // Handle approve
  const handleApprove = useCallback(async () => {
    if (!address) return;
    try {
      await approve(tokenIn.address as Address, DEX_CONTRACTS.router, amountInParsed);
    } catch (error) {
      console.error('Approve error:', error);
    }
  }, [approve, tokenIn.address, address, amountInParsed]);

  // Swap tokens in/out
  const handleSwapDirection = () => {
    if (!tokenOut) return;
    const tempToken = tokenIn;
    const tempAmount = amountIn;
    setTokenIn(tokenOut);
    setTokenOut(tempToken);
    setAmountIn(amountOut > 0n ? formatTokenAmount(amountOut, tokenOut.decimals, 18) : '');
  };

  // Clear amounts on success
  useEffect(() => {
    if (isSwapSuccess) {
      setAmountIn('');
    }
  }, [isSwapSuccess]);

  // Calculate rate
  const rate = useMemo(() => {
    if (amountInParsed > 0n && amountOut > 0n && tokenOut) {
      const rateValue = Number(amountOut) / Number(amountInParsed);
      return `1 ${tokenIn.symbol} = ${rateValue.toFixed(6)} ${tokenOut.symbol}`;
    }
    return undefined;
  }, [amountInParsed, amountOut, tokenIn.symbol, tokenOut]);

  // Button state
  const buttonState = useMemo(() => {
    if (!isConnected) return { text: 'Connect Wallet', disabled: true };
    if (!amountIn || amountInParsed === 0n) return { text: 'Enter Amount', disabled: true };
    if (isQuoteLoading) return { text: 'Loading...', disabled: true };
    if (amountOut === 0n) return { text: 'Insufficient Liquidity', disabled: true };
    if (needsApproval) {
      if (isApproving || isApproveConfirming) return { text: 'Approving...', disabled: true };
      return { text: `Approve ${tokenIn.symbol}`, disabled: false, action: 'approve' };
    }
    if (isSwapping || isSwapConfirming) return { text: 'Swapping...', disabled: true };
    if (priceImpact > 15) return { text: 'Price Impact Too High', disabled: true };
    return { text: 'Swap', disabled: false, action: 'swap' };
  }, [isConnected, amountIn, amountInParsed, isQuoteLoading, amountOut, needsApproval, isApproving, isApproveConfirming, isSwapping, isSwapConfirming, priceImpact, tokenIn.symbol]);

  const handleButtonClick = () => {
    if (buttonState.action === 'approve') {
      handleApprove();
    } else if (buttonState.action === 'swap') {
      handleSwap();
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Main Swap Card */}
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-gray-700/50 relative overflow-hidden">
        {/* Background Glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 relative">
          <div>
            <h1 className="text-2xl font-bold text-white">Swap</h1>
            <p className="text-sm text-gray-400 mt-1">Trade tokens instantly</p>
          </div>
          <SlippageSettings slippage={slippage} onSlippageChange={setSlippage} />
        </div>

        {/* Token Inputs */}
        <div className="space-y-2 relative">
          <TokenInput
            label="You Pay"
            token={tokenIn}
            amount={amountIn}
            onAmountChange={setAmountIn}
            onTokenChange={setTokenIn}
            otherToken={tokenOut || undefined}
            tokens={availableTokens}
          />

          {/* Swap Direction Button */}
          <div className="flex justify-center -my-5 relative z-10">
            <button
              onClick={handleSwapDirection}
              className="bg-gray-700 hover:bg-gray-600 p-3 rounded-xl border-4 border-gray-900 transition-all hover:scale-110 hover:rotate-180 duration-300 shadow-lg group"
              disabled={!tokenOut}
            >
              <svg className="w-5 h-5 text-gray-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {tokenOut && (
            <TokenInput
              label="You Receive"
              token={tokenOut}
              amount={amountOut > 0n ? formatTokenAmount(amountOut, tokenOut.decimals) : ''}
              onAmountChange={() => {}}
              onTokenChange={setTokenOut}
              otherToken={tokenIn}
              tokens={availableTokens}
              readOnly
            />
          )}
        </div>

        {/* Swap Info */}
        {amountIn && amountOut > 0n && tokenOut && (
          <div className="mt-4">
            <SwapInfo
              rate={rate}
              priceImpact={priceImpact}
              minimumReceived={minAmountOut}
              tokenSymbol={tokenOut.symbol}
              fee="0.3%"
            />
          </div>
        )}

        {/* Price Impact Warning */}
        {priceImpact > 5 && (
          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-yellow-400 font-semibold text-sm">High Price Impact</p>
              <p className="text-yellow-500/80 text-xs mt-1">You may receive significantly less than expected due to low liquidity.</p>
            </div>
          </div>
        )}

        {/* Swap Button */}
        <button
          onClick={handleButtonClick}
          disabled={buttonState.disabled}
          className={`w-full mt-6 py-4 rounded-2xl font-bold text-lg transition-all relative overflow-hidden ${
            buttonState.disabled
              ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
              : priceImpact > 5
              ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40'
              : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02]'
          }`}
        >
          {(isSwapping || isSwapConfirming || isApproving || isApproveConfirming) && (
            <span className="absolute inset-0 flex items-center justify-center">
              <svg className="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </span>
          )}
          <span className={isSwapping || isSwapConfirming || isApproving || isApproveConfirming ? 'opacity-0' : ''}>
            {buttonState.text}
          </span>
        </button>

        {/* Transaction Status */}
        {isSwapSuccess && swapHash && (
          <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-green-400 font-semibold">Swap Successful!</p>
              <a
                href={`/tx/${swapHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-500/80 text-sm hover:text-green-400 flex items-center gap-1 mt-1"
              >
                View transaction
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        )}

        {swapError && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-red-400 font-semibold">Transaction Failed</p>
              <p className="text-red-500/80 text-sm mt-1">{swapError.message}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
