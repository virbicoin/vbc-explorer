// GeckoTerminal Simple Token Price API - Returns token prices in USD
// Format: https://docs.geckoterminal.com/reference/get_simple-networks-network-token_prices-addresses
import { NextResponse } from 'next/server';
import { formatUnits, isAddress } from 'viem';
import { callContract } from '@/lib/web3/provider';
import { loadConfig, getNetworkSlug } from '@/lib/config';
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
  'Cache-Control': 'public, max-age=30',
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
  'function decimals() external view returns (uint8)',
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const addressesParam = searchParams.get('addresses') || '';

    if (!addressesParam) {
      return errorResponse(400, 'addresses parameter is required');
    }

    // Parse addresses (comma-separated)
    const addresses = addressesParam
      .split(',')
      .map((addr) => addr.trim().toLowerCase())
      .filter(Boolean);

    if (addresses.length === 0) {
      return errorResponse(400, 'No valid addresses provided');
    }

    if (addresses.length > 30) {
      return errorResponse(400, 'Maximum 30 addresses allowed');
    }

    const config = loadConfig();

    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const usdtAddress = config.dex?.tokens?.usdt?.address?.toLowerCase() || '';
    const networkSlug = getNetworkSlug();

    // Connect to database
    await connectDB();

    // Get native token price
    let nativePriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      nativePriceUsd = priceData.priceUSD;
    }

    // Build token prices map - GeckoTerminal format: { "address": "price" }
    const tokenPrices: Record<string, string | null> = {};

    // Process each address
    for (const address of addresses) {
      try {
        // Validate address format
        if (!isAddress(address)) {
          tokenPrices[address] = null;
          continue;
        }

        let priceUsd: string | null = null;

        // Check for known tokens
        if (address === wrappedNativeAddress) {
          priceUsd = nativePriceUsd > 0 ? nativePriceUsd.toString() : null;
        } else if (address === usdtAddress) {
          priceUsd = '1';
        } else {
          // Try to find price from DEX pools
          const lpTokens = config.dex?.lpTokens || {};

          for (const [, lpInfo] of Object.entries(lpTokens)) {
            try {
              const lpAddress = (lpInfo as { address: string }).address;

              const [token0, token1, reserves] = await Promise.all([
                callContract(PAIR_ABI, lpAddress, 'token0'),
                callContract(PAIR_ABI, lpAddress, 'token1'),
                callContract(PAIR_ABI, lpAddress, 'getReserves'),
              ]);

              const token0Lower = token0.toLowerCase();
              const token1Lower = token1.toLowerCase();

              if (token0Lower === address || token1Lower === address) {
                const isToken0 = token0Lower === address;
                const pairedToken = isToken0 ? token1Lower : token0Lower;

                const [dec0, dec1] = await Promise.all([
                  callContract(ERC20_ABI, token0, 'decimals'),
                  callContract(ERC20_ABI, token1, 'decimals'),
                ]);

                const reserve0 = Number(formatUnits(BigInt(reserves[0]), dec0));
                const reserve1 = Number(formatUnits(BigInt(reserves[1]), dec1));

                if (reserve0 > 0 && reserve1 > 0) {
                  if (pairedToken === wrappedNativeAddress && nativePriceUsd > 0) {
                    // Paired with native token
                    const tokenPrice = isToken0
                      ? (reserve1 / reserve0) * nativePriceUsd
                      : (reserve0 / reserve1) * nativePriceUsd;
                    priceUsd = tokenPrice.toString();
                    break;
                  } else if (pairedToken === usdtAddress) {
                    // Paired with stablecoin
                    const tokenPrice = isToken0 ? reserve1 / reserve0 : reserve0 / reserve1;
                    priceUsd = tokenPrice.toString();
                    break;
                  }
                }
              }
            } catch {
              continue;
            }
          }
        }

        tokenPrices[address] = priceUsd;
      } catch {
        tokenPrices[address] = null;
      }
    }

    return NextResponse.json(
      {
        data: {
          id: `${networkSlug}_${addresses.join(',')}`,
          type: 'simple_token_price',
          attributes: {
            token_prices: tokenPrices,
          },
        },
      },
      { headers: API_HEADERS }
    );
  } catch (error) {
    console.error('GeckoTerminal Simple Price API error:', error);
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
