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
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
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
            <div>
              <h1 className="text-2xl font-bold text-gray-100">{networkName} Launchpad</h1>
              <p className="text-gray-400 text-sm">Create your own ERC20 token</p>
            </div>
          </div>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
