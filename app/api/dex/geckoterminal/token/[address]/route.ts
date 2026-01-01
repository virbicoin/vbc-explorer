// GeckoTerminal Token Info API - Returns token information
// Format: https://docs.geckoterminal.com/reference/get_networks-network-tokens-address
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, Contract, DexSwap } from '@/models/index';
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

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address: tokenAddress } = await params;

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const usdtAddress = config.dex?.tokens?.usdt?.address?.toLowerCase() || '';
    const networkSlug = 'virbicoin';

    // Validate address
    if (!ethers.isAddress(tokenAddress)) {
      return errorResponse(400, 'Invalid token address');
    }

    const normalizedAddress = tokenAddress.toLowerCase();

    // Connect to database
    await connectDB();

    // Get token info from blockchain
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    let symbol, name, decimals, totalSupply;
    try {
      [symbol, name, decimals, totalSupply] = await Promise.all([
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.name().catch(() => 'Unknown Token'),
        tokenContract.decimals().catch(() => 18),
        tokenContract.totalSupply().catch(() => BigInt(0)),
      ]);
    } catch {
      return errorResponse(404, 'Token not found');
    }

    const isWrappedNative = normalizedAddress === wrappedNativeAddress;
    const displaySymbol = symbol === 'WVBC' ? 'VBC' : symbol;
    const displayName = name === 'Wrapped VBC' ? 'VirBiCoin' : name;

    // Get token info from Contract collection
    const contractInfo = await Contract.findOne({ address: normalizedAddress }).lean();

    // Calculate token price in USD
    let priceUsd: string | null = null;
    let fdvUsd: string | null = null;
    let totalReserveInUsd = '0';
    let volume24h = '0';

    // Get VBC price
    let vbcPriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      vbcPriceUsd = priceData.priceUSD;
    }

    if (isWrappedNative || symbol === 'VBC') {
      // Native token (VBC)
      priceUsd = vbcPriceUsd.toString();
      if (vbcPriceUsd > 0 && totalSupply > 0n) {
        const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
        fdvUsd = (totalSupplyNum * vbcPriceUsd).toFixed(2);
      }
    } else if (normalizedAddress === usdtAddress) {
      // USDT
      priceUsd = '1';
      if (totalSupply > 0n) {
        const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));
        fdvUsd = totalSupplyNum.toFixed(2);
      }
    } else {
      // Other tokens - calculate from DEX pools
      const lpTokens = config.dex?.lpTokens || {};

      for (const [, lpInfo] of Object.entries(lpTokens)) {
        try {
          const lpAddress = (lpInfo as { address: string }).address;
          const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);

          const [token0, token1, reserves] = await Promise.all([
            pairContract.token0(),
            pairContract.token1(),
            pairContract.getReserves(),
          ]);

          const token0Lower = token0.toLowerCase();
          const token1Lower = token1.toLowerCase();

          if (token0Lower === normalizedAddress || token1Lower === normalizedAddress) {
            const isToken0 = token0Lower === normalizedAddress;
            const pairedToken = isToken0 ? token1Lower : token0Lower;

            const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
            const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
            const [dec0, dec1] = await Promise.all([
              token0Contract.decimals(),
              token1Contract.decimals(),
            ]);

            const reserve0 = Number(ethers.formatUnits(reserves[0], dec0));
            const reserve1 = Number(ethers.formatUnits(reserves[1], dec1));

            if (pairedToken === wrappedNativeAddress && vbcPriceUsd > 0) {
              // Paired with VBC
              const tokenPrice = isToken0
                ? (reserve1 / reserve0) * vbcPriceUsd
                : (reserve0 / reserve1) * vbcPriceUsd;
              priceUsd = tokenPrice.toString();

              const tokenReserve = isToken0 ? reserve0 : reserve1;
              totalReserveInUsd = (tokenReserve * tokenPrice * 2).toFixed(2);
            } else if (pairedToken === usdtAddress) {
              // Paired with USDT
              const tokenPrice = isToken0 ? reserve1 / reserve0 : reserve0 / reserve1;
              priceUsd = tokenPrice.toString();

              const tokenReserve = isToken0 ? reserve0 : reserve1;
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

    // Get 24h volume for this token
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

    // Determine coingecko_coin_id
    let coingeckoCoinId: string | null = null;
    if (isWrappedNative || symbol === 'VBC') {
      coingeckoCoinId = null; // VirBiCoin not on CoinGecko
    } else if (normalizedAddress === usdtAddress || symbol === 'USDT') {
      coingeckoCoinId = 'tether';
    }

    // Get pools that include this token
    const pools: Array<{ id: string; type: string }> = [];
    const lpTokens = config.dex?.lpTokens || {};

    for (const [, lpInfo] of Object.entries(lpTokens)) {
      try {
        const lpAddress = (lpInfo as { address: string }).address;
        const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);

        const [token0, token1] = await Promise.all([pairContract.token0(), pairContract.token1()]);

        if (
          token0.toLowerCase() === normalizedAddress ||
          token1.toLowerCase() === normalizedAddress
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

    return NextResponse.json(
      {
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
      },
      { headers: API_HEADERS }
    );
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
