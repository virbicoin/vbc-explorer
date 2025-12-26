/**
 * Web3 Provider Singleton
 * 
 * Shared Web3 instance to avoid creating multiple connections.
 * Uses lazy initialization for better startup performance.
 */

import Web3 from 'web3';
import { loadConfig } from '../config';

let web3Instance: Web3 | null = null;
let providerUrl: string | null = null;

/**
 * Get shared Web3 instance
 * Creates instance on first call and reuses it thereafter
 */
export function getWeb3(): Web3 {
  if (!web3Instance) {
    const config = loadConfig();
    providerUrl = config.web3Provider?.url || process.env.WEB3_PROVIDER_URL || 'http://localhost:8545';
    web3Instance = new Web3(providerUrl);
  }
  return web3Instance;
}

/**
 * Get provider URL
 */
export function getProviderUrl(): string {
  if (!providerUrl) {
    const config = loadConfig();
    providerUrl = config.web3Provider?.url || process.env.WEB3_PROVIDER_URL || 'http://localhost:8545';
  }
  return providerUrl;
}

/**
 * Reset Web3 instance (useful for testing or reconnection)
 */
export function resetWeb3(): void {
  web3Instance = null;
  providerUrl = null;
}

/**
 * Check if Web3 is connected
 */
export async function isWeb3Connected(): Promise<boolean> {
  try {
    const web3 = getWeb3();
    await web3.eth.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
