'use client';

import type { ReactNode } from 'react';
import { useBridgeConfig } from './BridgeProvider';
import { BridgeContent } from './BridgeContent';
import { BridgeStats } from './BridgeStats';
import { BridgeInfo } from './BridgeInfo';

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="bg-gray-800/60 border border-gray-700 rounded-full px-3 py-1 text-xs text-gray-300">
      {children}
    </span>
  );
}

export function BridgeShell() {
  const { source, remote } = useBridgeConfig();

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Hero */}
      <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/20 rounded-2xl text-3xl leading-none">🌉</div>
            <div className="min-w-0">
              <h1 className="text-3xl sm:text-4xl font-bold text-white">
                {source.nativeSymbol} <span className="text-purple-300">⇄</span>{' '}
                {remote.wrappedSymbol} Bridge
              </h1>
              <p className="text-gray-300 mt-1">
                Move {source.nativeSymbol} between {source.name} and {remote.name} — backed 1:1, gas
                only.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <Badge>🔒 Backed 1:1 by locked {source.nativeSymbol}</Badge>
            <Badge>✅ Multi-validator signatures</Badge>
            <Badge>
              ↔ {source.name} &amp; {remote.name}
            </Badge>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <BridgeStats />
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <BridgeContent />
          <BridgeInfo />
        </div>
      </div>
    </div>
  );
}
