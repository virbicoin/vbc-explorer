'use client';

import { useState } from 'react';
import { SLIPPAGE_OPTIONS, DEFAULT_SLIPPAGE } from '@/lib/dex/config';

interface SlippageSettingsProps {
  slippage: number;
  onSlippageChange: (slippage: number) => void;
}

export function SlippageSettings({ slippage, onSlippageChange }: SlippageSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customSlippage, setCustomSlippage] = useState('');

  const handleCustomSlippageChange = (value: string) => {
    setCustomSlippage(value);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0 && num <= 50) {
      onSlippageChange(Math.round(num * 100)); // Convert to basis points
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-700/50 hover:bg-gray-700 rounded-xl transition-all border border-gray-600/50 hover:border-gray-500"
      >
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-gray-300 font-medium">{(slippage / 100).toFixed(1)}%</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 bg-gray-800/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-700 p-5">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-semibold text-lg">Settings</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-300">Slippage Tolerance</span>
                  <span className="text-xs text-gray-500">Max price movement</span>
                </div>
                
                <div className="flex gap-2 mb-3">
                  {SLIPPAGE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        onSlippageChange(option);
                        setCustomSlippage('');
                      }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        slippage === option
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                          : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 border border-gray-600/50'
                      }`}
                    >
                      {(option / 100).toFixed(1)}%
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">Custom</span>
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={customSlippage}
                      onChange={(e) => handleCustomSlippageChange(e.target.value)}
                      placeholder="0.0"
                      className="w-full bg-gray-700/50 border border-gray-600 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors pr-8"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
                  </div>
                </div>
              </div>

              {slippage >= 500 && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-sm text-yellow-400">
                    High slippage may result in unfavorable trades
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
