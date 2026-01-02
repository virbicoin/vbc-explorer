// GeckoTerminal Token Info API - Returns token information
// Format: https://docs.geckoterminal.com/reference/get_networks-network-tokens-address
// Optimized with centralized caching
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, Contract, DexSwap } from '@/models/index';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import {
  getCachedTokenInfo,
  getCachedPoolInfo,
  getWrappedNativeAddress,
  getUSDTAddress,
  getLPAddresses,
  getProvider,
} from '@/lib/dex/cache-service';
import {
  getVbcPriceFromDex,
  getTokenPriceUsd,
  ADDRESSES,
  isStablecoin,
} from '@/lib/dex/priceUtils';

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

const ERC20_ABI = ['function totalSupply() external view returns (uint256)'];

// Response cache
const TOKEN_CACHE_PREFIX = 'geckoterminal:token:';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address: tokenAddress } = await params;

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    // Validate address
    if (!ethers.isAddress(tokenAddress)) {
      return errorResponse(400, 'Invalid token address');
    }

    const normalizedAddress = tokenAddress.toLowerCase();

    // Check response cache
    const cacheKey = `${TOKEN_CACHE_PREFIX}${normalizedAddress}`;
    const cached = apiCache.get<object>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: API_HEADERS });
    }

    const wrappedNativeAddress = getWrappedNativeAddress();
    const usdtAddress = getUSDTAddress();
    const networkSlug = 'virbicoin';

    // Connect to database
    await connectDB();

    // Get token info (cached)
    const tokenInfo = await getCachedTokenInfo(normalizedAddress);
    if (!tokenInfo) {
      return errorResponse(404, 'Token not found');
    }

    const { symbol, name, decimals } = tokenInfo;

    // Get total supply
    const provider = getProvider();
    let totalSupply = BigInt(0);
    try {
      const tokenContract = new ethers.Contract(normalizedAddress, ERC20_ABI, provider);
      totalSupply = await tokenContract.totalSupply().catch(() => BigInt(0));
    } catch {
      // Ignore
    }

    const isWrappedNative = normalizedAddress === wrappedNativeAddress;
    const displaySymbol = symbol === 'WVBC' ? 'VBC' : symbol;
    const displayName = name === 'Wrapped VBC' ? 'VirBiCoin' : name;

    // Get token info from Contract collection
    const contractInfo = await Contract.findOne({ address: normalizedAddress }).lean();

    // Calculate token price in USD using DEX prices
    let priceUsd: string | null = null;
    let fdvUsd: string | null = null;
    let totalReserveInUsd = '0';
    let volume24h = '0';

    // Get VBC price from DEX (not external API)
    const vbcPriceUsd = await getVbcPriceFromDex();

    if (isWrappedNative || symbol === 'VBC') {
      // Native token (VBC) - use DEX price
      priceUsd = vbcPriceUsd.toString();
      if (vbcPriceUsd > 0 && totalSupply > 0n) {
        const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
        fdvUsd = (totalSupplyNum * vbcPriceUsd).toFixed(2);
      }
    } else if (normalizedAddress === usdtAddress || symbol === 'USDT') {
      // USDT - stablecoin is always 1.0
      priceUsd = '1';
      if (totalSupply > 0n) {
        const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
        fdvUsd = totalSupplyNum.toFixed(2);
      }
    } else if (isStablecoin(symbol)) {
      // Other stablecoins
      priceUsd = '1';
      if (totalSupply > 0n) {
        const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
        fdvUsd = totalSupplyNum.toFixed(2);
      }
    } else {
      // Other tokens - calculate from DEX pools
      const tokenPrice = await getTokenPriceUsd(normalizedAddress);
      if (tokenPrice > 0) {
        priceUsd = tokenPrice.toString();
        if (totalSupply > 0n) {
          const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
          fdvUsd = (totalSupplyNum * tokenPrice).toFixed(2);
        }
      } else {
        // Fallback: try to find from pools directly
        const lpAddresses = await getLPAddresses();

        for (const lpAddress of lpAddresses) {
          try {
            const poolInfo = await getCachedPoolInfo(lpAddress);
            if (!poolInfo) continue;

            const { token0, token1, reserve0, reserve1 } = poolInfo;

            if (
              token0.address.toLowerCase() === normalizedAddress ||
              token1.address.toLowerCase() === normalizedAddress
            ) {
              const isToken0 = token0.address.toLowerCase() === normalizedAddress;
              const pairedToken = isToken0
                ? token1.address.toLowerCase()
                : token0.address.toLowerCase();

              const reserveNum0 = Number(ethers.formatUnits(reserve0, token0.decimals));
              const reserveNum1 = Number(ethers.formatUnits(reserve1, token1.decimals));

              // Paired with USDT
              if (pairedToken === usdtAddress) {
                const tokenPrice = isToken0 ? reserveNum1 / reserveNum0 : reserveNum0 / reserveNum1;
                priceUsd = tokenPrice.toString();
                const tokenReserve = isToken0 ? reserveNum0 : reserveNum1;
                totalReserveInUsd = (tokenReserve * tokenPrice * 2).toFixed(2);
              } else if (pairedToken === wrappedNativeAddress && vbcPriceUsd > 0) {
                // Paired with VBC
                const tokenPrice = isToken0
                  ? (reserveNum1 / reserveNum0) * vbcPriceUsd
                  : (reserveNum0 / reserveNum1) * vbcPriceUsd;
                priceUsd = tokenPrice.toString();
                const tokenReserve = isToken0 ? reserveNum0 : reserveNum1;
                totalReserveInUsd = (tokenReserve * tokenPrice * 2).toFixed(2);
              }

              if (priceUsd) break;
            }
          } catch {
            continue;
          }
        }

        // Calculate FDV if we have price
        if (priceUsd && totalSupply > 0n) {
          const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
          fdvUsd = (totalSupplyNum * parseFloat(priceUsd)).toFixed(2);
        }
      }
    }

    // Get 24h volume for this token (use aggregation cache)
    const volumeCacheKey = `token_volume:${normalizedAddress}`;
    const cachedVolume = apiCache.get<string>(volumeCacheKey);
    if (cachedVolume) {
      volume24h = cachedVolume;
    } else {
      const h24Ago = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
      const volumeAgg = await DexSwap.aggregate([
        {
          $match: {
            $or: [{ token0: normalizedAddress }, { token1: normalizedAddress }],
            timestamp: { $gte: h24Ago },
          },
        },
        {
          $group: {
            _id: null,
            totalVolume: { $sum: '$amountUSD' },
          },
        },
      ]);

      if (volumeAgg.length > 0) {
        volume24h = volumeAgg[0].totalVolume.toFixed(2);
      }
      apiCache.set(volumeCacheKey, volume24h, CACHE_TTL.SHORT);
    }

    // Determine coingecko_coin_id
    let coingeckoCoinId: string | null = null;
    if (isWrappedNative || symbol === 'VBC') {
      coingeckoCoinId = null; // VirBiCoin not on CoinGecko
    } else if (normalizedAddress === usdtAddress || symbol === 'USDT') {
      coingeckoCoinId = 'tether';
    }

    // Get pools that include this token (use cached pool info)
    const pools: Array<{ id: string; type: string }> = [];
    const lpAddresses = await getLPAddresses();

    for (const lpAddress of lpAddresses) {
      try {
        const poolInfo = await getCachedPoolInfo(lpAddress);
        if (!poolInfo) continue;

        if (
          poolInfo.token0.address.toLowerCase() === normalizedAddress ||
          poolInfo.token1.address.toLowerCase() === normalizedAddress
        ) {
          pools.push({
            id: `${networkSlug}_${lpAddress.toLowerCase()}`,
            type: 'pool',
          });
        }
      } catch {
        continue;
      }
    }

    const response = {
      data: {
        id: `${networkSlug}_${normalizedAddress}`,
        type: 'token',
        attributes: {
          address: normalizedAddress,
          name: displayName,
          symbol: displaySymbol,
          decimals: Number(decimals),
          image_url: contractInfo?.image_url || null,
          coingecko_coin_id: coingeckoCoinId,
          websites: [],
          description: contractInfo?.description || null,
          gt_score: null,
          discord_url: null,
          telegram_handle: null,
          twitter_handle: null,
          total_supply: totalSupply.toString(),
          price_usd: priceUsd,
          fdv_usd: fdvUsd,
          total_reserve_in_usd: totalReserveInUsd,
          volume_usd: {
            h24: volume24h,
          },
        },
        relationships: {
          top_pools: {
            data: pools.slice(0, 10),
          },
        },
      },
    };

    // Cache response for 30 seconds
    apiCache.set(cacheKey, response, CACHE_TTL.SHORT);

    return NextResponse.json(response, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Token API error:', error);
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
