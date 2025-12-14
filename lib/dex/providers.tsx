'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { virBiCoin } from '@/lib/dex/config';

// Create wagmi config with only injected connector (MetaMask, etc.)
const config = createConfig({
  connectors: [
    injected(),
  ],
  chains: [virBiCoin],
  transports: {
    [virBiCoin.id]: http(virBiCoin.rpcUrls.default.http[0]),
  },
  ssr: true,
});

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
