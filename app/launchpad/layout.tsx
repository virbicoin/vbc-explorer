import type { Metadata } from 'next';
import { loadConfig } from '@/lib/config';

// Generate metadata from config
const config = loadConfig();
const networkName = config.network?.name || config.currency?.name || 'Network';

export const metadata: Metadata = {
  title: `${networkName} Launchpad - Create Your Token`,
  description: `Create and launch your own ERC20 token on ${networkName}`,
};

export default function LaunchpadLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/20 rounded-xl">
              <svg
                className="w-8 h-8 text-purple-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{networkName} Launchpad</h1>
              <p className="text-gray-400 mt-1">Create, manage, and discover new tokens</p>
            </div>
          </div>
        </div>
      </div>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
