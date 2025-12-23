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
const DexWrapper = dynamic(
  () => import('./components/DexWrapper').then((mod) => mod.DexWrapper),
  { ssr: false, loading: () => null }
);

const SwapContent = dynamic(
  () => import('./components/SwapContent').then((mod) => mod.SwapContent),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const PoolContent = dynamic(
  () => import('./components/PoolContent').then((mod) => mod.PoolContent),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const FarmContent = dynamic(
  () => import('./components/FarmContent'),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const TradingChart = dynamic(
  () => import('./components/TradingChart'),
  { ssr: false, loading: () => <ChartLoadingSkeleton /> }
);

type Tab = 'swap' | 'pool' | 'farm';

function TabNavigation({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode; highlight?: boolean }[] = [
    {
      id: 'swap',
      label: 'Swap',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      ),
    },
    {
      id: 'pool',
      label: 'Pool',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'farm',
      label: 'Farm',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
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
                <div className={`order-1 lg:order-2 ${!showChart ? 'max-w-lg mx-auto w-full' : ''}`}>
                  <SwapContent />
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'pool' && <PoolContent initialTokenAddress={tokenParam} />}
          {activeTab === 'farm' && <FarmContent />}
        </DexWrapper>
      </Suspense>

      {/* Info sections based on active tab */}
      {activeTab === 'swap' && <SwapInfo />}
      {activeTab === 'pool' && <PoolInfo />}
      {activeTab === 'farm' && <FarmInfo />}

      {/* Contract Addresses Section */}
      <ContractAddresses />
    </>
  );
}

function SwapInfo() {
  return (
    <>
      {/* How to Swap */}
      <div className="max-w-7xl mx-auto mt-12 px-4">
        <div className="max-w-lg mx-auto">
          <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
            <h3 className="font-bold text-xl text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              How to Swap
            </h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 text-blue-400 font-bold">1</div>
                <div>
                  <p className="font-semibold text-white">Connect Your Wallet</p>
                  <p className="text-gray-400 text-sm">Click the &quot;Connect Wallet&quot; button in the top right corner to connect MetaMask or another supported wallet.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 text-blue-400 font-bold">2</div>
                <div>
                  <p className="font-semibold text-white">Select Tokens & Enter Amount</p>
                  <p className="text-gray-400 text-sm">Choose the token you want to swap from (&quot;From&quot;) and the token you want to receive (&quot;To&quot;), then enter the amount.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 text-blue-400 font-bold">3</div>
                <div>
                  <p className="font-semibold text-white">Execute the Swap</p>
                  <p className="text-gray-400 text-sm">Click &quot;Swap&quot; and confirm the transaction in your wallet. That&apos;s it!</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* What is a DEX */}
      <div className="max-w-7xl mx-auto mt-6 px-4">
        <div className="max-w-lg mx-auto">
          <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
            <h3 className="font-bold text-xl text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              What is a DEX?
            </h3>
            <p className="text-gray-300 mb-4 leading-relaxed">
              A <span className="text-blue-400 font-semibold">Decentralized Exchange (DEX)</span> allows you to swap tokens directly from your wallet without any intermediaries.
              Your assets stay in your control at all times — no need to deposit funds to a centralized platform.
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-green-400 font-semibold">✓ No Registration</p>
                <p className="text-gray-400">Just connect your wallet</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-green-400 font-semibold">✓ Self-Custody</p>
                <p className="text-gray-400">Your keys, your coins</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-green-400 font-semibold">✓ Transparent</p>
                <p className="text-gray-400">All trades are on-chain</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-green-400 font-semibold">✓ Always Open</p>
                <p className="text-gray-400">Trade 24/7, no downtime</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trading Tips */}
      <div className="max-w-7xl mx-auto mt-6 px-4">
        <div className="max-w-lg mx-auto">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-5">
            <h3 className="font-bold text-blue-300 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              💡 Trading Tips
            </h3>
            <ul className="text-blue-200/80 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span><strong>Check Price Impact</strong> before swapping large amounts to avoid unfavorable rates.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span><strong>Slippage Tolerance</strong> of 0.5-1% works for most trades. Increase it during high volatility.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span><strong>Keep native tokens</strong> in your wallet for gas fees (transaction costs).</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function PoolInfo() {
  return (
    <>
      {/* How to Provide Liquidity */}
      <div className="max-w-lg mx-auto mt-12">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
          <h3 className="font-bold text-xl text-white mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How to Provide Liquidity
          </h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-purple-400 font-bold">1</div>
              <div>
                <p className="font-semibold text-white">Prepare Your Token Pair</p>
                <p className="text-gray-400 text-sm">You&apos;ll need <strong className="text-purple-300">equal value</strong> of both tokens (e.g., 100 Token A + 10,000 Token B at current price).</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-purple-400 font-bold">2</div>
              <div>
                <p className="font-semibold text-white">Add Liquidity</p>
                <p className="text-gray-400 text-sm">Deposit your tokens and receive <strong className="text-purple-300">LP tokens</strong> representing your share of the pool.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-purple-400 font-bold">3</div>
              <div>
                <p className="font-semibold text-white">Earn Rewards!</p>
                <p className="text-gray-400 text-sm">Earn <strong className="text-green-400">0.3%</strong> of all trading fees. Plus, stake your LP tokens in Farm for bonus rewards!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* What are LP Tokens */}
      <div className="max-w-lg mx-auto mt-6">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
          <h3 className="font-bold text-xl text-white mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
            What are LP Tokens?
          </h3>
          <p className="text-gray-300 mb-4 leading-relaxed">
            <span className="text-cyan-400 font-semibold">LP (Liquidity Provider) tokens</span> are your &quot;receipt&quot; for the assets you&apos;ve deposited in the pool.
            They represent your proportional share of the liquidity pool.
          </p>
          <div className="bg-gray-700/50 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span className="text-gray-300">Redeem anytime for your original tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span className="text-gray-300">Stake in Farm for additional rewards</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span className="text-gray-300">Transferable to other wallets</span>
            </div>
          </div>
        </div>
      </div>

      {/* Impermanent Loss Warning */}
      <div className="max-w-lg mx-auto mt-6">
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5">
          <h3 className="font-bold text-yellow-300 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            ⚠️ Understanding Impermanent Loss
          </h3>
          <p className="text-yellow-200/80 text-sm mb-3">
            When token prices change significantly, you may end up with less value than if you had simply held your tokens.
            This is called <strong>&quot;Impermanent Loss&quot;</strong>.
          </p>
          <p className="text-yellow-200/60 text-xs">
            💡 Trading fees and Farm rewards often offset this loss, but please understand the risks before providing liquidity.
          </p>
        </div>
      </div>
    </>
  );
}

function FarmInfo() {
  return (
    <>
      {/* How to Farm */}
      <div className="max-w-lg mx-auto mt-12">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
          <h3 className="font-bold text-xl text-white mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How to Farm (Yield Farming)
          </h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-green-400 font-bold">1</div>
              <div>
                <p className="font-semibold text-white">Get LP Tokens First</p>
                <p className="text-gray-400 text-sm">Go to the <strong className="text-purple-300">Pool</strong> tab and add liquidity to receive LP tokens.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-green-400 font-bold">2</div>
              <div>
                <p className="font-semibold text-white">Stake Your LP Tokens</p>
                <p className="text-gray-400 text-sm">Deposit your LP tokens into the farming pool using the &quot;Deposit&quot; button.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-green-400 font-bold">3</div>
              <div>
                <p className="font-semibold text-white">Harvest Your Rewards!</p>
                <p className="text-gray-400 text-sm">Your <strong className="text-green-400">VBCG rewards</strong> accumulate every block. Harvest them anytime!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* What is Yield Farming */}
      <div className="max-w-lg mx-auto mt-6">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
          <h3 className="font-bold text-xl text-white mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            What is Yield Farming?
          </h3>
          <p className="text-gray-300 mb-4 leading-relaxed">
            <span className="text-yellow-400 font-semibold">Yield Farming</span> is a way to earn extra rewards by staking your LP tokens.
            While your liquidity already earns trading fees, farming gives you <strong>additional VBCG token rewards</strong>.
          </p>
          <div className="bg-gray-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Current Reward Rate:</span>
              <span className="text-green-400 font-semibold">0.01 VBCG / block</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-gray-400">Reward Token:</span>
              <span className="text-cyan-400 font-semibold">VBCG</span>
            </div>
          </div>
        </div>
      </div>

      {/* Farming Tips */}
      <div className="max-w-lg mx-auto mt-6">
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5">
          <h3 className="font-bold text-green-300 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            💡 Farming Tips
          </h3>
          <ul className="text-green-200/80 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span><strong>No Lock-up:</strong> Withdraw your LP tokens anytime with no penalties.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span><strong>Compound or Harvest:</strong> Let rewards accumulate or harvest them regularly — it&apos;s up to you!</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span><strong>Double Earnings:</strong> You earn both trading fees (from Pool) AND VBCG rewards (from Farm).</span>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}

function ContractAddresses() {
  const contracts: { name: string; address: string; description: string; type: 'contract' | 'token' }[] = [
    { name: 'SimpleFactoryV2', address: '0x663B1b42B79077AaC918515D3f57FED6820Dad63', description: 'Creates LP pairs', type: 'contract' },
    { name: 'SimpleRouterV2', address: '0xdD1Ae4345252FFEA67fE844296fbd6C973B98c18', description: 'Swap & liquidity routing', type: 'contract' },
    { name: 'WVBC', address: '0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b', description: 'Wrapped VirBiCoin', type: 'token' },
    { name: 'MasterChefV2', address: '0x12A656c2DeE0EA2685398d52AcF78974fCD67B27', description: 'Staking rewards', type: 'contract' },
    { name: 'TokenFactory', address: '0x5721a3A9fc168a8Ac1c8A2Cfca9c61C8189d8618', description: 'Token creation', type: 'contract' },
    { name: 'VBCG', address: '0xac7F60af25C5c4E23d1008C46511e265A8c9B6cF', description: 'VirBiCoin Gold', type: 'token' },
    { name: 'USDT', address: '0xdf136683B118E95c04A61FEC091c65736d9de059', description: 'Tether USD (VBC)', type: 'token' },
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="max-w-4xl mx-auto mt-12 px-4">
      <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
        <h3 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Smart Contract Addresses
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          Verified contracts deployed on VirBiCoin Chain (Chain ID: 329)
        </p>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="pb-3 font-medium">Contract</th>
                <th className="pb-3 font-medium">Address</th>
                <th className="pb-3 font-medium hidden sm:table-cell">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {contracts.map((contract) => (
                <tr key={contract.address} className="hover:bg-gray-700/30 transition-colors">
                  <td className="py-3 font-medium text-gray-200">
                    <div className="flex items-center gap-2">
                      {contract.name}
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        contract.type === 'token' 
                          ? 'bg-purple-500/20 text-purple-300' 
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {contract.type === 'token' ? 'Token' : 'Contract'}
                      </span>
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <a
                        href={contract.type === 'token' ? `/token/${contract.address}` : `/address/${contract.address}`}
                        className="text-blue-400 hover:text-blue-300 font-mono text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none"
                        title={contract.address}
                      >
                        {contract.address.slice(0, 10)}...{contract.address.slice(-8)}
                      </a>
                      <button
                        onClick={() => copyToClipboard(contract.address)}
                        className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                        title="Copy address"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="py-3 text-gray-400 hidden sm:table-cell">{contract.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700/50 flex flex-wrap gap-4 text-xs text-gray-500">
          <a
            href="https://rpc.digitalregion.jp"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-300 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            RPC: rpc.digitalregion.jp
          </a>
          <span className="text-gray-600">|</span>
          <span>Chain ID: 329</span>
          <span className="text-gray-600">|</span>
          <span>Symbol: VBC</span>
        </div>
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

