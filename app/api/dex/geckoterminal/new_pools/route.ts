// GeckoTerminal New Pools API - Returns recently created pools
// Format: https://docs.geckoterminal.com/reference/get_networks-network-new_pools
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap } from '@/models/index';
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
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageRaw = parseInt(searchParams.get('page') || '1');
    const page = Math.max(1, Math.min(isNaN(pageRaw) ? 1 : pageRaw, 100)); // 1-100 range

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const networkSlug = 'virbicoin';

    await connectDB();

    // Get VBC price
    let vbcPriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      vbcPriceUsd = priceData.priceUSD;
    }

    // Get all LP pools from config - these are "new" since VBC DEX is relatively new
    const lpTokens = (config.dex?.lpTokens || {}) as Record<string, { address: string }>;
    const lpAddresses = Object.values(lpTokens).map((lp) => lp.address.toLowerCase());

    // For a small DEX, we return all pools sorted by first swap (earliest = newest conceptually)
    // In production, you'd track pool creation events
    const firstSwaps = await DexSwap.aggregate([
      { $match: { pair: { $in: lpAddresses } } },
      { $group: { _id: '$pair', firstSwap: { $min: '$timestamp' } } },
      { $sort: { firstSwap: -1 } },
      { $skip: (page - 1) * 10 },
      { $limit: 10 },
    ]);

    const pools = [];

    for (const poolData of firstSwaps) {
      try {
        const lpAddress = poolData._id;
        const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);
        const [reserves, token0Addr, token1Addr] = await Promise.all([
          pairContract.getReserves(),
          pairContract.token0(),
          pairContract.token1(),
        ]);

        const token0Contract = new ethers.Contract(token0Addr, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Addr, ERC20_ABI, provider);

        const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
          token0Contract.symbol(),
          token0Contract.decimals(),
          token1Contract.symbol(),
          token1Contract.decimals(),
        ]);

        const isToken0VBC = token0Addr.toLowerCase() === wrappedNativeAddress;
        const baseSymbol = isToken0VBC ? (symbol0 === 'WVBC' ? 'VBC' : symbol0) : symbol1;
        const quoteSymbol = isToken0VBC ? symbol1 : symbol1 === 'WVBC' ? 'VBC' : symbol0;
        const baseAddress = isToken0VBC ? token0Addr : token1Addr;
        const quoteAddress = isToken0VBC ? token1Addr : token0Addr;

        const reserve0Num = Number(ethers.formatUnits(reserves[0], decimals0));
        const reserve1Num = Number(ethers.formatUnits(reserves[1], decimals1));

        let reserveUsd = '0';
        if (isToken0VBC && vbcPriceUsd > 0) {
          reserveUsd = (reserve0Num * vbcPriceUsd * 2).toFixed(2);
        } else if (!isToken0VBC && vbcPriceUsd > 0) {
          reserveUsd = (reserve1Num * vbcPriceUsd * 2).toFixed(2);
        }

        // Convert first swap timestamp to ISO date
        const createdAt = poolData.firstSwap
          ? new Date(poolData.firstSwap * 1000).toISOString()
          : null;

        pools.push({
          id: `${networkSlug}_${lpAddress}`,
          type: 'pool',
          attributes: {
            name: `${baseSymbol}/${quoteSymbol}`,
            address: lpAddress,
            base_token_price_usd: vbcPriceUsd > 0 ? vbcPriceUsd.toString() : null,
            quote_token_price_usd: null,
            reserve_in_usd: reserveUsd,
            pool_created_at: createdAt,
          },
          relationships: {
            base_token: {
              data: { id: `${networkSlug}_${baseAddress.toLowerCase()}`, type: 'token' },
            },
            quote_token: {
              data: { id: `${networkSlug}_${quoteAddress.toLowerCase()}`, type: 'token' },
            },
            dex: {
              data: { id: `${networkSlug}_dex`, type: 'dex' },
            },
          },
        });
      } catch (error) {
        console.error(`Error processing pool ${poolData._id}:`, error);
      }
    }

    return NextResponse.json({ data: pools }, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal New Pools API error:', error);
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
