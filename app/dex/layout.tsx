import type { Metadata } from 'next';
import { loadConfig } from '@/lib/config';

// Generate metadata from config
const config = loadConfig();
const networkName = config.network?.name || config.currency?.name || 'Network';

export const metadata: Metadata = {
  title: `${networkName} DEX - Swap & Liquidity`,
  description: `Decentralized exchange for ${networkName}`,
};

export default function DexLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <svg
              className="w-8 h-8 text-blue-400"
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
            <div>
              <h1 className="text-2xl font-bold text-gray-100">{networkName} DEX</h1>
              <p className="text-gray-400 text-sm">Swap, Pool & Farm</p>
            </div>
          </div>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
