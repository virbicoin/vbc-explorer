import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VBC DEX - Swap & Liquidity',
  description: 'Decentralized exchange for VirBiCoin network',
};

export default function DexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" />
              <path d="M8 3H3v5" />
              <path d="M21 3l-7 7" />
              <path d="M3 3l7 7" />
              <path d="M16 21h5v-5" />
              <path d="M8 21H3v-5" />
              <path d="M21 21l-7-7" />
              <path d="M3 21l7-7" />
            </svg>
            <h1 className="text-3xl font-bold text-gray-100">VBC DEX</h1>
          </div>
          <p className="text-gray-400">Swap tokens and provide liquidity on the VirBiCoin network</p>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
