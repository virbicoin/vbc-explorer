'use client';

import { useState } from 'react';
import { formatTokenAmount } from '@/lib/dex/hooks';

interface SwapInfoProps {
  rate?: string;
  priceImpact?: number;
  minimumReceived?: bigint;
  tokenSymbol?: string;
  tokenDecimals?: number;
  fee?: string;
  route?: string[]; // e.g., ['TokenA', 'WrappedNative', 'TokenB']
}

export function SwapInfo({
  rate,
  priceImpact,
  minimumReceived,
  tokenSymbol,
  tokenDecimals = 18,
  fee,
  route,
}: SwapInfoProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!rate && priceImpact === undefined && !minimumReceived) {
    return null;
  }

  // Determine if this is a multi-hop swap
  const isMultiHop = route && route.length > 2;

  return (
    <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden">
      {/* Header - Clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm font-medium text-gray-300">Transaction Details</span>
        </div>
        <div className="flex items-center gap-3">
          {rate && <span className="text-sm text-gray-400">{rate}</span>}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-700/50 pt-3">
          {/* Route Display for Multi-hop Swaps */}
          {isMultiHop && route && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Route</span>
                <div className="group relative">
                  <svg
                    className="w-4 h-4 text-gray-500 cursor-help"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 rounded-lg text-xs text-gray-300 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all shadow-xl border border-gray-700">
                    This swap routes through multiple pools for the best rate.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {route.map((symbol, index) => (
                  <span key={index} className="flex items-center">
                    <span className="text-sm font-medium text-blue-400">{symbol}</span>
                    {index < route.length - 1 && (
                      <svg
                        className="w-4 h-4 text-gray-500 mx-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {priceImpact !== undefined && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Price Impact</span>
                <div className="group relative">
                  <svg
                    className="w-4 h-4 text-gray-500 cursor-help"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 rounded-lg text-xs text-gray-300 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all shadow-xl border border-gray-700">
                    The difference between the market price and estimated execution price.
                  </div>
                </div>
              </div>
              <span
                className={`text-sm font-semibold ${
                  priceImpact > 5
                    ? 'text-red-400'
                    : priceImpact > 3
                      ? 'text-yellow-400'
                      : 'text-green-400'
                }`}
              >
                {priceImpact < 0.01 ? '< 0.01' : priceImpact.toFixed(2)}%
              </span>
            </div>
          )}

          {minimumReceived !== undefined && tokenSymbol && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Minimum Received</span>
                <div className="group relative">
                  <svg
                    className="w-4 h-4 text-gray-500 cursor-help"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 rounded-lg text-xs text-gray-300 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all shadow-xl border border-gray-700">
                    Minimum amount you will receive after slippage.
                  </div>
                </div>
              </div>
              <span className="text-sm font-semibold text-white">
                {formatTokenAmount(minimumReceived, tokenDecimals)} {tokenSymbol}
              </span>
            </div>
          )}

          {fee && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">LP Fee</span>
                <div className="group relative">
                  <svg
                    className="w-4 h-4 text-gray-500 cursor-help"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 rounded-lg text-xs text-gray-300 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all shadow-xl border border-gray-700">
                    Fee paid to liquidity providers for each trade.
                    {isMultiHop && ' Multi-hop swaps incur fees on each hop.'}
                  </div>
                </div>
              </div>
              <span className="text-sm font-semibold text-white">
                {isMultiHop ? `${fee} × ${route!.length - 1}` : fee}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
