'use client';

import { WagmiProvider, createConfig, http, type Config } from 'wagmi';
import { reconnect } from 'wagmi/actions';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState, useEffect, useRef } from 'react';
import { getChain, resetChain } from '@/lib/dex/config';
import { initializeDexConfig, isConfigLoaded, getMinimalConfig } from '@/lib/dex/contract-service';

// Create config lazily after dex config is loaded
function createWagmiConfig() {
  const chain = getChain();
  const rpcUrl = chain.rpcUrls.default.http[0];
  
  console.log('[createWagmiConfig] Creating config with chain:', chain.id, chain.name, 'rpc:', rpcUrl);
  
  // Verify we're not using localhost
  if (rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')) {
    console.error('[createWagmiConfig] ERROR: Still using localhost RPC!', rpcUrl);
  }
  
  return createConfig({
    connectors: [
      // Disable shimDisconnect to prevent auto-reconnect issues
      injected({ shimDisconnect: true }),
    ],
    chains: [chain],
    transports: {
      [chain.id]: http(rpcUrl),
    },
    ssr: true,
    // Disable automatic reconnection on startup - we'll do it manually after config is ready
    syncConnectedChain: true,
  });
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function init() {
      try {
        // Load config from API first
        console.log('[Web3Provider] Loading config from API...');
        const loadedConfig = await initializeDexConfig();
        
        console.log('[Web3Provider] Config loaded:', {
          chainId: loadedConfig.chainId,
          rpcUrl: loadedConfig.rpcUrl,
          isLoaded: isConfigLoaded(),
        });
        
        // Verify config was loaded correctly (allow localhost for development)
        if (!isConfigLoaded()) {
          throw new Error('Failed to load config from API');
        }
        
        // Warn if using localhost but don't fail
        if (loadedConfig.rpcUrl.includes('localhost') || loadedConfig.rpcUrl.includes('127.0.0.1')) {
          console.warn('[Web3Provider] Using localhost RPC - this may not work in production');
        }
        
        // Reset the chain to use new config
        resetChain();
        
        // Create wagmi config with loaded settings
        const wagmiConfig = createWagmiConfig();
        setConfig(wagmiConfig);
        
        // Manually trigger reconnection after config is set
        // This ensures reconnection uses the correct RPC
        setTimeout(() => {
          reconnect(wagmiConfig);
        }, 100);
        
        console.log('[Web3Provider] Wagmi config created successfully');
      } catch (err) {
        console.error('[Web3Provider] Failed to initialize:', err);
        setError(err instanceof Error ? err.message : 'Failed to load configuration');
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-400">Loading DEX configuration...</span>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-red-400">
          <p>Failed to load DEX configuration</p>
          <p className="text-sm text-gray-500 mt-2">{error || 'Unknown error'}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
