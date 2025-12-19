'use client';

import Image from 'next/image';
import { useAccount, useConnect, useDisconnect, useBalance, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { useState, useEffect } from 'react';
import { getChain, getNativeToken } from '@/lib/dex/config';

// Chain configuration type
interface ChainParams {
  chainId: string;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  iconUrls: string[];
}

// Get chain params from config dynamically
function getChainParams(): ChainParams {
  const chain = getChain();
  const nativeToken = getNativeToken();
  
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: {
      name: nativeToken.name,
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
    },
    rpcUrls: [chain.rpcUrls.default.http[0]],
    blockExplorerUrls: [chain.blockExplorers?.default?.url || ''],
    iconUrls: []
  };
}

function ConnectWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address });
  
  const [chainParams, setChainParams] = useState<ChainParams | null>(null);
  const [expectedChainId, setExpectedChainId] = useState<number | null>(null);
  
  useEffect(() => {
    // Get chain params on client side
    const params = getChainParams();
    // Use requestAnimationFrame to avoid synchronous setState in effect
    requestAnimationFrame(() => {
      setChainParams(params);
      setExpectedChainId(parseInt(params.chainId, 16));
    });
  }, []);

  const isWrongNetwork = isConnected && expectedChainId !== null && chainId !== expectedChainId;
  const nativeSymbol = chainParams?.nativeCurrency.symbol || 'ETH';

  // Connect with MetaMask and add network
  const handleConnect = async () => {
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (injectedConnector && chainParams) {
      connect({ connector: injectedConnector });
      
      // Try to add network after connecting
      const ethereum = (window as unknown as { ethereum?: {
        request: (params: { method: string; params?: unknown[] }) => Promise<unknown>;
      } }).ethereum;
      
      if (ethereum) {
        try {
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainParams.chainId }],
          });
        } catch (switchError: unknown) {
          if ((switchError as { code?: number })?.code === 4902) {
            try {
              await ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [chainParams],
              });
            } catch (addError) {
              console.error('Failed to add network:', addError);
            }
          }
        }
      }
    }
  };

  // Switch to correct network
  const handleSwitchNetwork = async () => {
    if (!chainParams) return;
    
    const ethereum = (window as unknown as { ethereum?: {
      request: (params: { method: string; params?: unknown[] }) => Promise<unknown>;
    } }).ethereum;
    
    if (ethereum) {
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainParams.chainId }],
        });
      } catch (switchError: unknown) {
        if ((switchError as { code?: number })?.code === 4902) {
          try {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [chainParams],
            });
          } catch (addError) {
            console.error('Failed to add network:', addError);
          }
        }
      }
    }
  };

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        {/* Wrong Network Warning */}
        {isWrongNetwork && (
          <button
            onClick={handleSwitchNetwork}
            className="flex items-center gap-2 px-3 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded-xl text-yellow-400 text-sm font-medium hover:bg-yellow-500/30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Switch Network
          </button>
        )}
        
        {/* Balance Display */}
        {!isWrongNetwork && balance && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-800/80 rounded-xl border border-gray-700">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-gray-300">
              {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} {nativeSymbol}
            </span>
          </div>
        )}
        
        {/* Address & Disconnect */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-gray-800 to-gray-700 rounded-xl border border-gray-600">
          <Image src="/img/MetaMask.svg" alt="MetaMask" width={20} height={20} />
          <span className="text-sm font-medium">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <button
            onClick={() => disconnect()}
            className="ml-1 p-1 hover:bg-gray-600 rounded-lg transition-colors"
            title="Disconnect"
          >
            <svg className="w-4 h-4 text-gray-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isPending}
      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 disabled:opacity-50"
    >
      <Image src="/img/MetaMask.svg" alt="MetaMask" width={20} height={20} />
      {isPending ? 'Connecting...' : 'Connect MetaMask'}
    </button>
  );
}

export function DexHeader() {
  return (
    <div className="max-w-lg mx-auto mb-6">
      <div className="flex justify-end">
        <ConnectWalletButton />
      </div>
    </div>
  );
}
