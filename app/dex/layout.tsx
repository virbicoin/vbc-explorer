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
      {children}
    </div>
  );
}
