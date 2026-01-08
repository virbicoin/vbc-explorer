// Pool Details API - Returns detailed information for a specific pool
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { getCachedPoolStats } from '@/lib/dex/cache-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function logoUrl() external view returns (string)',
];

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;

    if (!address || !ethers.isAddress(address)) {
      return NextResponse.json({ success: false, error: 'Invalid pool address' }, { status: 400 });
    }

    const appConfig = loadConfig();
    const rpcUrl =
      appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Get USDT and wrapped native addresses
    const usdtAddress = (appConfig.dex?.tokens?.usdt?.address || '').toLowerCase();
    const wrappedNativeAddress = (appConfig.dex?.wrappedNative?.address || '').toLowerCase();

    // Get native price from external API
    let nativePriceUsd = 0;
    try {
      // Use internal call to avoid network loop
      const { getCachedNativePrice } = await import('@/lib/dex/cache-service');
      nativePriceUsd = await getCachedNativePrice();
    } catch {
      console.warn('Could not fetch native price');
    }

    // Fetch pool details from blockchain
    const pairContract = new ethers.Contract(address, PAIR_ABI, provider);

    const [reserves, token0Address, token1Address, totalSupply] = await Promise.all([
      pairContract.getReserves(),
      pairContract.token0(),
      pairContract.token1(),
      pairContract.totalSupply(),
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [symbol0, name0, decimals0Raw, symbol1, name1, decimals1Raw] = await Promise.all([
      token0Contract.symbol(),
      token0Contract.name(),
      token0Contract.decimals(),
      token1Contract.symbol(),
      token1Contract.name(),
      token1Contract.decimals(),
    ]);

    // Convert decimals to number (ethers v6 returns bigint)
    const decimals0 = Number(decimals0Raw);
    const decimals1 = Number(decimals1Raw);

    const reserve0 = ethers.formatUnits(reserves[0], decimals0);
    const reserve1 = ethers.formatUnits(reserves[1], decimals1);
    const lpSupply = ethers.formatUnits(totalSupply, 18);

    const reserve0Num = Number(reserve0);
    const reserve1Num = Number(reserve1);
    const price = reserve1Num / reserve0Num;
    const priceInverse = reserve0Num / reserve1Num;

    // Get tokenIcons from config for centralized icon lookup
    const tokenIcons =
      (appConfig as { tokenIcons?: Record<string, { icon?: string }> }).tokenIcons || {};
    const getConfigIcon = (symbol: string): string | undefined => {
      return tokenIcons[symbol]?.icon;
    };

    // Fetch logoURL for tokens - first from config, then directly from token contract
    let logoUrl0: string | undefined = getConfigIcon(symbol0);
    let logoUrl1: string | undefined = getConfigIcon(symbol1);

    // Try to get logoUrl directly from token contracts (works for all launchpad tokens)
    if (!logoUrl0) {
      try {
        const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
        const logo = await token0Contract.logoUrl();
        if (logo && logo !== '') {
          logoUrl0 = logo;
        }
      } catch {
        // Token doesn't have logoUrl function
      }
    }

    if (!logoUrl1) {
      try {
        const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);
        const logo = await token1Contract.logoUrl();
        if (logo && logo !== '') {
          logoUrl1 = logo;
        }
      } catch {
        // Token doesn't have logoUrl function
      }
    }

    // Calculate USD values
    // For pools with stablecoins (USDT/USDC), use the stablecoin reserve to value the other token
    // This reflects the actual DEX price, not external CEX price
    let reserve0Usd = 0;
    let reserve1Usd = 0;

    if (token0Address.toLowerCase() === usdtAddress) {
      // Token0 is USDT - use USDT reserve to value token1
      // In a 50/50 AMM pool, both sides should have equal USD value
      reserve0Usd = reserve0Num; // USDT = 1 USD
      reserve1Usd = reserve0Num; // Token1 value = Token0 value (50/50 pool)
    } else if (token1Address.toLowerCase() === usdtAddress) {
      // Token1 is USDT - use USDT reserve to value token0
      // In a 50/50 AMM pool, both sides should have equal USD value
      reserve0Usd = reserve1Num; // Token0 value = Token1 value (50/50 pool)
      reserve1Usd = reserve1Num; // USDT = 1 USD
    } else if (token0Address.toLowerCase() === wrappedNativeAddress) {
      // Token0 is wrapped native - use external price
      reserve0Usd = reserve0Num * nativePriceUsd;
      const token1Price = (reserve0Num / reserve1Num) * nativePriceUsd;
      reserve1Usd = reserve1Num * token1Price;
    } else if (token1Address.toLowerCase() === wrappedNativeAddress) {
      // Token1 is wrapped native - use external price
      const token0Price = (reserve1Num / reserve0Num) * nativePriceUsd;
      reserve0Usd = reserve0Num * token0Price;
      reserve1Usd = reserve1Num * nativePriceUsd;
    }

    const wrappedNativeSymbol = appConfig.dex?.wrappedNative?.symbol || 'WETH';
    const nativeSymbol = appConfig.currency?.symbol || 'ETH';
    const displaySymbol0 = symbol0 === wrappedNativeSymbol ? nativeSymbol : symbol0;
    const displaySymbol1 = symbol1 === wrappedNativeSymbol ? nativeSymbol : symbol1;

    // Get 24h volume from cache service
    let volume24h = 0;
    let fees24h = 0;
    try {
      const poolStats = await getCachedPoolStats(address);
      if (poolStats) {
        volume24h = poolStats.volume?.h24 || 0;
        fees24h = volume24h * 0.003; // 0.3% fee
      }
    } catch {
      console.warn('Could not fetch pool stats');
    }

    // Calculate APR
    const totalLiquidityUsd = reserve0Usd + reserve1Usd;
    const apr =
      totalLiquidityUsd > 0 && volume24h > 0
        ? ((volume24h * 0.003 * 365) / totalLiquidityUsd) * 100
        : null;

    return NextResponse.json({
      success: true,
      data: {
        address,
        name: `${displaySymbol0}/${displaySymbol1}`,
        token0: {
          address: token0Address,
          symbol: displaySymbol0,
          name: name0,
          decimals: decimals0,
          reserve: reserve0,
          reserveUsd: reserve0Usd,
          logoURI: logoUrl0,
        },
        token1: {
          address: token1Address,
          symbol: displaySymbol1,
          name: name1,
          decimals: decimals1,
          reserve: reserve1,
          reserveUsd: reserve1Usd,
          logoURI: logoUrl1,
        },
        price,
        priceInverse,
        totalLiquidityUsd,
        lpTokenSupply: lpSupply,
        volume24h,
        fees24h,
        apr,
        nativePriceUsd,
        // Legacy alias
        vbcPriceUsd: nativePriceUsd,
      },
    });
  } catch (error) {
    console.error('Failed to fetch pool details:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pool details', details: errorMessage },
      { status: 500 }
    );
  }
}
