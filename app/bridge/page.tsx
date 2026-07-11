'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

function LoadingSkeleton() {
  return (
    <div className="max-w-lg mx-auto animate-pulse">
      <div className="h-[420px] bg-gray-800/60 rounded-3xl border border-gray-700/50" />
    </div>
  );
}

// wagmi hooks are client-only, so load the app with ssr:false.
const BridgeApp = dynamic(() => import('./components/BridgeApp').then((m) => m.BridgeApp), {
  ssr: false,
  loading: () => <LoadingSkeleton />,
});

export default function BridgePage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/20 rounded-xl text-2xl">🌉</div>
            <div>
              <h1 className="text-3xl font-bold text-white">Bridge</h1>
              <p className="text-gray-400 mt-1">Move tokens 1:1 between chains</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-10">
        <Suspense fallback={<LoadingSkeleton />}>
          <BridgeApp />
        </Suspense>
      </div>
    </div>
  );
}
