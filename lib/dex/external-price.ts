import { loadConfig } from '@/lib/config';
import { getNativePrice } from '@/lib/price-service';
import Web3 from 'web3';

// Cache for external price data (5 minute TTL)
let cachedData: ExternalPriceData | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface ExternalPriceData {
  nativePriceUsd: number;
  nativeSymbol: string;
  totalTvlUsd: number;
  lastUpdated: number;
  source: {
    price: string;
    tvl: string;
  };
}

// Minimal ABIs for TVL calculation
const FACTORY_ABI = [
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const PAIR_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const ERC20_ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/**
 * Calculate TVL directly from blockchain data
 * TVL = Sum of all pool reserves converted to USD
 */
async function calculateTvlFromBlockchain(nativePriceUsd: number): Promise<number> {
  try {
    const config = loadConfig();

    if (!config.dex?.enabled || !config.dex?.factory) {
      return 0;
    }

    const RPC_URL = config.network?.rpcUrl || config.web3Provider?.url || 'http://localhost:8545';
    const web3 = new Web3(RPC_URL);

    const factoryAddress = config.dex.factory;
    const wrappedNativeAddress = config.dex.wrappedNative?.address?.toLowerCase() || '';

    // Known stablecoin addresses (USDT, USDC, etc.)
    // Get from config tokens if available
    const stablecoinAddresses: string[] = [];
    if (config.dex.tokens) {
      for (const token of Object.values(config.dex.tokens)) {
        const symbol = token.symbol?.toUpperCase();
        if (symbol === 'USDT' || symbol === 'USDC' || symbol === 'DAI' || symbol === 'BUSD') {
          stablecoinAddresses.push(token.address.toLowerCase());
        }
      }
    }
    const STABLECOIN_ADDRESSES = new Set(stablecoinAddresses);

    const factory = new web3.eth.Contract(FACTORY_ABI, factoryAddress);
    const pairsLengthResult = await factory.methods.allPairsLength().call();
    const numPairs = Number(pairsLengthResult);

    let totalTvlUsd = 0;

    // Fetch all pairs (limit to 50 for performance)
    const maxPairs = Math.min(numPairs, 50);

    for (let i = 0; i < maxPairs; i++) {
      try {
        const pairAddressResult = await factory.methods.allPairs(i).call();
        const pairAddress = String(pairAddressResult);

        const pairContract = new web3.eth.Contract(PAIR_ABI, pairAddress);

        const [token0AddressResult, token1AddressResult, reservesResult] = await Promise.all([
          pairContract.methods.token0().call(),
          pairContract.methods.token1().call(),
          pairContract.methods.getReserves().call(),
        ]);

        const token0Address = String(token0AddressResult).toLowerCase();
        const token1Address = String(token1AddressResult).toLowerCase();
        const reserves = reservesResult as unknown as { reserve0: string; reserve1: string };

        const reserve0 = BigInt(reserves.reserve0);
        const reserve1 = BigInt(reserves.reserve1);

        if (reserve0 === 0n && reserve1 === 0n) {
          continue;
        }

        // Get decimals for both tokens
        const token0Contract = new web3.eth.Contract(ERC20_ABI, token0Address);
        const token1Contract = new web3.eth.Contract(ERC20_ABI, token1Address);

        const [decimals0Result, decimals1Result] = await Promise.all([
          token0Contract.methods.decimals().call(),
          token1Contract.methods.decimals().call(),
        ]);

        const decimals0 = Number(decimals0Result);
        const decimals1 = Number(decimals1Result);

        // Calculate USD value for this pool
        let poolTvlUsd = 0;

        // Check if token0 is wrapped native or stablecoin
        const token0IsWrappedNative = token0Address === wrappedNativeAddress;
        const token1IsWrappedNative = token1Address === wrappedNativeAddress;
        const token0IsStablecoin = STABLECOIN_ADDRESSES.has(token0Address);
        const token1IsStablecoin = STABLECOIN_ADDRESSES.has(token1Address);

        if (token0IsStablecoin) {
          // token0 is stablecoin, use its reserve * 2 (assuming 50/50 pool)
          const reserve0Usd = Number(reserve0) / Math.pow(10, decimals0);
          poolTvlUsd = reserve0Usd * 2;
        } else if (token1IsStablecoin) {
          // token1 is stablecoin, use its reserve * 2
          const reserve1Usd = Number(reserve1) / Math.pow(10, decimals1);
          poolTvlUsd = reserve1Usd * 2;
        } else if (token0IsWrappedNative) {
          // token0 is wrapped native, calculate USD value from native price
          const reserve0InNative = Number(reserve0) / Math.pow(10, decimals0);
          poolTvlUsd = reserve0InNative * nativePriceUsd * 2;
        } else if (token1IsWrappedNative) {
          // token1 is wrapped native, calculate USD value from native price
          const reserve1InNative = Number(reserve1) / Math.pow(10, decimals1);
          poolTvlUsd = reserve1InNative * nativePriceUsd * 2;
        } else {
          // Neither is native or stablecoin - try to estimate via native token price
          // This is less accurate but provides some estimate
          const reserve0InTokens = Number(reserve0) / Math.pow(10, decimals0);
          const reserve1InTokens = Number(reserve1) / Math.pow(10, decimals1);
          // Use average of both reserves valued at native price as rough estimate
          poolTvlUsd = (reserve0InTokens + reserve1InTokens) * nativePriceUsd;
        }

        totalTvlUsd += poolTvlUsd;
      } catch (error) {
        console.error(`Error calculating TVL for pair ${i}:`, error);
        continue;
      }
    }

    return totalTvlUsd;
  } catch (error) {
    console.error('Failed to calculate TVL from blockchain:', error);
    return 0;
  }
}

/**
 * Get external price data (cached for 5 minutes)
 */
export async function getExternalPriceData(): Promise<ExternalPriceData> {
  // Get native token symbol from config
  const config = loadConfig();
  const nativeSymbol = config.currency?.symbol || 'ETH';

  // Return cached data if still valid
  if (cachedData && Date.now() - cachedData.lastUpdated < CACHE_TTL) {
    return cachedData;
  }

  // Get price from price service (uses Market DB first, then WikaEx)
  const priceData = await getNativePrice();
  const nativePriceUsd = priceData?.priceUSD || 0;
  const priceSource = priceData?.source === 'database' ? 'Market DB' : 'WikaEx';

  // Then calculate TVL from blockchain using the native price
  const totalTvlUsd = await calculateTvlFromBlockchain(nativePriceUsd);

  // Update cache
  cachedData = {
    nativePriceUsd,
    nativeSymbol,
    totalTvlUsd,
    lastUpdated: Date.now(),
    source: {
      price: priceSource,
      tvl: 'Calculated',
    },
  };

  return cachedData;
}

/**
 * Clear the price cache (useful for testing)
 */
export function clearPriceCache(): void {
  cachedData = null;
}
