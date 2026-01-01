// GeckoTerminal Single Pool API - Returns detailed data for a specific pool
// Format: https://docs.geckoterminal.com/reference/get_networks-network-pools-address
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap, Contract } from '@/models/index';
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

// Time intervals in seconds
const TIME_INTERVALS = {
  m5: 5 * 60,
  m15: 15 * 60,
  m30: 30 * 60,
  h1: 60 * 60,
  h6: 6 * 60 * 60,
  h24: 24 * 60 * 60,
};

interface PoolStats {
  volume: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  txCount: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  buys: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  sells: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  buyers: {
    m5: Set<string>;
    m15: Set<string>;
    m30: Set<string>;
    h1: Set<string>;
    h6: Set<string>;
    h24: Set<string>;
  };
  sellers: {
    m5: Set<string>;
    m15: Set<string>;
    m30: Set<string>;
    h1: Set<string>;
    h6: Set<string>;
    h24: Set<string>;
  };
}

// Fetch pool statistics from database
async function getPoolStats(pairAddress: string): Promise<PoolStats> {
  const now = Math.floor(Date.now() / 1000);
  const stats: PoolStats = {
    volume: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    txCount: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    buys: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    sells: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    buyers: {
      m5: new Set(),
      m15: new Set(),
      m30: new Set(),
      h1: new Set(),
      h6: new Set(),
      h24: new Set(),
    },
    sellers: {
      m5: new Set(),
      m15: new Set(),
      m30: new Set(),
      h1: new Set(),
      h6: new Set(),
      h24: new Set(),
    },
  };

  try {
    const h24Ago = now - TIME_INTERVALS.h24;
    const swaps = await DexSwap.find({
      pair: pairAddress.toLowerCase(),
      timestamp: { $gte: h24Ago },
    }).lean();

    for (const swap of swaps) {
      const age = now - swap.timestamp;
      const volumeUsd = swap.amountUSD || 0;
      const isBuy = BigInt(swap.amount0In || '0') > 0n;
      const trader = (swap.sender || '').toLowerCase();

      for (const [interval, seconds] of Object.entries(TIME_INTERVALS)) {
        const key = interval as keyof typeof TIME_INTERVALS;
        if (age <= seconds) {
          stats.volume[key] += volumeUsd;
          stats.txCount[key]++;
          if (isBuy) {
            stats.buys[key]++;
            if (trader) stats.buyers[key].add(trader);
          } else {
            stats.sells[key]++;
            if (trader) stats.sellers[key].add(trader);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching pool stats:', error);
  }

  return stats;
}

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address: poolAddress } = await params;

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return NextResponse.json({ error: 'DEX feature is not enabled' }, { status: 404 });
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const usdtAddress = config.dex?.tokens?.usdt?.address?.toLowerCase() || '';
    const networkSlug = 'virbicoin';

    // Validate address
    if (!ethers.isAddress(poolAddress)) {
      return NextResponse.json({ error: 'Invalid pool address' }, { status: 400 });
    }

    // Connect to database
    await connectDB();

    // Get pool contract data
    const pairContract = new ethers.Contract(poolAddress, PAIR_ABI, provider);

    const [reserves, token0Address, token1Address, totalSupply] = await Promise.all([
      pairContract.getReserves(),
      pairContract.token0(),
      pairContract.token1(),
      pairContract.totalSupply(),
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [symbol0, name0, decimals0, supply0, symbol1, name1, decimals1, supply1] =
      await Promise.all([
        token0Contract.symbol(),
        token0Contract.name(),
        token0Contract.decimals(),
        token0Contract.totalSupply().catch(() => BigInt(0)),
        token1Contract.symbol(),
        token1Contract.name(),
        token1Contract.decimals(),
        token1Contract.totalSupply().catch(() => BigInt(0)),
      ]);

    const reserve0 = Number(ethers.formatUnits(reserves[0], decimals0));
    const reserve1 = Number(ethers.formatUnits(reserves[1], decimals1));

    if (reserve0 === 0 || reserve1 === 0) {
      return NextResponse.json({ error: 'Pool has no liquidity' }, { status: 404 });
    }

    // Display symbol (WVBC -> VBC)
    const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
    const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;

    // Determine base/quote tokens (VBC is always base)
    const isToken0VBC = token0Address.toLowerCase() === wrappedNativeAddress || symbol0 === 'WVBC';
    const isToken1VBC = token1Address.toLowerCase() === wrappedNativeAddress || symbol1 === 'WVBC';

    let baseSymbol: string, quoteSymbol: string;
    let baseName: string, quoteName: string;
    let baseAddress: string, quoteAddress: string;
    let baseDecimals: number, quoteDecimals: number;
    let baseReserve: number, quoteReserve: number;
    let baseSupply: bigint, quoteSupply: bigint;

    if (isToken0VBC && !isToken1VBC) {
      baseSymbol = displaySymbol0;
      quoteSymbol = displaySymbol1;
      baseName = name0;
      quoteName = name1;
      baseAddress = token0Address;
      quoteAddress = token1Address;
      baseDecimals = Number(decimals0);
      quoteDecimals = Number(decimals1);
      baseReserve = reserve0;
      quoteReserve = reserve1;
      baseSupply = supply0;
      quoteSupply = supply1;
    } else if (isToken1VBC && !isToken0VBC) {
      baseSymbol = displaySymbol1;
      quoteSymbol = displaySymbol0;
      baseName = name1;
      quoteName = name0;
      baseAddress = token1Address;
      quoteAddress = token0Address;
      baseDecimals = Number(decimals1);
      quoteDecimals = Number(decimals0);
      baseReserve = reserve1;
      quoteReserve = reserve0;
      baseSupply = supply1;
      quoteSupply = supply0;
    } else {
      baseSymbol = displaySymbol0;
      quoteSymbol = displaySymbol1;
      baseName = name0;
      quoteName = name1;
      baseAddress = token0Address;
      quoteAddress = token1Address;
      baseDecimals = Number(decimals0);
      quoteDecimals = Number(decimals1);
      baseReserve = reserve0;
      quoteReserve = reserve1;
      baseSupply = supply0;
      quoteSupply = supply1;
    }

    // Price calculations
    const price = quoteReserve / baseReserve;
    const priceInverse = baseReserve / quoteReserve;

    // Get VBC price in USD
    let vbcPriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      vbcPriceUsd = priceData.priceUSD;
    }

    // Calculate USD values
    let baseTokenPriceUsd: string | null = null;
    let quoteTokenPriceUsd: string | null = null;
    let baseReserveUsd = 0;
    let quoteReserveUsd = 0;

    const isBaseVBC = baseAddress.toLowerCase() === wrappedNativeAddress;
    const isQuoteUSDT = quoteAddress.toLowerCase() === usdtAddress;

    if (isBaseVBC && isQuoteUSDT) {
      baseTokenPriceUsd = vbcPriceUsd.toString();
      quoteTokenPriceUsd = '1';
      baseReserveUsd = baseReserve * vbcPriceUsd;
      quoteReserveUsd = quoteReserve;
    } else if (isBaseVBC) {
      baseTokenPriceUsd = vbcPriceUsd.toString();
      const quoteTokenPrice = (baseReserve / quoteReserve) * vbcPriceUsd;
      quoteTokenPriceUsd = quoteTokenPrice.toString();
      baseReserveUsd = baseReserve * vbcPriceUsd;
      quoteReserveUsd = quoteReserve * quoteTokenPrice;
    } else {
      baseReserveUsd = baseReserve * vbcPriceUsd;
      quoteReserveUsd = quoteReserve * vbcPriceUsd;
    }

    const totalLiquidityUsd = baseReserveUsd + quoteReserveUsd;

    // Calculate FDV for base token
    let fdvUsd: string | null = null;
    if (baseTokenPriceUsd && baseSupply > 0n) {
      const totalSupplyNum = Number(ethers.formatUnits(baseSupply, baseDecimals));
      fdvUsd = (totalSupplyNum * parseFloat(baseTokenPriceUsd)).toFixed(2);
    }

    // Get pool statistics
    const poolStats = await getPoolStats(poolAddress);

    // Get token info from Contract collection
    const baseContract = await Contract.findOne({ address: baseAddress.toLowerCase() }).lean();
    const quoteContract = await Contract.findOne({ address: quoteAddress.toLowerCase() }).lean();

    // Build included tokens array
    const includedTokens = [
      {
        id: `${networkSlug}_${baseAddress.toLowerCase()}`,
        type: 'token',
        attributes: {
          address: baseAddress.toLowerCase(),
          name: baseName === 'Wrapped VBC' ? 'VirBiCoin' : baseName,
          symbol: baseSymbol,
          decimals: baseDecimals,
          image_url: baseContract?.image_url || null,
          coingecko_coin_id: null,
          total_supply: baseSupply.toString(),
          price_usd: baseTokenPriceUsd,
          fdv_usd: fdvUsd,
          total_reserve_in_usd: baseReserveUsd.toFixed(2),
          volume_usd: {
            h24: poolStats.volume.h24.toFixed(2),
          },
        },
      },
      {
        id: `${networkSlug}_${quoteAddress.toLowerCase()}`,
        type: 'token',
        attributes: {
          address: quoteAddress.toLowerCase(),
          name: quoteName,
          symbol: quoteSymbol,
          decimals: quoteDecimals,
          image_url: quoteContract?.image_url || null,
          coingecko_coin_id: quoteSymbol === 'USDT' ? 'tether' : null,
          total_supply: quoteSupply.toString(),
          price_usd: quoteTokenPriceUsd,
          fdv_usd: null,
          total_reserve_in_usd: quoteReserveUsd.toFixed(2),
          volume_usd: {
            h24: poolStats.volume.h24.toFixed(2),
          },
        },
      },
    ];

    // Build DEX info
    const dexInfo = {
      id: `${networkSlug}_dex`,
      type: 'dex',
      attributes: {
        name: 'VirBiCoin DEX',
        identifier: 'VirBiCoin DEX',
        url: null,
      },
    };

    return NextResponse.json(
      {
        data: {
          id: `${networkSlug}_${poolAddress.toLowerCase()}`,
          type: 'pool',
          attributes: {
            name: `${baseSymbol}/${quoteSymbol}`,
            pool_name: null,
            address: poolAddress.toLowerCase(),
            base_token_price_usd: baseTokenPriceUsd,
            quote_token_price_usd: quoteTokenPriceUsd,
            base_token_price_native_currency: price.toString(),
            quote_token_price_native_currency: priceInverse.toString(),
            base_token_price_quote_token: price.toString(),
            quote_token_price_base_token: priceInverse.toString(),
            pool_created_at: null,
            reserve_in_usd: totalLiquidityUsd.toFixed(2),
            fdv_usd: fdvUsd,
            market_cap_usd: null,
            locked_liquidity_percentage: null,
            pool_fee_percentage: '0.3',
            price_change_percentage: {
              m5: '0',
              m15: '0',
              m30: '0',
              h1: '0',
              h6: '0',
              h24: '0',
            },
            transactions: {
              m5: {
                buys: poolStats.buys.m5,
                sells: poolStats.sells.m5,
                buyers: poolStats.buyers.m5.size,
                sellers: poolStats.sellers.m5.size,
              },
              m15: {
                buys: poolStats.buys.m15,
                sells: poolStats.sells.m15,
                buyers: poolStats.buyers.m15.size,
                sellers: poolStats.sellers.m15.size,
              },
              m30: {
                buys: poolStats.buys.m30,
                sells: poolStats.sells.m30,
                buyers: poolStats.buyers.m30.size,
                sellers: poolStats.sellers.m30.size,
              },
              h1: {
                buys: poolStats.buys.h1,
                sells: poolStats.sells.h1,
                buyers: poolStats.buyers.h1.size,
                sellers: poolStats.sellers.h1.size,
              },
              h6: {
                buys: poolStats.buys.h6,
                sells: poolStats.sells.h6,
                buyers: poolStats.buyers.h6.size,
                sellers: poolStats.sellers.h6.size,
              },
              h24: {
                buys: poolStats.buys.h24,
                sells: poolStats.sells.h24,
                buyers: poolStats.buyers.h24.size,
                sellers: poolStats.sellers.h24.size,
              },
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
              data: { id: `${networkSlug}_${baseAddress.toLowerCase()}`, type: 'token' },
            },
            quote_token: {
              data: { id: `${networkSlug}_${quoteAddress.toLowerCase()}`, type: 'token' },
            },
            dex: {
              data: { id: `${networkSlug}_dex`, type: 'dex' },
            },
          },
        },
        included: [...includedTokens, dexInfo],
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=30',
        },
      }
    );
  } catch (error) {
    console.error('GeckoTerminal Pool API error:', error);
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
