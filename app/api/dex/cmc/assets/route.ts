import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// CoinMarketCap DEX Assets API
// Returns all supported tokens on the DEX

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
];

interface Asset {
  name: string;
  symbol: string;
  id: string;
  maker_fee: string;
  taker_fee: string;
  can_withdraw: string;
  can_deposit: string;
  min_withdraw: string;
  max_withdraw: string;
  unified_cryptoasset_id?: number;
  contractAddress?: string;
}

// Cache for API responses
let assetsCache: { data: Record<string, Asset>; timestamp: number } | null = null;
const CACHE_DURATION = 300000; // 5 minutes

export async function GET() {
  try {
    // Check cache
    if (assetsCache && Date.now() - assetsCache.timestamp < CACHE_DURATION) {
      return NextResponse.json(assetsCache.data, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const assets: Record<string, Asset> = {};

    // Add native token (VBC)
    assets['VBC'] = {
      name: config.currency?.name || 'Native',
      symbol: config.currency?.symbol || 'NATIVE',
      id: config.currency?.symbol || 'NATIVE',
      maker_fee: '0.3',
      taker_fee: '0.3',
      can_withdraw: 'true',
      can_deposit: 'true',
      min_withdraw: '0.001',
      max_withdraw: '1000000000',
    };

    // Add wrapped native token
    const wvbc = config.dex?.wrappedNative;
    if (wvbc) {
    assets['WVBC'] = {
      name: wvbc.name,
      symbol: wvbc.symbol,
      id: wvbc.symbol,
      maker_fee: '0.3',
      taker_fee: '0.3',
      can_withdraw: 'true',
      can_deposit: 'true',
      min_withdraw: '0.001',
      max_withdraw: '1000000000',
      contractAddress: wvbc.address,
    };
    }

    // Add configured tokens
    const dexTokens = config.dex?.tokens || {};
    for (const [key, token] of Object.entries(dexTokens)) {
      try {
        const tokenData = token as {
          address: string;
          name: string;
          symbol: string;
          decimals: number;
        };

        // Verify token exists on-chain
        const tokenContract = new ethers.Contract(tokenData.address, ERC20_ABI, provider);
        const [name, symbol] = await Promise.all([
          tokenContract.name(),
          tokenContract.symbol(),
        ]);

        assets[symbol] = {
          name: name,
          symbol: symbol,
          id: symbol,
          maker_fee: '0.3',
          taker_fee: '0.3',
          can_withdraw: 'true',
          can_deposit: 'true',
          min_withdraw: symbol === 'USDT' ? '1' : '0.001',
          max_withdraw: '1000000000',
          contractAddress: tokenData.address,
        };
      } catch (error) {
        console.error(`Error fetching token ${key}:`, error);
      }
    }

    // Update cache
    assetsCache = { data: assets, timestamp: Date.now() };

    return NextResponse.json(assets, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('CMC Assets API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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
