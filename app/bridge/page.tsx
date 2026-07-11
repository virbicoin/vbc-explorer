'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-900 animate-pulse">
      <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="h-10 w-72 bg-gray-800 rounded-xl" />
          <div className="h-4 w-96 max-w-full bg-gray-800 rounded mt-3" />
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {['a', 'b', 'c', 'd'].map((k) => (
            <div key={k} className="h-28 bg-gray-800/60 rounded-2xl border border-gray-700/50" />
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="h-[420px] bg-gray-800/60 rounded-3xl border border-gray-700/50" />
          <div className="h-[420px] bg-gray-800/60 rounded-3xl border border-gray-700/50" />
        </div>
      </div>
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
    <Suspense fallback={<LoadingSkeleton />}>
      <BridgeApp />
    </Suspense>
  );
}
