'use client';

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowsRightLeftIcon,
  CircleStackIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';

// Loading component
function LoadingSkeleton() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-gray-800/90 rounded-3xl p-6 shadow-xl border border-gray-700/50 animate-pulse">
        <div className="h-8 bg-gray-700 rounded mb-6 w-24"></div>
        <div className="space-y-4">
          <div className="h-24 bg-gray-700 rounded-xl"></div>
          <div className="h-24 bg-gray-700 rounded-xl"></div>
        </div>
        <div className="h-14 bg-gray-700 rounded-xl mt-6"></div>
      </div>
    </div>
  );
}

function ChartLoadingSkeleton() {
  return (
    <div className="bg-gray-900/90 rounded-3xl border border-gray-700/50 overflow-hidden animate-pulse">
      <div className="p-4 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="h-10 bg-gray-700 rounded-xl w-32"></div>
          <div className="h-8 bg-gray-700 rounded w-24"></div>
        </div>
        <div className="flex gap-2 mt-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-700 rounded-lg w-12"></div>
          ))}
        </div>
      </div>
      <div className="h-[400px] bg-gray-800/50"></div>
    </div>
  );
}

// Dynamic imports for SSR compatibility
const DexWrapper = dynamic(() => import('./components/DexWrapper').then((mod) => mod.DexWrapper), {
  ssr: false,
  loading: () => null,
});

const SwapContent = dynamic(
  () => import('./components/SwapContent').then((mod) => mod.SwapContent),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const PoolContent = dynamic(
  () => import('./components/PoolContent').then((mod) => mod.PoolContent),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const FarmContent = dynamic(() => import('./components/FarmContent'), {
  ssr: false,
  loading: () => <LoadingSkeleton />,
});

const TradingChart = dynamic(() => import('./components/TradingChart'), {
  ssr: false,
  loading: () => <ChartLoadingSkeleton />,
});

type Tab = 'swap' | 'pool' | 'farm';

function TabNavigation({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'swap',
      label: 'Swap',
      icon: <ArrowsRightLeftIcon className="w-5 h-5" />,
    },
    {
      id: 'pool',
      label: 'Pool',
      icon: <CircleStackIcon className="w-5 h-5" />,
    },
    {
      id: 'farm',
      label: 'Farm',
      icon: <CurrencyDollarIcon className="w-5 h-5" />,
    },
  ];

  return (
    <div className="max-w-lg mx-auto mb-6">
      <div className="flex bg-gray-800/90 rounded-2xl p-1.5 border border-gray-700/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DexPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab') as Tab | null;
  const tokenParam = searchParams.get('token');
  const tokenAParam = searchParams.get('tokenA');
  const tokenBParam = searchParams.get('tokenB');
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    tabParam && ['swap', 'pool', 'farm'].includes(tabParam) ? tabParam : 'swap'
  );
  const [showChart, setShowChart] = useState(true);
  const [nativePrice, setNativePrice] = useState<number | null>(null);
  const [nativeSymbol, setNativeSymbol] = useState<string>('');

  // Fetch native token price from external API
  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch('/api/dex/external-price');
        const data = await res.json();
        if (data.success && data.data) {
          setNativePrice(data.data.nativePriceUsd);
          setNativeSymbol(data.data.nativeSymbol);
        }
      } catch (error) {
        console.error('Failed to fetch native price:', error);
      }
    }
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  // Derive currentSwapTokens directly from URL params using useMemo
  const currentSwapTokens = useMemo(() => {
    return { from: fromParam, to: toParam };
  }, [fromParam, toParam]);

  // Callback when swap tokens change - updates URL params
  const handleSwapTokensChange = useCallback(
    (tokenIn: string | null, tokenOut: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tokenIn) {
        params.set('from', tokenIn);
      } else {
        params.delete('from');
      }
      if (tokenOut) {
        params.set('to', tokenOut);
      } else {
        params.delete('to');
      }
      router.replace(`/dex?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  useEffect(() => {
    if (tabParam && ['swap', 'pool', 'farm'].includes(tabParam) && tabParam !== activeTab) {
      requestAnimationFrame(() => setActiveTab(tabParam));
    }
  }, [tabParam, activeTab]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    router.push(`/dex?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-900/50 to-emerald-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-500/20 rounded-xl">
                <svg
                  className="w-8 h-8 text-green-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 3h5v5" />
                  <path d="M8 3H3v5" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 3l7 7" />
                  <path d="M16 21h5v-5" />
                  <path d="M8 21H3v-5" />
                  <path d="M21 21l-7-7" />
                  <path d="M3 21l7-7" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">VirBiCoin DEX</h1>
                <p className="text-gray-400 mt-1">
                  Swap tokens, provide liquidity, and earn rewards
                </p>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-2 bg-gray-800/50 rounded-xl p-1">
              {nativePrice !== null && nativeSymbol && (
                <div className="px-3 py-2 text-sm">
                  <span className="text-gray-400">{nativeSymbol} </span>
                  <span className="text-green-400 font-semibold">${nativePrice.toFixed(6)}</span>
                </div>
              )}
              <Link
                href="/dex"
                className="px-4 py-2 text-sm font-medium bg-green-500/20 text-green-400 rounded-lg"
              >
                Trade
              </Link>
              <Link
                href="/dex/pools"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Pools
              </Link>
              <Link
                href="/dex/analytics"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Analytics
              </Link>
              <Link
                href="/dex/docs"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Docs
              </Link>
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

        <Suspense fallback={<LoadingSkeleton />}>
          <DexWrapper>
            {/* Chart + Swap Layout */}
            {activeTab === 'swap' && (
              <div className="max-w-7xl mx-auto">
                {/* Chart Toggle Button */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowChart(!showChart)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
                      />
                    </svg>
                    {showChart ? 'Hide Chart' : 'Show Chart'}
                  </button>
                </div>

                <div className={`grid gap-6 ${showChart ? 'lg:grid-cols-[1fr,400px]' : ''}`}>
                  {/* Trading Chart */}
                  {showChart && (
                    <div className="order-2 lg:order-1">
                      <TradingChart
                        tokenInAddress={currentSwapTokens.from}
                        tokenOutAddress={currentSwapTokens.to}
                        nativePriceUsd={nativePrice}
                        nativeSymbol={nativeSymbol}
                      />
                    </div>
                  )}

                  {/* Swap Interface */}
                  <div
                    className={`order-1 lg:order-2 ${!showChart ? 'max-w-lg mx-auto w-full' : ''}`}
                  >
                    <SwapContent
                      initialFrom={fromParam}
                      initialTo={toParam}
                      onTokensChange={handleSwapTokensChange}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'pool' && (
              <PoolContent
                initialTokenAddress={tokenParam}
                initialTokenA={tokenAParam}
                initialTokenB={tokenBParam}
              />
            )}
            {activeTab === 'farm' && <FarmContent />}
          </DexWrapper>
        </Suspense>
      </div>
    </div>
  );
}

export default function DexPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <DexPageContent />
    </Suspense>
  );
}
