import { NextResponse } from 'next/server';
import { getWeb3 } from '../../../../lib/web3';

export const dynamic = 'force-dynamic';

interface GasStats {
  slow: string;
  standard: string;
  fast: string;
  instant: string;
  baseFee?: string;
  lastBlock: number;
  timestamp: number;
}

// Cache for gas stats
let gasStatsCache: GasStats | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15000; // 15 seconds

export async function GET() {
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (gasStatsCache && now - lastFetchTime < CACHE_DURATION) {
      return NextResponse.json(gasStatsCache);
    }

    const web3 = getWeb3();

    // Get latest block
    const latestBlock = await web3.eth.getBlock('latest');
    if (!latestBlock) {
      throw new Error('Failed to get latest block');
    }

    // Get gas prices from recent transactions
    const blockNumber = Number(latestBlock.number);
    const gasPrices: bigint[] = [];

    // Fetch gas prices from last 20 blocks
    const blocksToFetch = Math.min(20, blockNumber);
    const blockPromises: Promise<void>[] = [];

    for (let i = 0; i < blocksToFetch; i++) {
      blockPromises.push(
        (async () => {
          try {
            const block = await web3.eth.getBlock(blockNumber - i, true);
            if (block && block.transactions) {
              for (const tx of block.transactions) {
                if (typeof tx === 'object' && tx.gasPrice) {
                  gasPrices.push(BigInt(tx.gasPrice.toString()));
                }
              }
            }
          } catch {
            // Ignore errors for individual blocks
          }
        })()
      );
    }

    await Promise.all(blockPromises);

    // Calculate percentiles
    let slow = '0 Gwei';
    let standard = '0 Gwei';
    let fast = '0 Gwei';
    let instant = '0 Gwei';

    if (gasPrices.length > 0) {
      // Sort gas prices
      gasPrices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const getPercentile = (arr: bigint[], percentile: number): bigint => {
        const index = Math.floor((arr.length - 1) * (percentile / 100));
        return arr[index];
      };

      const formatGwei = (wei: bigint): string => {
        const gwei = Number(wei) / 1e9;
        if (gwei < 0.01) return '<0.01 Gwei';
        if (gwei < 1) return `${gwei.toFixed(2)} Gwei`;
        if (gwei < 100) return `${gwei.toFixed(1)} Gwei`;
        return `${Math.round(gwei)} Gwei`;
      };

      slow = formatGwei(getPercentile(gasPrices, 10));
      standard = formatGwei(getPercentile(gasPrices, 50));
      fast = formatGwei(getPercentile(gasPrices, 75));
      instant = formatGwei(getPercentile(gasPrices, 95));
    }

    // Get base fee if available (EIP-1559)
    let baseFee: string | undefined;
    if (latestBlock.baseFeePerGas) {
      const baseFeeGwei = Number(latestBlock.baseFeePerGas) / 1e9;
      baseFee =
        baseFeeGwei < 1 ? `${baseFeeGwei.toFixed(2)} Gwei` : `${Math.round(baseFeeGwei)} Gwei`;
    }

    const gasStats: GasStats = {
      slow,
      standard,
      fast,
      instant,
      baseFee,
      lastBlock: blockNumber,
      timestamp: now,
    };

    // Update cache
    gasStatsCache = gasStats;
    lastFetchTime = now;

    return NextResponse.json(gasStats);
  } catch (error) {
    console.error('Error fetching gas stats:', error);

    // Return cached data if available, even if stale
    if (gasStatsCache) {
      return NextResponse.json(gasStatsCache);
    }

    return NextResponse.json(
      {
        slow: 'N/A',
        standard: 'N/A',
        fast: 'N/A',
        instant: 'N/A',
        error: 'Failed to fetch gas stats',
      },
      { status: 500 }
    );
  }
}
