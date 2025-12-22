'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Loading component
function LoadingSkeleton() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-800/90 rounded-3xl p-6 shadow-xl border border-gray-700/50 animate-pulse">
        <div className="h-8 bg-gray-700 rounded mb-6 w-48"></div>
        <div className="space-y-4">
          <div className="h-16 bg-gray-700 rounded-xl"></div>
          <div className="h-16 bg-gray-700 rounded-xl"></div>
          <div className="h-16 bg-gray-700 rounded-xl"></div>
          <div className="h-16 bg-gray-700 rounded-xl"></div>
        </div>
        <div className="h-14 bg-gray-700 rounded-xl mt-6"></div>
      </div>
    </div>
  );
}

// Dynamic imports for SSR compatibility
const LaunchpadWrapper = dynamic(
  () => import('./components/LaunchpadWrapper').then((mod) => mod.LaunchpadWrapper),
  { ssr: false, loading: () => null }
);

const CreateTokenForm = dynamic(
  () => import('./components/CreateTokenForm').then((mod) => mod.CreateTokenForm),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const TokenList = dynamic(
  () => import('./components/TokenList').then((mod) => mod.TokenList),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

const MyTokens = dynamic(
  () => import('./components/MyTokens').then((mod) => mod.MyTokens),
  { ssr: false, loading: () => <LoadingSkeleton /> }
);

type Tab = 'create' | 'tokens' | 'my-tokens';

function TabNavigation({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'create',
      label: 'Create Token',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      ),
    },
    {
      id: 'tokens',
      label: 'All Tokens',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      id: 'my-tokens',
      label: 'My Tokens',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="max-w-2xl mx-auto mb-6">
      <div className="flex bg-gray-800/90 rounded-2xl p-1.5 border border-gray-700/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LaunchpadPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab');
  
  // Initialize tab from URL parameter
  const initialTab = (tabParam === 'create' || tabParam === 'tokens' || tabParam === 'my-tokens') ? tabParam : 'create';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Update URL when tab changes
  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    router.push(`/launchpad?tab=${tab}`, { scroll: false });
  };

  return (
    <>
      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      <Suspense fallback={<LoadingSkeleton />}>
        <LaunchpadWrapper>
          {activeTab === 'create' && <CreateTokenForm />}
          {activeTab === 'tokens' && <TokenList />}
          {activeTab === 'my-tokens' && <MyTokens />}
        </LaunchpadWrapper>
      </Suspense>

      {/* Info Section */}
      <InfoSection />
    </>
  );
}

function InfoSection() {
  return (
    <div className="max-w-4xl mx-auto mt-12 px-4">
      {/* How to Create Token */}
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50 mb-8">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          How to Create Your Token
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-400 font-bold mb-3">
              1
            </div>
            <h3 className="font-semibold text-white mb-1">Connect Wallet</h3>
            <p className="text-gray-400 text-sm">Connect your MetaMask or compatible wallet</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-400 font-bold mb-3">
              2
            </div>
            <h3 className="font-semibold text-white mb-1">Fill Token Info</h3>
            <p className="text-gray-400 text-sm">Enter name, symbol, decimals, and total supply</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-400 font-bold mb-3">
              3
            </div>
            <h3 className="font-semibold text-white mb-1">Pay Creation Fee</h3>
            <p className="text-gray-400 text-sm">Pay a small fee to deploy your token</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-400 font-bold mb-3">
              4
            </div>
            <h3 className="font-semibold text-white mb-1">Token Deployed!</h3>
            <p className="text-gray-400 text-sm">Receive all tokens to your wallet</p>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/30">
          <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Standard ERC20</h3>
          <p className="text-gray-400 text-sm">
            Your token follows the ERC20 standard, compatible with all wallets and exchanges.
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/30">
          <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Instant Deployment</h3>
          <p className="text-gray-400 text-sm">
            Your token is deployed instantly on the blockchain with just a few clicks.
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/30">
          <div className="w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Full Ownership</h3>
          <p className="text-gray-400 text-sm">
            You receive 100% of the total supply to your wallet upon creation.
          </p>
        </div>
      </div>

      {/* Warning */}
      <div className="mt-8 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-yellow-500/20 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-yellow-400 mb-2">Important Notice</h3>
            <p className="text-gray-300 text-sm">
              Creating a token is a permanent action on the blockchain. Please double-check all details before deployment.
              Token creation may require a small fee to cover gas costs. Make sure you have enough balance in your wallet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LaunchpadPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LaunchpadPageContent />
    </Suspense>
  );
}
