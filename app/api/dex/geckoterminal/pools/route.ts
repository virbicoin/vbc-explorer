// GeckoTerminal Pools API - Returns pool data in GeckoTerminal compatible format
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap } from '@/models/index';
import { getNativePrice } from '@/lib/price-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAIR_ABI = [
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
];

interface PoolData {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string | null;
    quote_token_price_usd: string | null;
    base_token_price_native_currency: string;
    quote_token_price_native_currency: string;
    base_token_price_quote_token: string;
    quote_token_price_base_token: string;
    pool_created_at: string | null;
    reserve_in_usd: string;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    price_change_percentage: {
      m5: string;
      m15: string;
      m30: string;
      h1: string;
      h6: string;
      h24: string;
    };
    transactions: {
      m5: { buys: number; sells: number; buyers: number; sellers: number };
      m15: { buys: number; sells: number; buyers: number; sellers: number };
      m30: { buys: number; sells: number; buyers: number; sellers: number };
      h1: { buys: number; sells: number; buyers: number; sellers: number };
      h6: { buys: number; sells: number; buyers: number; sellers: number };
      h24: { buys: number; sells: number; buyers: number; sellers: number };
    };
    volume_usd: {
      m5: string;
      m15: string;
      m30: string;
      h1: string;
      h6: string;
      h24: string;
    };
  };
  relationships: {
    base_token: { data: { id: string; type: string } };
    quote_token: { data: { id: string; type: string } };
    dex: { data: { id: string; type: string } };
  };
}

// Interface for pool statistics from database
interface PoolStats {
  volume: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  txCount: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  uniqueTraders: { m5: Set<string>; m15: Set<string>; m30: Set<string>; h1: Set<string>; h6: Set<string>; h24: Set<string> };
  buys: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  sells: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  buyers: { m5: Set<string>; m15: Set<string>; m30: Set<string>; h1: Set<string>; h6: Set<string>; h24: Set<string> };
  sellers: { m5: Set<string>; m15: Set<string>; m30: Set<string>; h1: Set<string>; h6: Set<string>; h24: Set<string> };
}

// Time intervals in seconds
const TIME_INTERVALS = {
  m5: 5 * 60,
  m15: 15 * 60,
  m30: 30 * 60,
  h1: 60 * 60,
  h6: 6 * 60 * 60,
  h24: 24 * 60 * 60,
};

// Fetch pool statistics from database
async function getPoolStats(pairAddress: string): Promise<PoolStats> {
  const now = Math.floor(Date.now() / 1000);
  const stats: PoolStats = {
    volume: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    txCount: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    uniqueTraders: { m5: new Set(), m15: new Set(), m30: new Set(), h1: new Set(), h6: new Set(), h24: new Set() },
    buys: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    sells: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    buyers: { m5: new Set(), m15: new Set(), m30: new Set(), h1: new Set(), h6: new Set(), h24: new Set() },
    sellers: { m5: new Set(), m15: new Set(), m30: new Set(), h1: new Set(), h6: new Set(), h24: new Set() },
  };

  try {
    // Fetch swaps from last 24 hours
    const swaps = await DexSwap.find({
      pair: pairAddress.toLowerCase(),
      timestamp: { $gte: now - TIME_INTERVALS.h24 },
    }).lean();

    for (const swap of swaps) {
      const age = now - swap.timestamp;

      // Determine if buy or sell (amount0In > 0 means selling token0)
      const isBuy = BigInt(swap.amount0In) > 0n; // Buying base token (token1 out)
      const trader = swap.sender;

      for (const [interval, seconds] of Object.entries(TIME_INTERVALS)) {
        const key = interval as keyof typeof TIME_INTERVALS;
        if (age <= seconds) {
          stats.volume[key] += swap.amountUSD || 0;
          stats.txCount[key]++;
          stats.uniqueTraders[key].add(trader);

          if (isBuy) {
            stats.buys[key]++;
            stats.buyers[key].add(trader);
          } else {
            stats.sells[key]++;
            stats.sellers[key].add(trader);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching pool stats:', error);
  }

  return stats;
}

// Cache for responses
let poolsCache: { data: PoolData[]; timestamp: number } | null = null;
const CACHE_DURATION = 30000; // 30 seconds

export async function GET() {
  try {
    // Check cache
    if (poolsCache && Date.now() - poolsCache.timestamp < CACHE_DURATION) {
      return NextResponse.json(
        {
          data: poolsCache.data,
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=30',
          },
        }
      );
    }

    // Connect to database
    await connectDB();

    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const chainId = config.network?.chainId || 329;
    const networkSlug = 'virbicoin';

    // Get USDT address for price calculation
    const usdtAddress = config.dex?.tokens?.usdt?.address?.toLowerCase();
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase();

    // Get LP tokens from config - use both lpTokens and farmPools
    const lpTokens = (config.dex?.lpTokens || {}) as Record<
      string,
      {
        address: string;
        name: string;
        symbol: string;
        token0: string;
        token1: string;
      }
    >;

    // Also add farm pools if lpTokens is empty
    const farmPools = (config.dex?.farmPools || []) as Array<{
      pid: number;
      name: string;
      lpToken: string;
      token0Symbol: string;
      token1Symbol: string;
    }>;

    // Merge LP addresses from both sources
    const lpAddresses = new Set<string>();
    Object.values(lpTokens).forEach((lp) => lpAddresses.add(lp.address.toLowerCase()));
    farmPools.forEach((pool) => lpAddresses.add(pool.lpToken.toLowerCase()));

    const pools: PoolData[] = [];

    // Get VBC price from price service (uses Market DB first, then Exbitron)
    let vbcPriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      vbcPriceUsd = priceData.priceUSD;
    }

    // Fallback: Get VBC/USDT price from DEX if price service fails
    if (vbcPriceUsd === 0) {
      for (const lpAddress of lpAddresses) {
        try {
          const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);
          const token0Address = await pairContract.token0();
          const token1Address = await pairContract.token1();

          if (
            (token0Address.toLowerCase() === usdtAddress &&
              token1Address.toLowerCase() === wrappedNativeAddress) ||
            (token1Address.toLowerCase() === usdtAddress &&
              token0Address.toLowerCase() === wrappedNativeAddress)
          ) {
            const reserves = await pairContract.getReserves();
            const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
            const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);
            const [decimals0, decimals1] = await Promise.all([
              token0Contract.decimals(),
              token1Contract.decimals(),
            ]);

            const reserve0 = Number(ethers.formatUnits(reserves[0], decimals0));
            const reserve1 = Number(ethers.formatUnits(reserves[1], decimals1));

            if (token0Address.toLowerCase() === usdtAddress) {
              vbcPriceUsd = reserve0 / reserve1;
            } else {
              vbcPriceUsd = reserve1 / reserve0;
            }
            break;
          }
        } catch {
          // Skip if error
        }
      }
    }

    // Second pass: Build pool data
    for (const lpAddress of lpAddresses) {
      try {
        const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);

        const [reserves, token0Address, token1Address] = await Promise.all([
          pairContract.getReserves(),
          pairContract.token0(),
          pairContract.token1(),
        ]);

        const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

        const [symbol0, name0, decimals0, symbol1, name1, decimals1] = await Promise.all([
          token0Contract.symbol(),
          token0Contract.name(),
          token0Contract.decimals(),
          token1Contract.symbol(),
          token1Contract.name(),
          token1Contract.decimals(),
        ]);

        const reserve0 = Number(ethers.formatUnits(reserves[0], decimals0));
        const reserve1 = Number(ethers.formatUnits(reserves[1], decimals1));

        if (reserve0 === 0 || reserve1 === 0) continue;

        // Display symbol (WVBC -> VBC)
        const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
        const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;

        // Determine if VBC (WVBC) should be the base token (left side)
        // VBC should always be on the left side of the pair
        const isToken0VBC =
          token0Address.toLowerCase() === wrappedNativeAddress ||
          symbol0 === 'WVBC' ||
          symbol0 === 'VBC';
        const isToken1VBC =
          token1Address.toLowerCase() === wrappedNativeAddress ||
          symbol1 === 'WVBC' ||
          symbol1 === 'VBC';

        // Set up base/quote based on VBC position
        let baseSymbol: string;
        let quoteSymbol: string;
        let baseAddress: string;
        let quoteAddress: string;
        let baseReserve: number;
        let quoteReserve: number;

        if (isToken0VBC && !isToken1VBC) {
          // token0 is VBC, keep as is
          baseSymbol = displaySymbol0;
          quoteSymbol = displaySymbol1;
          baseAddress = token0Address;
          quoteAddress = token1Address;
          baseReserve = reserve0;
          quoteReserve = reserve1;
        } else if (isToken1VBC && !isToken0VBC) {
          // token1 is VBC, swap to make VBC the base
          baseSymbol = displaySymbol1;
          quoteSymbol = displaySymbol0;
          baseAddress = token1Address;
          quoteAddress = token0Address;
          baseReserve = reserve1;
          quoteReserve = reserve0;
        } else {
          // Neither or both are VBC, use original order
          baseSymbol = displaySymbol0;
          quoteSymbol = displaySymbol1;
          baseAddress = token0Address;
          quoteAddress = token1Address;
          baseReserve = reserve0;
          quoteReserve = reserve1;
        }

        // Price: how many quote tokens per 1 base token
        const price = quoteReserve / baseReserve;
        const priceInverse = baseReserve / quoteReserve;

        // Calculate USD values
        let baseReserveUsd = 0;
        let quoteReserveUsd = 0;
        let baseTokenPriceUsd: string | null = null;
        let quoteTokenPriceUsd: string | null = null;

        const isBaseVBC =
          baseAddress.toLowerCase() === wrappedNativeAddress ||
          baseSymbol === 'VBC';
        const isQuoteUSDT = quoteAddress.toLowerCase() === usdtAddress;
        const isBaseUSDT = baseAddress.toLowerCase() === usdtAddress;

        if (isBaseVBC && isQuoteUSDT) {
          // VBC/USDT pair
          baseReserveUsd = baseReserve * vbcPriceUsd;
          quoteReserveUsd = quoteReserve; // USDT = $1
          baseTokenPriceUsd = vbcPriceUsd.toString();
          quoteTokenPriceUsd = '1';
        } else if (isBaseUSDT) {
          // USDT is base (shouldn't happen with VBC priority, but handle it)
          baseReserveUsd = baseReserve;
          quoteReserveUsd = quoteReserve * vbcPriceUsd;
          baseTokenPriceUsd = '1';
          quoteTokenPriceUsd = vbcPriceUsd.toString();
        } else if (isBaseVBC) {
          // VBC/other pair (e.g., VBC/VBCG)
          baseReserveUsd = baseReserve * vbcPriceUsd;
          // Quote token price = (baseReserve / quoteReserve) * vbcPriceUsd
          const quoteTokenPrice = (baseReserve / quoteReserve) * vbcPriceUsd;
          quoteReserveUsd = quoteReserve * quoteTokenPrice;
          baseTokenPriceUsd = vbcPriceUsd.toString();
          quoteTokenPriceUsd = quoteTokenPrice.toString();
        } else {
          // Fallback: use VBC price if one of them is VBC
          baseReserveUsd = baseReserve * vbcPriceUsd;
          quoteReserveUsd = quoteReserve * vbcPriceUsd;
          baseTokenPriceUsd = vbcPriceUsd.toString();
          quoteTokenPriceUsd = vbcPriceUsd.toString();
        }

        const totalLiquidityUsd = baseReserveUsd + quoteReserveUsd;

        // Calculate cross prices (base in terms of quote, quote in terms of base)
        const baseTokenPriceQuoteToken = price.toString(); // how many quote tokens per 1 base token
        const quoteTokenPriceBaseToken = priceInverse.toString(); // how many base tokens per 1 quote token

        // Get pool statistics from database
        const poolStats = await getPoolStats(lpAddress);

        const poolData: PoolData = {
          id: `${networkSlug}_${lpAddress}`,
          type: 'pool',
          attributes: {
            name: `${baseSymbol}/${quoteSymbol}`,
            address: lpAddress,
            base_token_price_usd: baseTokenPriceUsd,
            quote_token_price_usd: quoteTokenPriceUsd,
            base_token_price_native_currency: price.toString(),
            quote_token_price_native_currency: priceInverse.toString(),
            base_token_price_quote_token: baseTokenPriceQuoteToken,
            quote_token_price_base_token: quoteTokenPriceBaseToken,
            pool_created_at: null,
            reserve_in_usd: totalLiquidityUsd.toFixed(2),
            fdv_usd: null,
            market_cap_usd: null,
            price_change_percentage: {
              m5: '0', // Price change requires historical price tracking
              m15: '0',
              m30: '0',
              h1: '0',
              h6: '0',
              h24: '0',
            },
            transactions: {
              m5: { buys: poolStats.buys.m5, sells: poolStats.sells.m5, buyers: poolStats.buyers.m5.size, sellers: poolStats.sellers.m5.size },
              m15: { buys: poolStats.buys.m15, sells: poolStats.sells.m15, buyers: poolStats.buyers.m15.size, sellers: poolStats.sellers.m15.size },
              m30: { buys: poolStats.buys.m30, sells: poolStats.sells.m30, buyers: poolStats.buyers.m30.size, sellers: poolStats.sellers.m30.size },
              h1: { buys: poolStats.buys.h1, sells: poolStats.sells.h1, buyers: poolStats.buyers.h1.size, sellers: poolStats.sellers.h1.size },
              h6: { buys: poolStats.buys.h6, sells: poolStats.sells.h6, buyers: poolStats.buyers.h6.size, sellers: poolStats.sellers.h6.size },
              h24: { buys: poolStats.buys.h24, sells: poolStats.sells.h24, buyers: poolStats.buyers.h24.size, sellers: poolStats.sellers.h24.size },
            },
            volume_usd: {
              m5: poolStats.volume.m5.toFixed(2),
              m15: poolStats.volume.m15.toFixed(2),
              m30: poolStats.volume.m30.toFixed(2),
              h1: poolStats.volume.h1.toFixed(2),
              h6: poolStats.volume.h6.toFixed(2),
              h24: poolStats.volume.h24.toFixed(2),
            },
          },
          relationships: {
            base_token: {
              data: {
                id: `${networkSlug}_${baseAddress.toLowerCase()}`,
                type: 'token',
              },
            },
            quote_token: {
              data: {
                id: `${networkSlug}_${quoteAddress.toLowerCase()}`,
                type: 'token',
              },
            },
            dex: {
              data: {
                id: 'virbicoin_dex',
                type: 'dex',
              },
            },
          },
        };

        pools.push(poolData);
      } catch (error) {
        console.error(`Error processing pair ${lpAddress}:`, error);
      }
    }

    // Sort by liquidity
    pools.sort(
      (a, b) => parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd)
    );

    // Update cache
    poolsCache = { data: pools, timestamp: Date.now() };

    return NextResponse.json(
      {
        data: pools,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=30',
        },
      }
    );
  } catch (error) {
    console.error('GeckoTerminal Pools API error:', error);
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
