import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { getExternalPriceData } from '@/lib/dex/external-price';
import { headers } from 'next/headers';
import { getCachedPoolStats } from '@/lib/dex/cache-service';

/**
 * DefiLlama Pools API
 * Returns pool information in DefiLlama yields-compatible format
 *
 * GET /api/dex/defillama/pools
 *
 * This endpoint provides data compatible with DefiLlama's yields dashboard
 * Format: https://yields.llama.fi/pools
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// MasterChef ABI for APR calculation
const MASTERCHEF_ABI = [
  'function rewardPerBlock() view returns (uint256)',
  'function totalAllocPoint() view returns (uint256)',
  'function poolInfo(uint256) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accRewardPerShare, uint256 totalStaked)',
  'function poolLength() view returns (uint256)',
];

// Helper function to get base URL
async function getBaseUrl(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}`;
}

// Calculate APR from MasterChef
async function calculateFarmingAPR(
  provider: ethers.JsonRpcProvider,
  masterChefAddress: string,
  lpTokenAddress: string,
  lpTvlUsd: number,
  rewardTokenPriceUsd: number,
  blockTime: number = 13
): Promise<number> {
  try {
    const masterChef = new ethers.Contract(masterChefAddress, MASTERCHEF_ABI, provider);

    const [rewardPerBlock, totalAllocPoint, poolLength] = await Promise.all([
      masterChef.rewardPerBlock(),
      masterChef.totalAllocPoint(),
      masterChef.poolLength(),
    ]);

    // Find the pool for this LP token
    for (let pid = 0; pid < Number(poolLength); pid++) {
      const poolInfo = await masterChef.poolInfo(pid);
      if (poolInfo.lpToken.toLowerCase() === lpTokenAddress.toLowerCase()) {
        const allocPoint = Number(poolInfo.allocPoint);
        const totalStaked = Number(ethers.formatEther(poolInfo.totalStaked));

        if (allocPoint === 0 || Number(totalAllocPoint) === 0) return 0;

        // Calculate yearly rewards
        const SECONDS_PER_YEAR = 31536000;
        const blocksPerYear = SECONDS_PER_YEAR / blockTime;
        const poolShareRatio = allocPoint / Number(totalAllocPoint);
        const yearlyRewardTokens =
          Number(ethers.formatEther(rewardPerBlock)) * blocksPerYear * poolShareRatio;

        // Calculate APR based on staked TVL
        const stakedTvlUsd =
          totalStaked > 0
            ? (totalStaked / Number(await getTotalLPSupply(provider, lpTokenAddress))) * lpTvlUsd
            : lpTvlUsd;

        if (stakedTvlUsd <= 0) return 0;

        const yearlyRewardUsd = yearlyRewardTokens * rewardTokenPriceUsd;
        return (yearlyRewardUsd / stakedTvlUsd) * 100;
      }
    }
    return 0;
  } catch (error) {
    console.error('Error calculating farming APR:', error);
    return 0;
  }
}

async function getTotalLPSupply(
  provider: ethers.JsonRpcProvider,
  lpAddress: string
): Promise<number> {
  try {
    const lpContract = new ethers.Contract(
      lpAddress,
      ['function totalSupply() view returns (uint256)'],
      provider
    );
    const totalSupply = await lpContract.totalSupply();
    return Number(ethers.formatEther(totalSupply));
  } catch {
    return 1;
  }
}

interface Pool {
  pool: string; // unique pool id
  chain: string; // chain name
  project: string; // project name
  symbol: string; // pool symbol (e.g., "VBC-USDT")
  tvlUsd: number; // TVL in USD
  apyBase?: number; // base APY from trading fees
  apyReward?: number; // reward APY from farming
  apy?: number; // total APY
  rewardTokens?: string[]; // reward token addresses
  underlyingTokens: string[]; // underlying token addresses
  poolMeta?: string; // optional metadata
  il7d?: number; // 7-day impermanent loss
  apyBase7d?: number; // 7-day base APY
  volumeUsd1d?: number; // 24h volume in USD
  volumeUsd7d?: number; // 7-day volume in USD
  apyBaseInception?: number; // APY since inception
}

export async function GET() {
  try {
    const config = loadConfig();
    const chainName = config.network?.name || 'Virbicoin';

    // Get external price data
    const priceData = await getExternalPriceData();
    const nativePriceUsd = priceData.nativePriceUsd;

    // Get reward token info from DEX config
    const rewardTokenAddress = config.dex?.rewardToken?.address;
    const rewardTokens = rewardTokenAddress ? [rewardTokenAddress] : [];

    const pools: Pool[] = [];

    try {
      const baseUrl = await getBaseUrl();
      const pairsResponse = await fetch(`${baseUrl}/api/dex/pairs`, {
        cache: 'no-store',
      });

      if (pairsResponse.ok) {
        const pairsData = await pairsResponse.json();
        const pairsArray = pairsData.data?.pairs || pairsData.data || [];
        const wrappedNativeAddress = pairsData.data?.wrappedNativeAddress?.toLowerCase() || '';

        // Get known stablecoin symbols
        const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);

        // Setup provider and MasterChef for APR calculation
        const rpcUrl =
          config.network?.rpcUrl || config.web3Provider?.url || 'http://localhost:8545';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const masterChefAddress =
          (config.dex?.masterChef as { address?: string })?.address ||
          '0x12A656c2DeE0EA2685398d52AcF78974fCD67B27';
        const blockTime = config.network?.blockTime || 13;

        // Get reward token price (VBCG price, calculated from VBC/VBCG pool or same as VBC)
        // For now, calculate from VBC/USDT pool ratio
        let rewardTokenPriceUsd = nativePriceUsd; // Default to native price

        // Find VBC/USDT pair to get DEX VBC price
        const vbcUsdtPair = pairsArray.find(
          (p: { baseToken?: { symbol?: string }; quoteToken?: { symbol?: string } }) =>
            (p.baseToken?.symbol === 'VBC' || p.baseToken?.symbol === 'WVBC') &&
            STABLECOIN_SYMBOLS.has(p.quoteToken?.symbol?.toUpperCase() || '')
        );

        if (vbcUsdtPair) {
          const baseDecimals = vbcUsdtPair.baseToken?.decimals || 18;
          const quoteDecimals = vbcUsdtPair.quoteToken?.decimals || 18;
          const reserve0 =
            Number(BigInt(String(vbcUsdtPair.reserve0 || '0'))) / Math.pow(10, baseDecimals);
          const reserve1 =
            Number(BigInt(String(vbcUsdtPair.reserve1 || '0'))) / Math.pow(10, quoteDecimals);
          if (reserve0 > 0) {
            rewardTokenPriceUsd = reserve1 / reserve0; // DEX VBC price
          }
        }

        for (const pair of pairsArray) {
          // Calculate TVL from reserves
          // pair.reserve0 and pair.reserve1 are strings representing token amounts
          const baseDecimals = pair.baseToken?.decimals || 18;
          const quoteDecimals = pair.quoteToken?.decimals || 18;

          // Safely parse reserves as BigInt from string
          const reserve0Raw = String(pair.reserve0 || '0');
          const reserve1Raw = String(pair.reserve1 || '0');

          const reserve0 = Number(BigInt(reserve0Raw)) / Math.pow(10, baseDecimals);
          const reserve1 = Number(BigInt(reserve1Raw)) / Math.pow(10, quoteDecimals);

          let tvlUsd = 0;

          // Check token types
          const baseIsStablecoin = STABLECOIN_SYMBOLS.has(pair.baseToken?.symbol?.toUpperCase());
          const quoteIsStablecoin = STABLECOIN_SYMBOLS.has(pair.quoteToken?.symbol?.toUpperCase());
          const quoteIsNative = pair.quoteToken?.address?.toLowerCase() === wrappedNativeAddress;

          if (baseIsStablecoin) {
            // Base token is stablecoin, use its reserve * 2
            tvlUsd = reserve0 * 2;
          } else if (quoteIsStablecoin) {
            // Quote token is stablecoin, use its reserve * 2
            tvlUsd = reserve1 * 2;
          } else if (quoteIsNative) {
            // Quote token is wrapped native, calculate from DEX price
            tvlUsd = reserve1 * rewardTokenPriceUsd * 2;
          } else {
            // Fallback: estimate from DEX price
            tvlUsd = (reserve0 + reserve1) * rewardTokenPriceUsd;
          }

          // Calculate farming APR from MasterChef
          let apyReward = 0;
          try {
            apyReward = await calculateFarmingAPR(
              provider,
              masterChefAddress,
              pair.address,
              tvlUsd,
              rewardTokenPriceUsd,
              blockTime
            );
          } catch (aprError) {
            console.warn('Could not calculate APR for', pair.address, aprError);
          }

          // Get 24h volume from pool stats
          let volumeUsd1d = 0;
          try {
            const poolStats = await getCachedPoolStats(pair.address);
            if (poolStats?.volume?.h24) {
              volumeUsd1d = poolStats.volume.h24;
            }
          } catch {
            // Volume not available
          }

          // Calculate fee APY from volume (0.3% fee, annualized)
          const apyBase = tvlUsd > 0 ? ((volumeUsd1d * 0.003 * 365) / tvlUsd) * 100 : 0;

          pools.push({
            pool: `${chainName.toLowerCase()}-${pair.address}`.toLowerCase(),
            chain: chainName,
            project: `${chainName} DEX`,
            symbol: pair.name,
            tvlUsd: tvlUsd,
            apyBase: apyBase,
            apyReward: apyReward,
            apy: apyBase + apyReward,
            rewardTokens: rewardTokens,
            underlyingTokens: [pair.baseToken?.address, pair.quoteToken?.address].filter(Boolean),
            poolMeta: undefined,
            volumeUsd1d: volumeUsd1d,
            volumeUsd7d: volumeUsd1d * 7, // Estimate
          });
        }
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
    }

    // DefiLlama pools response format
    const response = {
      status: 'ok',
      data: pools,
    };

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('DefiLlama pools API error:', error);
    return NextResponse.json({ status: 'error', data: [] }, { status: 500 });
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
