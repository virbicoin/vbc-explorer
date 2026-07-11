'use client';

import { WagmiProvider, createConfig, http, type Config } from 'wagmi';
import { reconnect } from 'wagmi/actions';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, createContext, use, useEffect, useRef, useState } from 'react';
import { BridgeConfig, fetchBridgeConfig, toViemChain } from '../lib/config';

const BridgeConfigContext = createContext<BridgeConfig | null>(null);

export function useBridgeConfig(): BridgeConfig {
  const cfg = use(BridgeConfigContext);
  if (!cfg) throw new Error('useBridgeConfig must be used within a ready BridgeProvider');
  return cfg;
}

type Status = 'loading' | 'ready' | 'disabled' | 'error';

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center p-10 text-gray-400">{children}</div>;
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);
  const [bridge, setBridge] = useState<BridgeConfig | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    fetchBridgeConfig()
      .then((cfg) => {
        if (!cfg) {
          setStatus('disabled');
          return;
        }
        const source = toViemChain(cfg.source);
        const remote = toViemChain(cfg.remote);
        const wc = createConfig({
          connectors: [injected({ shimDisconnect: true })],
          chains: [source, remote],
          transports: {
            [source.id]: http(cfg.source.rpcUrl),
            [remote.id]: http(cfg.remote.rpcUrl),
          },
          ssr: true,
          syncConnectedChain: true,
        });
        setBridge(cfg);
        setWagmiConfig(wc);
        setStatus('ready');
        setTimeout(() => reconnect(wc), 100);
      })
      .catch(() => setStatus('error'));
  }, []);

  if (status === 'loading') {
    return (
      <Centered>
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3" />
        Loading bridge configuration…
      </Centered>
    );
  }
  if (status === 'disabled') {
    return <Centered>The bridge is not enabled for this network.</Centered>;
  }
  if (status === 'error' || !wagmiConfig || !bridge) {
    return <Centered>Failed to load bridge configuration.</Centered>;
  }

  return (
    <BridgeConfigContext value={bridge}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </BridgeConfigContext>
  );
}
