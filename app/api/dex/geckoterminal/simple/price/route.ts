// GeckoTerminal Simple Token Price API - Returns token prices in USD
// Format: https://docs.geckoterminal.com/reference/get_simple-networks-network-token_prices-addresses
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB } from '@/models/index';
import { getNativePrice } from '@/lib/price-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
      return NextResponse.json({ error: 'addresses parameter is required' }, { status: 400 });
    }

    // Parse addresses (comma-separated)
    const addresses = addressesParam
      .split(',')
      .map((addr) => addr.trim().toLowerCase())
      .filter(Boolean);

    if (addresses.length === 0) {
      return NextResponse.json({ error: 'No valid addresses provided' }, { status: 400 });
    }

    if (addresses.length > 30) {
      return NextResponse.json({ error: 'Maximum 30 addresses allowed' }, { status: 400 });
    }

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return NextResponse.json({ error: 'DEX feature is not enabled' }, { status: 404 });
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase() || '';
    const usdtAddress = config.dex?.tokens?.usdt?.address?.toLowerCase() || '';
    const networkSlug = 'virbicoin';

    // Connect to database
    await connectDB();

    // Get VBC price
    let vbcPriceUsd = 0;
    const priceData = await getNativePrice();
    if (priceData) {
      vbcPriceUsd = priceData.priceUSD;
    }

    // Build token prices map
    const tokenPrices: Record<string, { token_address: string; price_usd: string | null }> = {};

    // Process each address
    for (const address of addresses) {
      try {
        // Validate address format
        if (!ethers.isAddress(address)) {
          tokenPrices[`${networkSlug}_${address}`] = {
            token_address: address,
            price_usd: null,
          };
          continue;
        }

        let priceUsd: string | null = null;

        // Check for known tokens
        if (address === wrappedNativeAddress) {
          priceUsd = vbcPriceUsd > 0 ? vbcPriceUsd.toString() : null;
        } else if (address === usdtAddress) {
          priceUsd = '1';
        } else {
          // Try to find price from DEX pools
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

              if (token0Lower === address || token1Lower === address) {
                const isToken0 = token0Lower === address;
                const pairedToken = isToken0 ? token1Lower : token0Lower;

                const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
                const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
                const [dec0, dec1] = await Promise.all([
                  token0Contract.decimals(),
                  token1Contract.decimals(),
                ]);

                const reserve0 = Number(ethers.formatUnits(reserves[0], dec0));
                const reserve1 = Number(ethers.formatUnits(reserves[1], dec1));

                if (reserve0 > 0 && reserve1 > 0) {
                  if (pairedToken === wrappedNativeAddress && vbcPriceUsd > 0) {
                    // Paired with VBC
                    const tokenPrice = isToken0
                      ? (reserve1 / reserve0) * vbcPriceUsd
                      : (reserve0 / reserve1) * vbcPriceUsd;
                    priceUsd = tokenPrice.toString();
                    break;
                  } else if (pairedToken === usdtAddress) {
                    // Paired with USDT
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

        tokenPrices[`${networkSlug}_${address}`] = {
          token_address: address,
          price_usd: priceUsd,
        };
      } catch {
        tokenPrices[`${networkSlug}_${address}`] = {
          token_address: address,
          price_usd: null,
        };
      }
    }

    return NextResponse.json(
      {
        data: {
          id: networkSlug,
          type: 'simple_token_price',
          attributes: {
            token_prices: tokenPrices,
          },
        },
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=30',
        },
      }
    );
  } catch (error) {
    console.error('GeckoTerminal Simple Price API error:', error);
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
