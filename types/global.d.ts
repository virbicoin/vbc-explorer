import { type EIP1193Provider } from 'viem';

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      isMetaMask?: boolean;
      isCoinbaseWallet?: boolean;
      providers?: EIP1193Provider[];
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export {};
