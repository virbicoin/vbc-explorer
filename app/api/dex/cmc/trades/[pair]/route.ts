import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import dbConnect from '@/lib/db';
import { requireDb, tryGetDb } from '@/lib/db/get-db';
import { loadConfig } from '@/lib/config';

interface LpToken {
  address: string;
  name: string;
  symbol: string;
  token0: string;
  token1: string;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// CoinMarketCap DEX Trades API
// Returns recent trades for a specific trading pair

const PAIR_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface Trade {
  trade_id: string;
  price: string;
  base_volume: string;
  quote_volume: string;
  timestamp: number;
  type: 'buy' | 'sell';
}

export async function GET(request: Request, { params }: { params: Promise<{ pair: string }> }) {
  try {
    const { pair } = await params;
    const [base, quote] = pair.toUpperCase().split('_');

    if (!base || !quote) {
      return NextResponse.json(
        { error: 'Invalid pair format. Use BASE_QUOTE (e.g., VBCG_VBC)' },
        { status: 400 }
      );
    }

    // Find the matching LP token
    const config = loadConfig();
    const lpTokens = (config.dex?.lpTokens || {}) as Record<string, LpToken>;
    const wrappedSymbol = config.dex?.wrappedNative?.symbol || 'WVBC';
    const nativeSymbol = config.currency?.symbol || 'VBC';
    let matchedPair: { address: string; token0: string; token1: string } | null = null;

    for (const [, lpToken] of Object.entries(lpTokens)) {
      const t0 = lpToken.token0 === wrappedSymbol ? nativeSymbol : lpToken.token0;
      const t1 = lpToken.token1 === wrappedSymbol ? nativeSymbol : lpToken.token1;

      if ((t0 === base && t1 === quote) || (t0 === quote && t1 === base)) {
        matchedPair = {
          address: lpToken.address,
          token0: lpToken.token0,
          token1: lpToken.token1,
        };
        break;
      }
    }

    if (!matchedPair) {
      return NextResponse.json({ error: 'Trading pair not found' }, { status: 404 });
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const pairContract = new ethers.Contract(matchedPair.address, PAIR_ABI, provider);

    const token0Address = await pairContract.token0();
    const token1Address = await pairContract.token1();

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
      token0Contract.symbol(),
      token0Contract.decimals(),
      token1Contract.symbol(),
      token1Contract.decimals(),
    ]);

    const displaySymbol0 = symbol0 === wrappedSymbol ? nativeSymbol : symbol0;
    const displaySymbol1 = symbol1 === wrappedSymbol ? nativeSymbol : symbol1;
    const isToken0Base = displaySymbol0 === base;

    // Get recent trades from database
    await dbConnect();

    // Wait for DB to be ready
    if (!tryGetDb()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const db = requireDb();

    const swaps = await db
      .collection('dex_swaps')
      .find({
        pair: matchedPair.address.toLowerCase(),
      })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    const trades: Trade[] = [];

    for (const swap of swaps) {
      try {
        let baseVolume: number;
        let quoteVolume: number;
        let tradeType: 'buy' | 'sell';

        const tokenInIsToken0 = swap.tokenIn?.toLowerCase() === token0Address.toLowerCase();

        if (isToken0Base) {
          if (tokenInIsToken0) {
            // Selling base (token0) for quote (token1)
            baseVolume = Number(ethers.formatUnits(swap.amountIn || 0, decimals0));
            quoteVolume = Number(ethers.formatUnits(swap.amountOut || 0, decimals1));
            tradeType = 'sell';
          } else {
            // Buying base (token0) with quote (token1)
            baseVolume = Number(ethers.formatUnits(swap.amountOut || 0, decimals0));
            quoteVolume = Number(ethers.formatUnits(swap.amountIn || 0, decimals1));
            tradeType = 'buy';
          }
        } else {
          if (tokenInIsToken0) {
            // Buying base (token1) with quote (token0)
            baseVolume = Number(ethers.formatUnits(swap.amountOut || 0, decimals1));
            quoteVolume = Number(ethers.formatUnits(swap.amountIn || 0, decimals0));
            tradeType = 'buy';
          } else {
            // Selling base (token1) for quote (token0)
            baseVolume = Number(ethers.formatUnits(swap.amountIn || 0, decimals1));
            quoteVolume = Number(ethers.formatUnits(swap.amountOut || 0, decimals0));
            tradeType = 'sell';
          }
        }

        if (baseVolume > 0) {
          const price = quoteVolume / baseVolume;

          trades.push({
            trade_id: swap.txHash || swap._id.toString(),
            price: price.toFixed(18),
            base_volume: baseVolume.toFixed(8),
            quote_volume: quoteVolume.toFixed(8),
            timestamp: swap.timestamp,
            type: tradeType,
          });
        }
      } catch (error) {
        console.error('Error processing swap:', error);
      }
    }

    return NextResponse.json(trades, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=10',
      },
    });
  } catch (error) {
    console.error('CMC Trades API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
