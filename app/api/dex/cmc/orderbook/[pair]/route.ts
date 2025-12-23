import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
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

// CoinMarketCap DEX Orderbook API
// For AMM DEXes, we simulate orderbook based on price impact at various depths

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface OrderbookEntry {
  price: string;
  quantity: string;
}

interface OrderbookResponse {
  timestamp: number;
  bids: [string, string][];
  asks: [string, string][];
}

// Calculate price impact for AMM
function calculatePriceImpact(
  amountIn: number,
  reserveIn: number,
  reserveOut: number
): { amountOut: number; price: number } {
  const amountInWithFee = amountIn * 997;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000 + amountInWithFee;
  const amountOut = numerator / denominator;
  const price = amountIn / amountOut;
  return { amountOut, price };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ pair: string }> }
) {
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
    let matchedPair: { address: string; token0: string; token1: string } | null = null;

    for (const [, lpToken] of Object.entries(lpTokens)) {
      const t0 = lpToken.token0 === 'WVBC' ? 'VBC' : lpToken.token0;
      const t1 = lpToken.token1 === 'WVBC' ? 'VBC' : lpToken.token1;
      
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
      return NextResponse.json(
        { error: 'Trading pair not found' },
        { status: 404 }
      );
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const pairContract = new ethers.Contract(matchedPair.address, PAIR_ABI, provider);

    const [reserve0, reserve1] = await pairContract.getReserves();
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

    const reserve0Num = Number(ethers.formatUnits(reserve0, decimals0));
    const reserve1Num = Number(ethers.formatUnits(reserve1, decimals1));

    // Determine which token is base and which is quote
    const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
    const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;
    
    const isToken0Base = displaySymbol0 === base;
    const baseReserve = isToken0Base ? reserve0Num : reserve1Num;
    const quoteReserve = isToken0Base ? reserve1Num : reserve0Num;

    // Generate simulated orderbook based on AMM price curve
    // We create price levels at various depths (0.1%, 0.5%, 1%, 2%, 5%, 10% of liquidity)
    const depths = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1];
    const bids: [string, string][] = [];
    const asks: [string, string][] = [];

    const currentPrice = quoteReserve / baseReserve;

    for (const depth of depths) {
      // Asks (selling base for quote)
      // When selling base, you get quote. Price = quote received / base sold
      const sellAmount = baseReserve * depth;
      const sellResult = calculatePriceImpact(sellAmount, baseReserve, quoteReserve);
      const askPrice = sellResult.amountOut / sellAmount; // quote per base
      asks.push([askPrice.toFixed(18), sellAmount.toFixed(8)]);

      // Bids (buying base with quote)
      // When buying base with quote. Price = quote spent / base received
      const buyQuoteAmount = quoteReserve * depth;
      const buyResult = calculatePriceImpact(buyQuoteAmount, quoteReserve, baseReserve);
      const bidPrice = buyQuoteAmount / buyResult.amountOut; // quote per base
      bids.push([bidPrice.toFixed(18), buyResult.amountOut.toFixed(8)]);
    }

    // Sort bids descending, asks ascending
    bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

    const response: OrderbookResponse = {
      timestamp: Math.floor(Date.now() / 1000),
      bids,
      asks,
    };

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=10',
      },
    });
  } catch (error) {
    console.error('CMC Orderbook API error:', error);
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
