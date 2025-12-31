'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

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
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
          />
        </svg>
      ),
    },
    {
      id: 'pool',
      label: 'Pool',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      id: 'farm',
      label: 'Farm',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
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
                ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg'
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
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    tabParam && ['swap', 'pool', 'farm'].includes(tabParam) ? tabParam : 'swap'
  );
  const [showChart, setShowChart] = useState(true);

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
    <>
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
                    <TradingChart />
                  </div>
                )}

                {/* Swap Interface */}
                <div
                  className={`order-1 lg:order-2 ${!showChart ? 'max-w-lg mx-auto w-full' : ''}`}
                >
                  <SwapContent />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pool' && <PoolContent initialTokenAddress={tokenParam} />}
          {activeTab === 'farm' && <FarmContent />}
        </DexWrapper>
      </Suspense>
    </>
  );
}

export default function DexPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <DexPageContent />
    </Suspense>
  );
}
