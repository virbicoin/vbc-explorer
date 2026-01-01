// GeckoTerminal OHLCV API - Returns historical price data for a pool
// Format: https://docs.geckoterminal.com/reference/get_networks-network-pools-pool_address-ohlcv-timeframe
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap, Contract } from '@/models';
import { getNativePrice } from '@/lib/price-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAIR_ABI = [
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
];

// GeckoTerminal timeframe mapping (in seconds)
const TIMEFRAME_SECONDS: Record<string, number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
};

// Calculate price from swap amounts
function calculatePriceFromSwap(
  amount0In: bigint,
  amount1In: bigint,
  amount0Out: bigint,
  amount1Out: bigint,
  decimals0: number,
  decimals1: number
): number | null {
  const in0 = Number(amount0In) / 10 ** decimals0;
  const in1 = Number(amount1In) / 10 ** decimals1;
  const out0 = Number(amount0Out) / 10 ** decimals0;
  const out1 = Number(amount1Out) / 10 ** decimals1;

  // Determine swap direction and calculate price (token1 per token0)
  if (in0 > 0 && out1 > 0) {
    return out1 / in0;
  } else if (in1 > 0 && out0 > 0) {
    return in1 / out0;
  }
  return null;
}

// Aggregate swaps into OHLCV candles
function aggregateToOHLCV(
  swaps: Array<{ timestamp: number; price: number; volume: number }>,
  intervalSeconds: number,
  count: number
): Array<[number, number, number, number, number, number]> {
  if (swaps.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const candles: Array<[number, number, number, number, number, number]> = [];

  // Calculate start time (aligned to interval)
  const startTime = Math.floor((now - count * intervalSeconds) / intervalSeconds) * intervalSeconds;

  let lastClose = swaps[0]?.price || 0;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSeconds;
    const nextTime = time + intervalSeconds;

    // Get swaps in this time window
    const periodSwaps = swaps.filter((s) => s.timestamp >= time && s.timestamp < nextTime);

    if (periodSwaps.length > 0) {
      const open = periodSwaps[0].price;
      const close = periodSwaps[periodSwaps.length - 1].price;
      const high = Math.max(...periodSwaps.map((s) => s.price));
      const low = Math.min(...periodSwaps.map((s) => s.price));
      const volume = periodSwaps.reduce((sum, s) => sum + s.volume, 0);

      candles.push([time, open, high, low, close, volume]);
      lastClose = close;
    } else {
      // No trades in this period, use last close price
      candles.push([time, lastClose, lastClose, lastClose, lastClose, 0]);
    }
  }

  return candles;
}

export async function GET(request: Request, { params }: { params: Promise<{ pool: string }> }) {
  try {
    const { pool: poolAddress } = await params;
    const { searchParams } = new URL(request.url);

    // GeckoTerminal parameters
    const timeframe = searchParams.get('timeframe') || 'hour'; // minute, hour, day
    const aggregate = parseInt(searchParams.get('aggregate') || '1'); // aggregation multiplier
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 1000);
    const currency = searchParams.get('currency') || 'usd';
    const token = searchParams.get('token') || 'base'; // base or quote

    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';

    // Get pool info
    const pairContract = new ethers.Contract(poolAddress, PAIR_ABI, provider);

    const [reserves, token0Address, token1Address] = await Promise.all([
      pairContract.getReserves(),
      pairContract.token0(),
      pairContract.token1(),
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [decimals0, decimals1, symbol0, symbol1] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals(),
      token0Contract.symbol(),
      token1Contract.symbol(),
    ]);

    // Determine base/quote tokens (VBC is always base)
    const isToken0VBC = token0Address.toLowerCase() === wrappedNativeAddress;
    const baseAddress = isToken0VBC ? token0Address : token1Address;
    const quoteAddress = isToken0VBC ? token1Address : token0Address;
    const baseDecimals = isToken0VBC ? Number(decimals0) : Number(decimals1);
    const quoteDecimals = isToken0VBC ? Number(decimals1) : Number(decimals0);
    const baseSymbol = isToken0VBC ? symbol0 : symbol1;
    const quoteSymbol = isToken0VBC ? symbol1 : symbol0;

    // Calculate interval in seconds
    const baseInterval = TIMEFRAME_SECONDS[timeframe] || 3600;
    const intervalSeconds = baseInterval * aggregate;

    // Calculate time range for query
    const now = Math.floor(Date.now() / 1000);
    const startTime = now - limit * intervalSeconds;

    // Connect to database and fetch swap events
    await connectDB();

    const swapEvents = await DexSwap.find({
      pair: poolAddress.toLowerCase(),
      timestamp: { $gte: startTime },
    })
      .sort({ timestamp: 1 })
      .lean();

    // Get VBC price for USD conversion
    let vbcPriceUsd = 0;
    if (currency === 'usd') {
      const priceData = await getNativePrice();
      if (priceData) {
        vbcPriceUsd = priceData.priceUSD;
      }
    }

    // Process swap events into price/volume data
    const swaps: Array<{ timestamp: number; price: number; volume: number }> = [];

    for (const swap of swapEvents) {
      const amount0In = BigInt(swap.amount0In || '0');
      const amount1In = BigInt(swap.amount1In || '0');
      const amount0Out = BigInt(swap.amount0Out || '0');
      const amount1Out = BigInt(swap.amount1Out || '0');

      let price = calculatePriceFromSwap(
        amount0In,
        amount1In,
        amount0Out,
        amount1Out,
        Number(decimals0),
        Number(decimals1)
      );

      if (price !== null && price > 0) {
        // Invert if token0 is VBC (to get quote/base)
        if (isToken0VBC) {
          price = 1 / price;
        }

        // Calculate volume in base token terms
        let volume = 0;
        if (isToken0VBC) {
          volume = Number(amount0In + amount0Out) / 10 ** Number(decimals0);
        } else {
          volume = Number(amount1In + amount1Out) / 10 ** Number(decimals1);
        }

        // Convert to USD if requested
        if (currency === 'usd' && vbcPriceUsd > 0) {
          price = price * vbcPriceUsd;
          volume = volume * vbcPriceUsd;
        }

        swaps.push({ timestamp: swap.timestamp, price, volume });
      }
    }

    // Generate OHLCV candles
    let ohlcvList: Array<[number, number, number, number, number, number]> = [];

    if (swaps.length > 0) {
      ohlcvList = aggregateToOHLCV(swaps, intervalSeconds, limit);
    } else {
      // Fallback: Generate from current reserves if no swap data
      const reserve0 = Number(ethers.formatUnits(reserves[0], decimals0));
      const reserve1 = Number(ethers.formatUnits(reserves[1], decimals1));

      let currentPrice = isToken0VBC ? reserve1 / reserve0 : reserve0 / reserve1;

      if (currency === 'usd' && vbcPriceUsd > 0) {
        currentPrice = currentPrice * vbcPriceUsd;
      }

      const startTime = now - limit * intervalSeconds;
      for (let i = 0; i < limit; i++) {
        const time =
          Math.floor((startTime + i * intervalSeconds) / intervalSeconds) * intervalSeconds;
        ohlcvList.push([time, currentPrice, currentPrice, currentPrice, currentPrice, 0]);
      }
    }

    // Get token coingecko_coin_id from Contract collection if available
    const baseContract = await Contract.findOne({ address: baseAddress.toLowerCase() }).lean();
    const quoteContract = await Contract.findOne({ address: quoteAddress.toLowerCase() }).lean();

    return NextResponse.json(
      {
        data: {
          id: `virbicoin_${poolAddress.toLowerCase()}`,
          type: 'pool_ohlcv',
          attributes: {
            ohlcv_list: ohlcvList,
          },
        },
        meta: {
          base: {
            address: baseAddress.toLowerCase(),
            name: baseSymbol === 'WVBC' ? 'VirBiCoin' : baseContract?.tokenName || baseSymbol,
            symbol: baseSymbol === 'WVBC' ? 'VBC' : baseSymbol,
            coingecko_coin_id: null,
          },
          quote: {
            address: quoteAddress.toLowerCase(),
            name: quoteContract?.tokenName || quoteSymbol,
            symbol: quoteSymbol,
            coingecko_coin_id: null,
          },
        },
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  } catch (error) {
    console.error('GeckoTerminal OHLCV API error:', error);
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
