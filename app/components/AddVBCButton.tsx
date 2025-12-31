'use client';

import Image from 'next/image';

export default function AddVBCButton() {
  const handleAddVBC = async () => {
    // Wait for ethereum to be injected (some wallets inject asynchronously)
    let ethereum = (window as any).ethereum;

    // If not found immediately, wait a bit and try again
    if (!ethereum) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      ethereum = (window as any).ethereum;
    }

    // Check if MetaMask or compatible wallet is installed
    if (!ethereum) {
      const confirmed = confirm('No Web3 wallet detected. Would you like to install MetaMask?');
      if (confirmed) {
        window.open('https://metamask.io/download/', '_blank');
      }
      return;
    }

    try {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: '0x149',
            chainName: 'VirBiCoin',
            nativeCurrency: {
              name: 'VirBiCoin',
              symbol: 'VBC',
              decimals: 18,
            },
            rpcUrls: ['https://rpc.digitalregion.jp'],
            blockExplorerUrls: ['https://explorer.digitalregion.jp'],
            iconUrls: ['https://vbc.digitalregion.jp/VBC.svg'],
          },
        ],
      });
    } catch (error: any) {
      // User rejected or error occurred
      if (error.code === 4001) {
        console.log('User rejected the request');
      } else {
        console.error('Failed to add VirBiCoin network:', error);
        alert('Failed to add network. Please try again or add it manually in your wallet.');
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleAddVBC}
      className="w-full sm:w-auto mt-4 sm:mt-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40"
    >
      <Image src="/img/MetaMask.svg" alt="MetaMask" width={24} height={24} className="w-6 h-6" />
      Add VirBiCoin
    </button>
  );
}
