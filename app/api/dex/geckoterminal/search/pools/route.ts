// GeckoTerminal Search Pools API - Search for pools by query
// Format: https://docs.geckoterminal.com/reference/get_search-pools
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB } from '@/models/index';
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
    const query = (searchParams.get('query') || '').trim().toLowerCase().slice(0, 100); // Max 100 chars
    const pageRaw = parseInt(searchParams.get('page') || '1');
    const page = Math.max(1, Math.min(isNaN(pageRaw) ? 1 : pageRaw, 100)); // 1-100 range

    if (!query) {
      return errorResponse(400, 'query parameter is required');
    }

    if (query.length < 2) {
      return errorResponse(400, 'query must be at least 2 characters');
    }

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

    // Get all LP pools from config
    const lpTokens = (config.dex?.lpTokens || {}) as Record<
      string,
      { address: string; name?: string }
    >;
    const lpAddresses = Object.values(lpTokens).map((lp) => lp.address.toLowerCase());

    const matchingPools = [];

    // Search through pools
    for (const lpAddress of lpAddresses) {
      try {
        const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);
        const [reserves, token0Addr, token1Addr] = await Promise.all([
          pairContract.getReserves(),
          pairContract.token0(),
          pairContract.token1(),
        ]);

        const token0Contract = new ethers.Contract(token0Addr, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Addr, ERC20_ABI, provider);

        const [symbol0, name0, decimals0, symbol1, name1, decimals1] = await Promise.all([
          token0Contract.symbol(),
          token0Contract.name(),
          token0Contract.decimals(),
          token1Contract.symbol(),
          token1Contract.name(),
          token1Contract.decimals(),
        ]);

        // Check if query matches pool name, token symbols, or addresses
        const poolName = `${symbol0}/${symbol1}`;
        const searchableText = [
          poolName.toLowerCase(),
          symbol0.toLowerCase(),
          symbol1.toLowerCase(),
          name0.toLowerCase(),
          name1.toLowerCase(),
          lpAddress,
          token0Addr.toLowerCase(),
          token1Addr.toLowerCase(),
        ].join(' ');

        if (!searchableText.includes(query)) {
          continue;
        }

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

        matchingPools.push({
          id: `${networkSlug}_${lpAddress}`,
          type: 'pool',
          attributes: {
            name: `${baseSymbol}/${quoteSymbol}`,
            address: lpAddress,
            base_token_price_usd: vbcPriceUsd > 0 ? vbcPriceUsd.toString() : null,
            quote_token_price_usd: null,
            reserve_in_usd: reserveUsd,
            pool_created_at: null,
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
            network: {
              data: { id: networkSlug, type: 'network' },
            },
          },
        });
      } catch (error) {
        console.error(`Error processing pool ${lpAddress}:`, error);
      }
    }

    // Paginate results
    const startIndex = (page - 1) * 10;
    const paginatedPools = matchingPools.slice(startIndex, startIndex + 10);

    return NextResponse.json({ data: paginatedPools }, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Search Pools API error:', error);
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
