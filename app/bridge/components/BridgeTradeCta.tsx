'use client';

import { ArrowsRightLeftIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { useBridge } from './BridgeProvider';

// Optional call-to-action linking to an external DEX (e.g. PancakeSwap) where
// the wrapped token can be traded. Renders nothing unless remote.swapUrl is set,
// so it stays config-driven and generic across chains.
export function BridgeTradeCta() {
  const { route } = useBridge();
  const { remote } = route;
  if (!remote.swapUrl) return null;
  const dex = remote.dexName || 'an external DEX';

  return (
    <a
      href={remote.swapUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 to-purple-500/10 border border-amber-500/30 rounded-3xl p-6 hover:border-amber-400/60 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-300 shrink-0">
          <ArrowsRightLeftIcon className="w-6 h-6" />
        </div>
        <div>
          <div className="text-white font-bold">
            Trade {remote.wrappedSymbol} on {dex}
          </div>
          <div className="text-sm text-gray-400">
            Already bridged? Swap or provide liquidity for {remote.wrappedSymbol} on {remote.name}.
          </div>
        </div>
      </div>
      <span className="inline-flex items-center justify-center gap-2 bg-amber-500/90 group-hover:bg-amber-400 text-gray-900 font-bold rounded-xl px-5 py-3 whitespace-nowrap shrink-0">
        Open {dex}
        <ArrowTopRightOnSquareIcon className="w-5 h-5" />
      </span>
    </a>
  );
}
