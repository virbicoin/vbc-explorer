// API endpoint to get DEX configuration dynamically from blockchain
import { NextResponse } from 'next/server';
import { fetchDexConfig, setMinimalConfig, getNativeToken } from '@/lib/dex/contract-service';
import { loadConfig } from '@/lib/config';
import dbConnect from '@/lib/db';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Helper to convert BigInt to string in objects
function serializeForJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeForJson);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeForJson(value);
    }
    return result;
  }
  return obj;
}

export async function GET(request: Request) {
  try {
    // Load configuration from config.json
    const appConfig = loadConfig();

    // Check if DEX is enabled
    if (!appConfig.dex?.enabled) {
      return NextResponse.json(
        {
          success: false,
          error: 'DEX feature is not enabled',
          message: 'Set dex.enabled to true in config.json to enable DEX features',
        },
        { status: 404 }
      );
    }

    // Set minimal config from config.json
    setMinimalConfig({
      chainId: appConfig.network?.chainId || 1,
      rpcUrl: appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545',
      explorer: appConfig.network?.explorer || appConfig.explorer?.url || 'https://etherscan.io',
      routerV2: (appConfig.dex?.router ||
        '0x0000000000000000000000000000000000000000') as `0x${string}`,
      masterChefV2: (appConfig.dex?.masterChef ||
        '0x0000000000000000000000000000000000000000') as `0x${string}`,
    });

    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    const config = await fetchDexConfig(refresh);

    // Get native token info from config
    const nativeToken = getNativeToken(appConfig.currency);

    // Get wrapped native token info from config or blockchain
    const wrappedNativeConfig = appConfig.dex?.wrappedNative;
    const wrappedNative = {
      address: config.wrappedNative,
      name: wrappedNativeConfig?.name || `Wrapped ${nativeToken.symbol}`,
      symbol: wrappedNativeConfig?.symbol || `W${nativeToken.symbol}`,
      decimals: wrappedNativeConfig?.decimals || 18,
    };

    // Fetch logo URIs from database for pool tokens
    let poolsWithLogos = config.pools;
    try {
      await dbConnect();
      const db = mongoose.connection.db;
      if (db && config.pools.length > 0) {
        // Collect all unique token addresses from pools
        const tokenAddresses = new Set<string>();
        for (const pool of config.pools) {
          tokenAddresses.add(pool.token0.address.toLowerCase());
          tokenAddresses.add(pool.token1.address.toLowerCase());
        }

        // Fetch contracts with image_url from database
        const contracts = await db
          .collection('contracts')
          .find({
            address: { $in: Array.from(tokenAddresses) },
            image_url: { $exists: true, $ne: null },
          })
          .toArray();

        // Build logo map
        const logoMap = new Map<string, string>();
        for (const contract of contracts) {
          if (contract.image_url) {
            logoMap.set(contract.address.toLowerCase(), contract.image_url);
          }
        }

        // Update pool tokens with logo URIs
        poolsWithLogos = config.pools.map((pool) => ({
          ...pool,
          token0: {
            ...pool.token0,
            logoURI: logoMap.get(pool.token0.address.toLowerCase()),
          },
          token1: {
            ...pool.token1,
            logoURI: logoMap.get(pool.token1.address.toLowerCase()),
          },
        }));
      }
    } catch (dbError) {
      console.error('Error fetching logo URIs from database:', dbError);
      // Continue without logos
    }

    // Build response with all DEX info
    const responseData = {
      success: true,
      data: {
        network: {
          chainId: config.chainId,
          rpcUrl: config.rpcUrl,
          explorer: config.explorer,
        },
        contracts: {
          router: config.router,
          factory: config.factory,
          wrappedNative: config.wrappedNative,
          masterChef: config.masterChef,
        },
        rewardToken: config.rewardToken,
        farming: {
          rewardPerBlock: config.rewardPerBlock,
          rewardPerBlockFormatted: config.rewardPerBlockFormatted,
          pools: poolsWithLogos,
        },
        tokens: {
          native: nativeToken,
          wrappedNative,
          reward: config.rewardToken,
        },
        currency: appConfig.currency,
        lastUpdated: config.lastUpdated,
      },
    };

    return NextResponse.json(serializeForJson(responseData));
  } catch (error) {
    console.error('Error fetching DEX config:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch DEX configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
