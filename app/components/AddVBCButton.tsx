'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
}

interface CurrencyConfig {
  name: string;
  symbol: string;
  decimals: number;
}

export default function AddVBCButton() {
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig | null>(null);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config/client');
        if (response.ok) {
          const data = await response.json();
          setNetworkConfig(data.network);
          setCurrencyConfig(data.currency);
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };
    fetchConfig();
  }, []);

  const handleAddNetwork = async () => {
    // Wait for ethereum to be injected (some wallets inject asynchronously)
    let ethereum = (
      window as unknown as {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }
    ).ethereum;

    // If not found immediately, wait a bit and try again
    if (!ethereum) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      ethereum = (
        window as unknown as {
          ethereum?: {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
          };
        }
      ).ethereum;
    }

    // Check if MetaMask or compatible wallet is installed
    if (!ethereum) {
      const confirmed = confirm('No Web3 wallet detected. Would you like to install MetaMask?');
      if (confirmed) {
        window.open('https://metamask.io/download/', '_blank');
      }
      return;
    }

    if (!networkConfig || !currencyConfig) {
      alert('Network configuration not loaded. Please try again.');
      return;
    }

    try {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: `0x${networkConfig.chainId.toString(16)}`,
            chainName: networkConfig.name,
            nativeCurrency: {
              name: currencyConfig.name,
              symbol: currencyConfig.symbol,
              decimals: currencyConfig.decimals,
            },
            rpcUrls: [networkConfig.rpcUrl],
            blockExplorerUrls: [networkConfig.explorer],
          },
        ],
      });
    } catch (error: unknown) {
      const err = error as { code?: number };
      // User rejected or error occurred
      if (err.code === 4001) {
        console.log('User rejected the request');
      } else {
        console.error('Failed to add network:', error);
        alert('Failed to add network. Please try again or add it manually in your wallet.');
      }
    }
  };

  const networkName = networkConfig?.name || currencyConfig?.name || 'Network';

  return (
    <button
      type="button"
      onClick={handleAddNetwork}
      className="w-full sm:w-auto mt-4 sm:mt-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40"
    >
      <Image src="/img/MetaMask.svg" alt="MetaMask" width={24} height={24} className="w-6 h-6" />
      Add {networkName}
    </button>
  );
}
