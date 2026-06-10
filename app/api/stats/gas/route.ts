import { NextResponse } from 'next/server';
import { getWeb3 } from '../../../../lib/web3';
import dbConnect from '../../../../lib/db';
import { tryGetDb } from '../../../../lib/db/get-db';
import { getGasUnitServer } from '../../../../lib/config';

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

    const blockNumber = Number(latestBlock.number);
    let gasPrices: bigint[] = [];

    // First try to get gas prices from database (more reliable for low-traffic chains)
    try {
      await dbConnect();
      const db = tryGetDb();
      if (db) {
        // Get gas prices from recent transactions in database
        const recentTxs = await db
          .collection('Transaction')
          .find({ gasPrice: { $exists: true, $ne: null } })
          .sort({ blockNumber: -1 })
          .limit(500)
          .project({ gasPrice: 1 })
          .toArray();

        for (const tx of recentTxs) {
          if (tx.gasPrice) {
            const price = BigInt(tx.gasPrice.toString());
            if (price > 0n) {
              gasPrices.push(price);
            }
          }
        }
      }
    } catch (dbError) {
      console.error('Error fetching gas prices from DB:', dbError);
    }

    // If no data from DB, try fetching from recent blocks via RPC
    if (gasPrices.length === 0) {
      const blocksToFetch = Math.min(50, blockNumber);
      const blockPromises: Promise<void>[] = [];

      for (let i = 0; i < blocksToFetch; i++) {
        blockPromises.push(
          (async () => {
            try {
              const block = await web3.eth.getBlock(blockNumber - i, true);
              if (block && block.transactions) {
                for (const tx of block.transactions) {
                  if (typeof tx === 'object' && tx.gasPrice) {
                    const price = BigInt(tx.gasPrice.toString());
                    if (price > 0n) {
                      gasPrices.push(price);
                    }
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
    }

    // Get gas unit from config
    const gasUnit = getGasUnitServer();

    // Calculate percentiles
    let slow = `0 ${gasUnit}`;
    let standard = `0 ${gasUnit}`;
    let fast = `0 ${gasUnit}`;
    let instant = `0 ${gasUnit}`;

    if (gasPrices.length > 0) {
      // Sort gas prices
      gasPrices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const getPercentile = (arr: bigint[], percentile: number): bigint => {
        const index = Math.floor((arr.length - 1) * (percentile / 100));
        return arr[index];
      };

      const formatGasPrice = (wei: bigint): string => {
        const gwei = Number(wei) / 1e9;
        if (gwei < 0.01) return `<0.01 ${gasUnit}`;
        if (gwei < 1) return `${gwei.toFixed(2)} ${gasUnit}`;
        if (gwei < 100) return `${gwei.toFixed(1)} ${gasUnit}`;
        return `${Math.round(gwei)} ${gasUnit}`;
      };

      slow = formatGasPrice(getPercentile(gasPrices, 10));
      standard = formatGasPrice(getPercentile(gasPrices, 50));
      fast = formatGasPrice(getPercentile(gasPrices, 75));
      instant = formatGasPrice(getPercentile(gasPrices, 95));
    } else {
      // If still no data, use default minimum gas price
      slow = `1 ${gasUnit}`;
      standard = `1 ${gasUnit}`;
      fast = `1 ${gasUnit}`;
      instant = `1 ${gasUnit}`;
    }

    // Get base fee if available (EIP-1559)
    let baseFee: string | undefined;
    if (latestBlock.baseFeePerGas) {
      const baseFeeValue = Number(latestBlock.baseFeePerGas) / 1e9;
      baseFee =
        baseFeeValue < 1
          ? `${baseFeeValue.toFixed(2)} ${gasUnit}`
          : `${Math.round(baseFeeValue)} ${gasUnit}`;
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
