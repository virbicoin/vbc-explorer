'use client';

import { WagmiProvider, createConfig, http, type Config } from 'wagmi';
import { reconnect } from 'wagmi/actions';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, createContext, use, useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from 'viem';
import {
  BridgeConfig,
  BridgeRoute,
  BridgeSource,
  fetchBridgeConfig,
  toViemChain,
} from '../lib/config';

export interface BridgeContextValue {
  relayEtaSeconds: number;
  source: BridgeSource;
  routes: BridgeRoute[];
  routeId: string;
  setRouteId: (id: string) => void;
  /** The currently selected route (convenience). */
  route: BridgeRoute;
}

const BridgeContext = createContext<BridgeContextValue | null>(null);

export function useBridge(): BridgeContextValue {
  const ctx = use(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used within a ready BridgeProvider');
  return ctx;
}

type Status = 'loading' | 'ready' | 'disabled' | 'error';

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 p-10 text-gray-400">
      {children}
    </div>
  );
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);
  const [bridge, setBridge] = useState<BridgeConfig | null>(null);
  const [routeId, setRouteId] = useState<string>('');
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
        // Build a wagmi config spanning the source chain and every distinct
        // remote chain referenced by the routes.
        const source = toViemChain(cfg.source);
        const chainMap = new Map<number, Chain>([[source.id, source]]);
        const transports: Record<number, ReturnType<typeof http>> = {
          [source.id]: http(cfg.source.rpcUrl),
        };
        for (const r of cfg.routes) {
          if (!chainMap.has(r.remote.chainId)) {
            chainMap.set(r.remote.chainId, toViemChain(r.remote));
            transports[r.remote.chainId] = http(r.remote.rpcUrl);
          }
        }
        const chains = Array.from(chainMap.values()) as [Chain, ...Chain[]];
        const wc = createConfig({
          connectors: [injected({ shimDisconnect: true })],
          chains,
          transports,
          ssr: true,
          syncConnectedChain: true,
        });
        setBridge(cfg);
        setRouteId(cfg.routes[0].id);
        setWagmiConfig(wc);
        setStatus('ready');
        setTimeout(() => reconnect(wc), 100);
      })
      .catch(() => setStatus('error'));
  }, []);

  const value = useMemo<BridgeContextValue | null>(() => {
    if (!bridge) return null;
    const route = bridge.routes.find((r) => r.id === routeId) ?? bridge.routes[0];
    return {
      relayEtaSeconds: bridge.relayEtaSeconds,
      source: bridge.source,
      routes: bridge.routes,
      routeId: route.id,
      setRouteId,
      route,
    };
  }, [bridge, routeId]);

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
  if (status === 'error' || !wagmiConfig || !value) {
    return <Centered>Failed to load bridge configuration.</Centered>;
  }

  return (
    <BridgeContext value={value}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </BridgeContext>
  );
}
