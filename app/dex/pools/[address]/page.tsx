'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ethers } from 'ethers';

interface PoolDetails {
  address: string;
  name: string;
  token0: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    reserve: string;
    reserveUsd: number;
  };
  token1: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    reserve: string;
    reserveUsd: number;
  };
  price: number;
  priceInverse: number;
  totalLiquidityUsd: number;
  lpTokenSupply: string;
  createdAt?: string;
}

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256, uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

export default function PoolDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vbcPriceUsd, setVbcPriceUsd] = useState(0);

  useEffect(() => {
    async function fetchPoolDetails() {
      try {
        // First get config
        const configRes = await fetch('/api/dex/config');
        const config = await configRes.json();

        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const usdtAddress = config.tokens?.usdt?.address?.toLowerCase();
        const wrappedNativeAddress = config.wrappedNative?.address?.toLowerCase();

        // Get VBC price in USD from USDT/WVBC pool
        if (config.lpTokens?.usdtWvbc?.address) {
          try {
            const usdtPairContract = new ethers.Contract(
              config.lpTokens.usdtWvbc.address,
              PAIR_ABI,
              provider
            );
            const usdtReserves = await usdtPairContract.getReserves();
            const usdtToken0 = await usdtPairContract.token0();

            const usdtToken0Contract = new ethers.Contract(usdtToken0, ERC20_ABI, provider);
            const usdtToken1Address = await usdtPairContract.token1();
            const usdtToken1Contract = new ethers.Contract(usdtToken1Address, ERC20_ABI, provider);
            const [dec0, dec1] = await Promise.all([
              usdtToken0Contract.decimals(),
              usdtToken1Contract.decimals(),
            ]);

            const r0 = Number(ethers.formatUnits(usdtReserves[0], dec0));
            const r1 = Number(ethers.formatUnits(usdtReserves[1], dec1));

            if (usdtToken0.toLowerCase() === usdtAddress) {
              setVbcPriceUsd(r0 / r1);
            } else {
              setVbcPriceUsd(r1 / r0);
            }
          } catch {
            console.warn('Could not fetch VBC price');
          }
        }

        // Fetch pool details
        const pairContract = new ethers.Contract(address, PAIR_ABI, provider);

        const [reserves, token0Address, token1Address, totalSupply] = await Promise.all([
          pairContract.getReserves(),
          pairContract.token0(),
          pairContract.token1(),
          pairContract.totalSupply(),
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

        const reserve0 = ethers.formatUnits(reserves[0], decimals0);
        const reserve1 = ethers.formatUnits(reserves[1], decimals1);
        const lpSupply = ethers.formatUnits(totalSupply, 18);

        const reserve0Num = Number(reserve0);
        const reserve1Num = Number(reserve1);
        const price = reserve1Num / reserve0Num;
        const priceInverse = reserve0Num / reserve1Num;

        // Calculate USD values
        let reserve0Usd = 0;
        let reserve1Usd = 0;

        if (token0Address.toLowerCase() === usdtAddress) {
          reserve0Usd = reserve0Num;
          reserve1Usd = reserve1Num * vbcPriceUsd;
        } else if (token1Address.toLowerCase() === usdtAddress) {
          reserve0Usd = reserve0Num * (reserve1Num / reserve0Num);
          reserve1Usd = reserve1Num;
        } else if (token0Address.toLowerCase() === wrappedNativeAddress) {
          reserve0Usd = reserve0Num * vbcPriceUsd;
          reserve1Usd = reserve1Num * ((reserve0Num / reserve1Num) * vbcPriceUsd);
        } else if (token1Address.toLowerCase() === wrappedNativeAddress) {
          reserve0Usd = reserve0Num * ((reserve1Num / reserve0Num) * vbcPriceUsd);
          reserve1Usd = reserve1Num * vbcPriceUsd;
        }

        const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
        const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;

        setPool({
          address,
          name: `${displaySymbol0}/${displaySymbol1}`,
          token0: {
            address: token0Address,
            symbol: displaySymbol0,
            name: name0,
            decimals: decimals0,
            reserve: reserve0,
            reserveUsd: reserve0Usd,
          },
          token1: {
            address: token1Address,
            symbol: displaySymbol1,
            name: name1,
            decimals: decimals1,
            reserve: reserve1,
            reserveUsd: reserve1Usd,
          },
          price,
          priceInverse,
          totalLiquidityUsd: reserve0Usd + reserve1Usd,
          lpTokenSupply: lpSupply,
        });
      } catch (err) {
        console.error('Failed to fetch pool details:', err);
        setError('Failed to load pool details');
      } finally {
        setLoading(false);
      }
    }

    fetchPoolDetails();
    const interval = setInterval(fetchPoolDetails, 30000);
    return () => clearInterval(interval);
  }, [address, vbcPriceUsd]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-gray-700 rounded w-1/3"></div>
            <div className="h-64 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !pool) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-red-400">{error || 'Pool not found'}</h1>
          <Link href="/dex/pools" className="text-green-400 hover:underline mt-4 inline-block">
            ← Back to Pools
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
          <Link href="/dex" className="hover:text-white transition-colors">
            DEX
          </Link>
          <span>/</span>
          <Link href="/dex/pools" className="hover:text-white transition-colors">
            Pools
          </Link>
          <span>/</span>
          <span className="text-white">{pool.name}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="flex -space-x-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold border-3 border-gray-800 z-10">
                {pool.token0.symbol.slice(0, 2)}
              </div>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold border-3 border-gray-800">
                {pool.token1.symbol.slice(0, 2)}
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{pool.name}</h1>
              <div className="text-gray-400 font-mono text-sm">{pool.address}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <Link
              href={`/dex?tab=swap&from=${pool.token0.address}&to=${pool.token1.address}`}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl hover:opacity-90 transition-opacity font-semibold"
            >
              Swap
            </Link>
            <Link
              href={`/dex?tab=pool&pair=${pool.address}`}
              className="px-6 py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-600 transition-colors font-semibold"
            >
              Add Liquidity
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">Total Liquidity</div>
            <div className="text-2xl font-bold text-white">
              $
              {pool.totalLiquidityUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">Price</div>
            <div className="text-2xl font-bold text-white">{pool.price.toFixed(6)}</div>
            <div className="text-xs text-gray-500">
              {pool.token0.symbol}/{pool.token1.symbol}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">24h Volume</div>
            <div className="text-2xl font-bold text-white">$0.00</div>
          </div>
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="text-gray-400 text-sm mb-1">LP Supply</div>
            <div className="text-2xl font-bold text-white">
              {Number(pool.lpTokenSupply).toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </div>
          </div>
        </div>

        {/* Token Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold">
                {pool.token0.symbol.slice(0, 2)}
              </div>
              <div>
                <div className="font-semibold text-white">{pool.token0.symbol}</div>
                <div className="text-xs text-gray-500">{pool.token0.name}</div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Reserve</span>
                <span className="text-white font-medium">
                  {Number(pool.token0.reserve).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}{' '}
                  {pool.token0.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Value (USD)</span>
                <span className="text-white font-medium">
                  $
                  {pool.token0.reserveUsd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Contract</span>
                <Link
                  href={`/address/${pool.token0.address}`}
                  className="text-green-400 hover:underline font-mono text-sm"
                >
                  {pool.token0.address.slice(0, 10)}...{pool.token0.address.slice(-8)}
                </Link>
              </div>
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold">
                {pool.token1.symbol.slice(0, 2)}
              </div>
              <div>
                <div className="font-semibold text-white">{pool.token1.symbol}</div>
                <div className="text-xs text-gray-500">{pool.token1.name}</div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Reserve</span>
                <span className="text-white font-medium">
                  {Number(pool.token1.reserve).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}{' '}
                  {pool.token1.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Value (USD)</span>
                <span className="text-white font-medium">
                  $
                  {pool.token1.reserveUsd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Contract</span>
                <Link
                  href={`/address/${pool.token1.address}`}
                  className="text-green-400 hover:underline font-mono text-sm"
                >
                  {pool.token1.address.slice(0, 10)}...{pool.token1.address.slice(-8)}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Pool Contract Info */}
        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
          <h2 className="text-xl font-bold text-white mb-4">Pool Contract</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-gray-400 text-sm mb-1">LP Token Address</div>
              <Link
                href={`/address/${pool.address}`}
                className="text-green-400 hover:underline font-mono break-all"
              >
                {pool.address}
              </Link>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-1">View on Explorer</div>
              <Link href={`/address/${pool.address}`} className="text-green-400 hover:underline">
                View Contract →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
