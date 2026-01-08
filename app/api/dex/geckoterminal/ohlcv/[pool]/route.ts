// GeckoTerminal OHLCV API - Returns historical price data for a pool
// Format: https://docs.geckoterminal.com/reference/get_networks-network-pools-pool_address-ohlcv-timeframe
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap, Contract } from '@/models';
import { getNativePrice } from '@/lib/price-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GeckoTerminal API headers
const API_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Cache-Control': 'public, max-age=60',
  'X-API-Version': '20230203',
};

// GeckoTerminal error response format
function errorResponse(status: number, title: string) {
  return NextResponse.json(
    { errors: [{ status: String(status), title }] },
    { status, headers: API_HEADERS }
  );
}

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

    // Validate pool address
    if (!ethers.isAddress(poolAddress)) {
      return errorResponse(400, 'Invalid pool address');
    }

    // GeckoTerminal parameters with validation
    const timeframeParam = searchParams.get('timeframe') || 'hour';
    const validTimeframes = ['minute', 'hour', 'day'];
    const timeframe = validTimeframes.includes(timeframeParam) ? timeframeParam : 'hour';

    const aggregateRaw = parseInt(searchParams.get('aggregate') || '1');
    const aggregate = Math.max(1, Math.min(aggregateRaw || 1, 60)); // 1-60 range

    const limitRaw = parseInt(searchParams.get('limit') || '100');
    const limit = Math.max(1, Math.min(limitRaw || 100, 1000)); // 1-1000 range

    const currencyParam = searchParams.get('currency') || 'usd';
    const currency = ['usd', 'token'].includes(currencyParam) ? currencyParam : 'usd';

    const tokenParam = searchParams.get('token') || 'base';
    const token = ['base', 'quote'].includes(tokenParam) ? tokenParam : 'base';

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const wrappedNativeSymbol = config.dex?.wrappedNative?.symbol || 'WETH';
    const nativeSymbol = config.currency?.symbol || 'ETH';
    const nativeName = config.currency?.name || 'Ether';

    // Get pool info
    const pairContract = new ethers.Contract(poolAddress, PAIR_ABI, provider);

    let reserves, token0Address, token1Address;
    try {
      [reserves, token0Address, token1Address] = await Promise.all([
        pairContract.getReserves(),
        pairContract.token0(),
        pairContract.token1(),
      ]);
    } catch {
      return errorResponse(404, 'Pool not found');
    }

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [decimals0, decimals1, symbol0, symbol1] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals(),
      token0Contract.symbol(),
      token1Contract.symbol(),
    ]);

    // Determine base/quote tokens (native is always base)
    const isToken0Native = token0Address.toLowerCase() === wrappedNativeAddress;
    const baseAddress = isToken0Native ? token0Address : token1Address;
    const quoteAddress = isToken0Native ? token1Address : token0Address;
    const baseDecimals = isToken0Native ? Number(decimals0) : Number(decimals1);
    const quoteDecimals = isToken0Native ? Number(decimals1) : Number(decimals0);
    const baseSymbol = isToken0Native ? symbol0 : symbol1;
    const quoteSymbol = isToken0Native ? symbol1 : symbol0;

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

    // Get native price for USD conversion
    let nativePriceUsd = 0;
    if (currency === 'usd') {
      const priceData = await getNativePrice();
      if (priceData) {
        nativePriceUsd = priceData.priceUSD;
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
        // Invert if token0 is native (to get quote/base)
        if (isToken0Native) {
          price = 1 / price;
        }

        // Calculate volume in base token terms
        let volume = 0;
        if (isToken0Native) {
          volume = Number(amount0In + amount0Out) / 10 ** Number(decimals0);
        } else {
          volume = Number(amount1In + amount1Out) / 10 ** Number(decimals1);
        }

        // Convert to USD if requested
        if (currency === 'usd' && nativePriceUsd > 0) {
          price = price * nativePriceUsd;
          volume = volume * nativePriceUsd;
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

      let currentPrice = isToken0Native ? reserve1 / reserve0 : reserve0 / reserve1;

      if (currency === 'usd' && nativePriceUsd > 0) {
        currentPrice = currentPrice * nativePriceUsd;
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
          id: randomUUID(),
          type: 'ohlcv_request_response',
          attributes: {
            ohlcv_list: ohlcvList,
          },
        },
        meta: {
          base: {
            address: baseAddress.toLowerCase(),
            name:
              baseSymbol === wrappedNativeSymbol
                ? nativeName
                : baseContract?.tokenName || baseSymbol,
            symbol: baseSymbol === wrappedNativeSymbol ? nativeSymbol : baseSymbol,
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
      { headers: API_HEADERS }
    );
  } catch (error) {
    console.error('GeckoTerminal OHLCV API error:', error);
    return errorResponse(500, 'Internal server error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
    },
  });
}
