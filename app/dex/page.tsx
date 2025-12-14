'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

// ローディングコンポーネント
function LoadingSkeleton() {
  return (
    <div className="max-w-md mx-auto">
      <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800 animate-pulse">
        <div className="h-8 bg-gray-800 rounded mb-6 w-24"></div>
        <div className="space-y-4">
          <div className="h-24 bg-gray-800 rounded-xl"></div>
          <div className="h-24 bg-gray-800 rounded-xl"></div>
        </div>
        <div className="h-14 bg-gray-800 rounded-xl mt-6"></div>
      </div>
    </div>
  );
}

// 動的インポートでSSRを無効化 - wagmi互換性問題を回避
const DexWrapper = dynamic(
  () => import('./components/DexWrapper').then((mod) => mod.DexWrapper),
  { ssr: false, loading: () => null }
);

const SwapContent = dynamic(
  () => import('./components/SwapContent').then((mod) => mod.SwapContent),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

export default function SwapPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <DexWrapper>
        <SwapContent />
      </DexWrapper>
    </Suspense>
  );
}
