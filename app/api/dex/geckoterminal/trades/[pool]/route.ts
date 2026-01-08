// GeckoTerminal Trades API - Returns recent trades for a pool
// Format: https://docs.geckoterminal.com/reference/get_networks-network-pools-pool_address-trades
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap, Contract } from '@/models/index';
import { getNativePrice } from '@/lib/price-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GeckoTerminal API headers
const API_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Cache-Control': 'public, max-age=10',
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
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface TradeData {
  id: string;
  type: string;
  attributes: {
    block_number: number;
    tx_hash: string;
    tx_from_address: string;
    from_token_address: string;
    from_token_amount: string;
    to_token_address: string;
    to_token_amount: string;
    price_from_in_currency_token: string;
    price_to_in_currency_token: string;
    price_from_in_usd: string | null;
    price_to_in_usd: string | null;
    block_timestamp: string;
    kind: 'buy' | 'sell';
    volume_in_usd: string | null;
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ pool: string }> }) {
  try {
    const { pool: poolAddress } = await params;
    const { searchParams } = new URL(request.url);

    // GeckoTerminal parameters with validation
    const volumeRaw = parseFloat(searchParams.get('trade_volume_in_usd_greater_than') || '0');
    const tradeVolumeInUsdGreaterThan = Math.max(0, isNaN(volumeRaw) ? 0 : volumeRaw);

    const limitRaw = parseInt(searchParams.get('limit') || '50');
    const limit = Math.max(1, Math.min(isNaN(limitRaw) ? 50 : limitRaw, 300)); // 1-300 range

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    // Validate address
    if (!ethers.isAddress(poolAddress)) {
      return errorResponse(400, 'Invalid pool address');
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const wrappedNativeSymbol = config.dex?.wrappedNative?.symbol || 'WETH';
    const networkSlug = config.network?.slug || 'ethereum';

    // Connect to database
    await connectDB();

    // Get pool token info
    const pairContract = new ethers.Contract(poolAddress, PAIR_ABI, provider);

    let token0Address, token1Address;
    try {
      [token0Address, token1Address] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
      ]);
    } catch {
      return errorResponse(404, 'Pool not found');
    }

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
      token0Contract.symbol(),
      token0Contract.decimals(),
      token1Contract.symbol(),
      token1Contract.decimals(),
    ]);

    // Determine base/quote tokens (native is always base)
    const isToken0Native =
      token0Address.toLowerCase() === wrappedNativeAddress || symbol0 === wrappedNativeSymbol;
    const baseAddress = isToken0Native ? token0Address : token1Address;
    const quoteAddress = isToken0Native ? token1Address : token0Address;
    const baseDecimals = isToken0Native ? Number(decimals0) : Number(decimals1);
    const quoteDecimals = isToken0Native ? Number(decimals1) : Number(decimals0);

    // Get native price for USD calculations
    let nativePriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      nativePriceUsd = priceData.priceUSD;
    }

    // Build query
    const query: Record<string, unknown> = {
      pair: poolAddress.toLowerCase(),
    };

    if (tradeVolumeInUsdGreaterThan > 0) {
      query.amountUSD = { $gt: tradeVolumeInUsdGreaterThan };
    }

    // Fetch trades from database
    const swaps = await DexSwap.find(query)
      .sort({ timestamp: -1, blockNumber: -1 })
      .limit(limit)
      .lean();

    // Build trade data array
    const trades: TradeData[] = [];

    for (const swap of swaps) {
      const amount0In = BigInt(swap.amount0In || '0');
      const amount1In = BigInt(swap.amount1In || '0');
      const amount0Out = BigInt(swap.amount0Out || '0');
      const amount1Out = BigInt(swap.amount1Out || '0');

      // Determine trade direction
      // Buy (base) = token0 out (if token0 is base) or token1 out (if token1 is base)
      // Sell (base) = token0 in (if token0 is base) or token1 in (if token1 is base)
      let kind: 'buy' | 'sell';
      let fromTokenAddress: string;
      let toTokenAddress: string;
      let fromAmount: string;
      let toAmount: string;

      if (isToken0Native) {
        // token0 is base (native)
        if (amount0Out > 0n) {
          // Buying native (trading quote for base)
          kind = 'buy';
          fromTokenAddress = quoteAddress.toLowerCase();
          toTokenAddress = baseAddress.toLowerCase();
          fromAmount = ethers.formatUnits(amount1In, quoteDecimals);
          toAmount = ethers.formatUnits(amount0Out, baseDecimals);
        } else {
          // Selling native (trading base for quote)
          kind = 'sell';
          fromTokenAddress = baseAddress.toLowerCase();
          toTokenAddress = quoteAddress.toLowerCase();
          fromAmount = ethers.formatUnits(amount0In, baseDecimals);
          toAmount = ethers.formatUnits(amount1Out, quoteDecimals);
        }
      } else {
        // token1 is base (native)
        if (amount1Out > 0n) {
          // Buying native
          kind = 'buy';
          fromTokenAddress = quoteAddress.toLowerCase();
          toTokenAddress = baseAddress.toLowerCase();
          fromAmount = ethers.formatUnits(amount0In, quoteDecimals);
          toAmount = ethers.formatUnits(amount1Out, baseDecimals);
        } else {
          // Selling native
          kind = 'sell';
          fromTokenAddress = baseAddress.toLowerCase();
          toTokenAddress = quoteAddress.toLowerCase();
          fromAmount = ethers.formatUnits(amount1In, baseDecimals);
          toAmount = ethers.formatUnits(amount0Out, quoteDecimals);
        }
      }

      // Calculate prices
      const fromAmountNum = parseFloat(fromAmount);
      const toAmountNum = parseFloat(toAmount);

      let priceFromInCurrency = '0';
      let priceToInCurrency = '0';
      let priceFromInUsd: string | null = null;
      let priceToInUsd: string | null = null;

      if (fromAmountNum > 0 && toAmountNum > 0) {
        priceFromInCurrency = (toAmountNum / fromAmountNum).toString();
        priceToInCurrency = (fromAmountNum / toAmountNum).toString();

        if (nativePriceUsd > 0) {
          // If from is base (native), price in USD = native price
          if (fromTokenAddress === baseAddress.toLowerCase()) {
            priceFromInUsd = nativePriceUsd.toString();
            priceToInUsd = ((fromAmountNum / toAmountNum) * nativePriceUsd).toString();
          } else {
            priceToInUsd = nativePriceUsd.toString();
            priceFromInUsd = ((toAmountNum / fromAmountNum) * nativePriceUsd).toString();
          }
        }
      }

      const volumeInUsd = swap.amountUSD ? swap.amountUSD.toString() : null;

      trades.push({
        id: `${networkSlug}_${swap.hash}`,
        type: 'trade',
        attributes: {
          block_number: swap.blockNumber,
          tx_hash: swap.hash,
          tx_from_address: (swap.sender || '').toLowerCase(),
          from_token_address: fromTokenAddress,
          from_token_amount: fromAmount,
          to_token_address: toTokenAddress,
          to_token_amount: toAmount,
          price_from_in_currency_token: priceFromInCurrency,
          price_to_in_currency_token: priceToInCurrency,
          price_from_in_usd: priceFromInUsd,
          price_to_in_usd: priceToInUsd,
          block_timestamp: new Date(swap.timestamp * 1000).toISOString(),
          kind,
          volume_in_usd: volumeInUsd,
        },
      });
    }

    return NextResponse.json({ data: trades }, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Trades API error:', error);
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
