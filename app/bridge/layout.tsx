import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bridge - VirBiCoin',
  description: 'Bridge native VBC and wVBC 1:1 between VirBiCoin and BNB Smart Chain',
};

export default function BridgeLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-900 text-white">{children}</div>;
}
