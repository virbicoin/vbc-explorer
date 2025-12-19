import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import config from '@/config.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// CoinMarketCap DEX Summary API
// Returns trading pair summary for all available pairs

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface PairSummary {
  trading_pairs: string;
  base_currency: string;
  quote_currency: string;
  last_price: number;
  lowest_ask: number;
  highest_bid: number;
  base_volume: number;
  quote_volume: number;
  price_change_percent_24h: number;
  highest_price_24h: number;
  lowest_price_24h: number;
}

// Cache for API responses
let summaryCache: { data: Record<string, PairSummary>; timestamp: number } | null = null;
const CACHE_DURATION = 60000; // 1 minute

export async function GET() {
  try {
    // Check cache
    if (summaryCache && Date.now() - summaryCache.timestamp < CACHE_DURATION) {
      return NextResponse.json(summaryCache.data, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    const provider = new ethers.JsonRpcProvider(config.network.rpcUrl);

    // Get LP tokens from config
    const lpTokens = config.dex.lpTokens as Record<string, {
      address: string;
      name: string;
      symbol: string;
      token0: string;
      token1: string;
    }>;
    
    const summary: Record<string, PairSummary> = {};

    for (const [key, lpToken] of Object.entries(lpTokens)) {
      try {
        const pairContract = new ethers.Contract(lpToken.address, PAIR_ABI, provider);
        
        // Get reserves
        const reserves = await pairContract.getReserves();
        const reserve0 = reserves[0];
        const reserve1 = reserves[1];
        const token0Address = await pairContract.token0();
        const token1Address = await pairContract.token1();

        // Get token info
        const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

        const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
          token0Contract.symbol(),
          token0Contract.decimals(),
          token1Contract.symbol(),
          token1Contract.decimals(),
        ]);

        // Calculate price
        const reserve0Formatted = Number(ethers.formatUnits(reserve0, decimals0));
        const reserve1Formatted = Number(ethers.formatUnits(reserve1, decimals1));
        
        if (reserve0Formatted === 0 || reserve1Formatted === 0) continue;

        const price = reserve1Formatted / reserve0Formatted;

        // Format pair name (WVBC -> VBC for display)
        const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
        const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;
        const pairName = `${displaySymbol0}_${displaySymbol1}`;

        summary[pairName] = {
          trading_pairs: pairName,
          base_currency: displaySymbol0,
          quote_currency: displaySymbol1,
          last_price: price,
          lowest_ask: price * 1.003, // 0.3% spread approximation for AMM
          highest_bid: price * 0.997,
          base_volume: 0, // Volume tracking requires database
          quote_volume: 0,
          price_change_percent_24h: 0,
          highest_price_24h: price,
          lowest_price_24h: price,
        };
      } catch (error) {
        console.error(`Error processing pair ${key}:`, error);
      }
    }

    // Update cache
    summaryCache = { data: summary, timestamp: Date.now() };

    return NextResponse.json(summary, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('CMC Summary API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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
