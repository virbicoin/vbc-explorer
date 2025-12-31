// GeckoTerminal Pools API - Returns pool data in GeckoTerminal compatible format
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';

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
    pool_created_at: string | null;
    reserve_in_usd: string;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    price_change_percentage: {
      h1: string;
      h24: string;
    };
    transactions: {
      h1: { buys: number; sells: number };
      h24: { buys: number; sells: number };
    };
    volume_usd: {
      h1: string;
      h24: string;
    };
  };
  relationships: {
    base_token: { data: { id: string; type: string } };
    quote_token: { data: { id: string; type: string } };
    dex: { data: { id: string; type: string } };
  };
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

    // Fetch VBC price from Exbitron exchange
    let vbcPriceUsd = 0;
    try {
      const exbitronRes = await fetch('https://api.exbitron.com/api/v1/cg/tickers');
      if (exbitronRes.ok) {
        const tickers = await exbitronRes.json();
        const vbcUsdt = tickers.find((t: { ticker_id: string }) => t.ticker_id === 'VBC-USDT');
        if (vbcUsdt && vbcUsdt.last_price) {
          vbcPriceUsd = parseFloat(vbcUsdt.last_price);
        }
      }
    } catch (error) {
      console.error('Failed to fetch Exbitron price, falling back to DEX price:', error);
    }

    // Fallback: Get VBC/USDT price from DEX if Exbitron fails
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

        const price = reserve1 / reserve0;
        const priceInverse = reserve0 / reserve1;

        // Calculate USD values
        let reserve0Usd = 0;
        let reserve1Usd = 0;
        let baseTokenPriceUsd: string | null = null;
        let quoteTokenPriceUsd: string | null = null;

        if (token0Address.toLowerCase() === usdtAddress) {
          reserve0Usd = reserve0;
          reserve1Usd = reserve1 * vbcPriceUsd;
          baseTokenPriceUsd = '1';
          quoteTokenPriceUsd = vbcPriceUsd.toString();
        } else if (token1Address.toLowerCase() === usdtAddress) {
          reserve0Usd = reserve0 * (reserve1 / reserve0);
          reserve1Usd = reserve1;
          baseTokenPriceUsd = (reserve1 / reserve0).toString();
          quoteTokenPriceUsd = '1';
        } else if (token0Address.toLowerCase() === wrappedNativeAddress) {
          reserve0Usd = reserve0 * vbcPriceUsd;
          reserve1Usd = reserve1 * ((reserve0 / reserve1) * vbcPriceUsd);
          baseTokenPriceUsd = vbcPriceUsd.toString();
          quoteTokenPriceUsd = ((reserve0 / reserve1) * vbcPriceUsd).toString();
        } else if (token1Address.toLowerCase() === wrappedNativeAddress) {
          reserve0Usd = reserve0 * ((reserve1 / reserve0) * vbcPriceUsd);
          reserve1Usd = reserve1 * vbcPriceUsd;
          baseTokenPriceUsd = ((reserve1 / reserve0) * vbcPriceUsd).toString();
          quoteTokenPriceUsd = vbcPriceUsd.toString();
        }

        const totalLiquidityUsd = reserve0Usd + reserve1Usd;

        // Display symbol (WVBC -> VBC)
        const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
        const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;

        const poolData: PoolData = {
          id: `${networkSlug}_${lpAddress}`,
          type: 'pool',
          attributes: {
            name: `${displaySymbol0}/${displaySymbol1}`,
            address: lpAddress,
            base_token_price_usd: baseTokenPriceUsd,
            quote_token_price_usd: quoteTokenPriceUsd,
            base_token_price_native_currency: price.toString(),
            quote_token_price_native_currency: priceInverse.toString(),
            pool_created_at: null,
            reserve_in_usd: totalLiquidityUsd.toFixed(2),
            fdv_usd: null,
            market_cap_usd: null,
            price_change_percentage: {
              h1: '0',
              h24: '0',
            },
            transactions: {
              h1: { buys: 0, sells: 0 },
              h24: { buys: 0, sells: 0 },
            },
            volume_usd: {
              h1: '0',
              h24: '0',
            },
          },
          relationships: {
            base_token: {
              data: {
                id: `${networkSlug}_${token0Address.toLowerCase()}`,
                type: 'token',
              },
            },
            quote_token: {
              data: {
                id: `${networkSlug}_${token1Address.toLowerCase()}`,
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
