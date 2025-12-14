'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAccount, useConnect, useDisconnect, useBalance, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { virBiCoin } from '@/lib/dex/config';

// VirBiCoin network configuration for adding to MetaMask
const VBC_CHAIN_PARAMS = {
  chainId: '0x149', // 329 in hex
  chainName: 'VirBiCoin',
  nativeCurrency: {
    name: 'VirBiCoin',
    symbol: 'VBC',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.digitalregion.jp'],
  blockExplorerUrls: ['https://explorer.digitalregion.jp'],
  iconUrls: ['https://vbc.digitalregion.jp/VBC.svg']
};

function ConnectWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address });

  const isWrongNetwork = isConnected && chainId !== virBiCoin.id;

  // Connect with MetaMask and add VBC network
  const handleConnect = async () => {
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (injectedConnector) {
      connect({ connector: injectedConnector });
      
      // Try to add VBC network after connecting
      const ethereum = (window as unknown as { ethereum?: {
        request: (params: { method: string; params?: unknown[] }) => Promise<unknown>;
      } }).ethereum;
      
      if (ethereum) {
        try {
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: VBC_CHAIN_PARAMS.chainId }],
          });
        } catch (switchError: unknown) {
          if ((switchError as { code?: number })?.code === 4902) {
            try {
              await ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [VBC_CHAIN_PARAMS],
              });
            } catch (addError) {
              console.error('Failed to add VBC network:', addError);
            }
          }
        }
      }
    }
  };

  // Switch to VBC network
  const handleSwitchNetwork = async () => {
    const ethereum = (window as unknown as { ethereum?: {
      request: (params: { method: string; params?: unknown[] }) => Promise<unknown>;
    } }).ethereum;
    
    if (ethereum) {
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: VBC_CHAIN_PARAMS.chainId }],
        });
      } catch (switchError: unknown) {
        if ((switchError as { code?: number })?.code === 4902) {
          try {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [VBC_CHAIN_PARAMS],
            });
          } catch (addError) {
            console.error('Failed to add VBC network:', addError);
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
            Switch to VBC
          </button>
        )}
        
        {/* Balance Display */}
        {!isWrongNetwork && balance && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-800/80 rounded-xl border border-gray-700">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-gray-300">
              {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} VBC
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
  const pathname = usePathname();

  const navItems = [
    { href: '/dex', label: 'Swap', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )},
    { href: '/dex/pool', label: 'Pool', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    )},
  ];

  return (
    <div className="max-w-lg mx-auto mb-8">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-gray-800/50 backdrop-blur-sm rounded-2xl p-1.5 border border-gray-700/50">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all text-sm font-semibold ${
                pathname === item.href
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        
        <ConnectWalletButton />
      </div>
    </div>
  );
}
