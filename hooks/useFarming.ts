'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers, Contract, BrowserProvider } from 'ethers';
import { 
  initFarmingConfig, 
  getNetworkConfig, 
  getStaticContracts, 
  getBlocksPerYear,
  NetworkConfig,
  MinimalContracts
} from '@/config/farming';
import { MASTER_CHEF_ABI, ERC20_ABI } from '@/abi/MasterChefABI';

// DEX token configuration interface
interface DexTokenConfig {
  wrappedNativeAddress: string;
  stablecoinAddress: string;
  stablecoinDecimals: number;
  rewardTokenAddress: string;
  rewardTokenDecimals: number;
  rewardTokenPriceUSD: number; // Fallback price from config
  factoryAddress: string;
}

// Configuration cache
let configLoaded = false;
let networkConfigCache: NetworkConfig | null = null;
let staticContractsCache: MinimalContracts | null = null;
let blocksPerYearCache: number = 2628000; // Default
let dexTokenConfigCache: DexTokenConfig | null = null;

async function loadFarmingConfig(): Promise<{
  networkConfig: NetworkConfig;
  staticContracts: MinimalContracts;
  blocksPerYear: number;
  dexTokenConfig: DexTokenConfig;
}> {
  if (configLoaded && networkConfigCache && staticContractsCache && dexTokenConfigCache) {
    return {
      networkConfig: networkConfigCache,
      staticContracts: staticContractsCache,
      blocksPerYear: blocksPerYearCache,
      dexTokenConfig: dexTokenConfigCache
    };
  }

  try {
    const response = await fetch('/api/config/client');
    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }
    const config = await response.json();
    
    // Initialize the farming config module
    initFarmingConfig({
      network: config.network,
      dex: config.dex
    });
    
    // Get the initialized values
    networkConfigCache = getNetworkConfig();
    staticContractsCache = getStaticContracts();
    blocksPerYearCache = getBlocksPerYear();
    
    // Extract DEX token addresses from config
    // Look for stablecoin (USDT, USDC, DAI, etc.) in tokens
    let stablecoinAddress = '';
    let stablecoinDecimals = 6; // Default for most stablecoins
    const tokens = config.dex?.tokens || {};
    
    // Find first stablecoin in tokens config
    for (const [key, token] of Object.entries(tokens)) {
      const tokenData = token as { address?: string; symbol?: string; decimals?: number };
      const symbol = tokenData.symbol?.toUpperCase() || key.toUpperCase();
      if (['USDT', 'USDC', 'DAI', 'BUSD', 'UST'].includes(symbol)) {
        stablecoinAddress = tokenData.address?.toLowerCase() || '';
        stablecoinDecimals = tokenData.decimals || 6;
        break;
      }
    }
    
    dexTokenConfigCache = {
      wrappedNativeAddress: config.dex?.wrappedNative?.address?.toLowerCase() || '',
      stablecoinAddress,
      stablecoinDecimals,
      rewardTokenAddress: config.dex?.rewardToken?.address?.toLowerCase() || '',
      rewardTokenDecimals: config.dex?.rewardToken?.decimals || 18,
      rewardTokenPriceUSD: config.dex?.rewardToken?.priceUSD || 0,
      factoryAddress: config.dex?.factory?.toLowerCase() || ''
    };
    
    configLoaded = true;
    
    console.log('[loadFarmingConfig] Loaded config:', {
      chainId: networkConfigCache.chainId,
      masterChef: staticContractsCache.masterChef,
      router: staticContractsCache.router,
      blocksPerYear: blocksPerYearCache,
      wrappedNative: dexTokenConfigCache.wrappedNativeAddress,
      stablecoin: dexTokenConfigCache.stablecoinAddress,
      rewardTokenPriceUSD: dexTokenConfigCache.rewardTokenPriceUSD
    });
    
    return {
      networkConfig: networkConfigCache,
      staticContracts: staticContractsCache,
      blocksPerYear: blocksPerYearCache,
      dexTokenConfig: dexTokenConfigCache
    };
  } catch (error) {
    console.error('[loadFarmingConfig] Failed to load config:', error);
    // Return defaults
    return {
      networkConfig: getNetworkConfig(),
      staticContracts: getStaticContracts(),
      blocksPerYear: getBlocksPerYear(),
      dexTokenConfig: {
        wrappedNativeAddress: '',
        stablecoinAddress: '',
        stablecoinDecimals: 6,
        rewardTokenAddress: '',
        rewardTokenDecimals: 18,
        rewardTokenPriceUSD: 0,
        factoryAddress: ''
      }
    };
  }
}

// Pool data interface
export interface PoolData {
  pid: number;
  name: string;
  lpToken: string;
  allocPoint: bigint;
  totalStaked: bigint;
  apr: number;
  token0Symbol: string;
  token1Symbol: string;
}

// User pool data interface
export interface UserPoolData {
  stakedAmount: bigint;
  pendingReward: bigint;
  lpBalance: bigint;
  allowance: bigint;
}

// Error messages mapping
const ERROR_MESSAGES: Record<string, string> = {
  "user rejected": "Transaction was cancelled",
  "insufficient": "Insufficient balance",
  "exceeds balance": "Insufficient balance",
  "masterchef": "Contract error occurred",
  "execution reverted": "Transaction failed",
  "network": "Network error occurred"
};

// Get user-friendly error message
function getErrorMessage(error: unknown): string {
  const msg = (error as { message?: string; reason?: string })?.message || 
              (error as { reason?: string })?.reason || "";
  const lowerMsg = msg.toLowerCase();
  
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (lowerMsg.includes(key.toLowerCase())) {
      return value;
    }
  }
  return "An error occurred";
}

interface UseFarmingOptions {
  externalAddress?: string | null;
  externalIsConnected?: boolean;
}

export function useFarming(options: UseFarmingOptions = {}) {
  const { externalAddress, externalIsConnected } = options;
  
  const [pools, setPools] = useState<PoolData[]>([]);
  const [userPools, setUserPools] = useState<Map<number, UserPoolData>>(new Map());
  const [rewardPerBlock, setRewardPerBlock] = useState<bigint>(0n);
  const [totalAllocPoint, setTotalAllocPoint] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalAccount, setInternalAccount] = useState<string | null>(null);
  const [internalIsConnected, setInternalIsConnected] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig | null>(null);
  const [staticContracts, setStaticContracts] = useState<MinimalContracts | null>(null);
  const [blocksPerYear, setBlocksPerYear] = useState<number>(2628000);
  const [dexTokenConfig, setDexTokenConfig] = useState<DexTokenConfig | null>(null);
  
  // Use external values if provided, otherwise use internal
  const account = externalAddress ?? internalAccount;
  const isConnected = externalIsConnected ?? internalIsConnected;

  // Initialize config on mount
  useEffect(() => {
    let mounted = true;
    
    async function initConfig() {
      const config = await loadFarmingConfig();
      if (mounted) {
        setNetworkConfig(config.networkConfig);
        setStaticContracts(config.staticContracts);
        setBlocksPerYear(config.blocksPerYear);
        setDexTokenConfig(config.dexTokenConfig);
        setConfigReady(true);
      }
    }
    
    initConfig();
    
    return () => {
      mounted = false;
    };
  }, []);

  // Get provider and signer
  const getProviderAndSigner = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask is not installed');
    }
    
    if (!networkConfig) {
      throw new Error('Config not loaded');
    }
    
    // Check and switch to correct network first
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainId as string, 16);
    console.log('[getProviderAndSigner] Current chainId:', currentChainId, 'Expected:', networkConfig.chainId);
    
    if (currentChainId !== networkConfig.chainId) {
      console.log('[getProviderAndSigner] Switching network...');
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${networkConfig.chainId.toString(16)}` }]
        });
      } catch (switchError: unknown) {
        // Chain not added, try to add it
        if ((switchError as { code?: number })?.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${networkConfig.chainId.toString(16)}`,
              chainName: networkConfig.name,
              rpcUrls: [networkConfig.rpcUrl],
              blockExplorerUrls: [networkConfig.explorer],
              nativeCurrency: {
                name: 'VBC',
                symbol: 'VBC',
                decimals: 18
              }
            }]
          });
        } else {
          throw switchError;
        }
      }
    }
    
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    console.log('[getProviderAndSigner] Got signer:', address);
    return { provider, signer, address };
  }, [networkConfig]);

  // Get read-only provider
  const getReadOnlyProvider = useCallback(() => {
    if (!networkConfig) {
      throw new Error('Config not loaded');
    }
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  }, [networkConfig]);

  // Get MasterChef contract
  const getMasterChef = useCallback((signerOrProvider: ethers.Signer | ethers.Provider) => {
    if (!staticContracts) {
      throw new Error('Config not loaded');
    }
    return new Contract(staticContracts.masterChef, MASTER_CHEF_ABI, signerOrProvider);
  }, [staticContracts]);

  // Fetch pool information from blockchain
  const fetchPools = useCallback(async () => {
    if (!configReady || !staticContracts || !networkConfig) {
      console.log('[fetchPools] Config not ready yet');
      return;
    }
    
    try {
      const provider = getReadOnlyProvider();
      const masterChef = getMasterChef(provider);

      const [rewardRate, totalAlloc, poolLength] = await Promise.all([
        masterChef.rewardPerBlock(),
        masterChef.totalAllocPoint(),
        masterChef.poolLength()
      ]);

      setRewardPerBlock(rewardRate);
      setTotalAllocPoint(totalAlloc);

      const poolsData: PoolData[] = [];
      const numPools = Number(poolLength);
      
      // Token addresses from config (lowercase for comparison)
      const STABLECOIN_ADDRESS = dexTokenConfig?.stablecoinAddress || '';
      const WRAPPED_NATIVE_ADDRESS = dexTokenConfig?.wrappedNativeAddress || '';
      const REWARD_TOKEN_ADDRESS = dexTokenConfig?.rewardTokenAddress || '';
      const FACTORY_ADDRESS = dexTokenConfig?.factoryAddress || '';
      const STABLECOIN_DECIMALS = dexTokenConfig?.stablecoinDecimals || 6;
      
      console.log('[fetchPools] DEX Token Config:', {
        stablecoinAddress: STABLECOIN_ADDRESS,
        wrappedNativeAddress: WRAPPED_NATIVE_ADDRESS,
        rewardTokenAddress: REWARD_TOKEN_ADDRESS,
        factoryAddress: FACTORY_ADDRESS,
        dexTokenConfigExists: !!dexTokenConfig
      });
      
      // Fetch reward token price from on-chain (via stablecoin pair or wrapped native)
      let rewardTokenPriceUSD = 0;
      if (FACTORY_ADDRESS && REWARD_TOKEN_ADDRESS && STABLECOIN_ADDRESS) {
        try {
          const factoryABI = [
            { inputs: [{ type: "address" }, { type: "address" }], name: "getPair", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }
          ];
          const factory = new Contract(FACTORY_ADDRESS, factoryABI, provider);
          
          // Try to get direct reward token / stablecoin pair first
          const rewardStablePairAddr = await factory.getPair(REWARD_TOKEN_ADDRESS, STABLECOIN_ADDRESS);
          
          if (rewardStablePairAddr && rewardStablePairAddr !== '0x0000000000000000000000000000000000000000') {
            // Direct reward token / stablecoin pair exists
            const pairABI = [
              { inputs: [], name: "token0", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
              { inputs: [], name: "getReserves", outputs: [{ type: "uint256" }, { type: "uint256" }], stateMutability: "view", type: "function" }
            ];
            const rewardStablePair = new Contract(rewardStablePairAddr, pairABI, provider);
            const [pairToken0, pairReserves] = await Promise.all([
              rewardStablePair.token0(),
              rewardStablePair.getReserves()
            ]);
            
            const isRewardToken0 = pairToken0.toLowerCase() === REWARD_TOKEN_ADDRESS;
            const rewardReserve = isRewardToken0 
              ? Number(pairReserves[0]) / 1e18 
              : Number(pairReserves[1]) / 1e18;
            const stableReserve = isRewardToken0 
              ? Number(pairReserves[1]) / Math.pow(10, STABLECOIN_DECIMALS)
              : Number(pairReserves[0]) / Math.pow(10, STABLECOIN_DECIMALS);
            
            if (rewardReserve > 0) {
              rewardTokenPriceUSD = stableReserve / rewardReserve;
            }
            console.log('[fetchPools] Reward token price from direct stablecoin pair:', rewardTokenPriceUSD);
          } else if (WRAPPED_NATIVE_ADDRESS) {
            // No direct stablecoin pair, calculate via wrapped native token
            // reward/wrapped -> wrapped/stable
            const [rewardWrappedPairAddr, wrappedStablePairAddr] = await Promise.all([
              factory.getPair(REWARD_TOKEN_ADDRESS, WRAPPED_NATIVE_ADDRESS),
              factory.getPair(WRAPPED_NATIVE_ADDRESS, STABLECOIN_ADDRESS)
            ]);
            
            if (rewardWrappedPairAddr !== '0x0000000000000000000000000000000000000000' &&
                wrappedStablePairAddr !== '0x0000000000000000000000000000000000000000') {
              const pairABI = [
                { inputs: [], name: "token0", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
                { inputs: [], name: "getReserves", outputs: [{ type: "uint256" }, { type: "uint256" }], stateMutability: "view", type: "function" }
              ];
              
              // Get reward token / wrapped native price
              const rewardWrappedPair = new Contract(rewardWrappedPairAddr, pairABI, provider);
              const [rewardWrappedToken0, rewardWrappedReserves] = await Promise.all([
                rewardWrappedPair.token0(),
                rewardWrappedPair.getReserves()
              ]);
              const isRewardToken0InWrapped = rewardWrappedToken0.toLowerCase() === REWARD_TOKEN_ADDRESS;
              const rewardInPair = isRewardToken0InWrapped 
                ? Number(rewardWrappedReserves[0]) / 1e18 
                : Number(rewardWrappedReserves[1]) / 1e18;
              const wrappedInRewardPair = isRewardToken0InWrapped 
                ? Number(rewardWrappedReserves[1]) / 1e18 
                : Number(rewardWrappedReserves[0]) / 1e18;
              const rewardPriceInWrapped = rewardInPair > 0 ? wrappedInRewardPair / rewardInPair : 0;
              
              // Get wrapped native / stablecoin price
              const wrappedStablePair = new Contract(wrappedStablePairAddr, pairABI, provider);
              const [wrappedStableToken0, wrappedStableReserves] = await Promise.all([
                wrappedStablePair.token0(),
                wrappedStablePair.getReserves()
              ]);
              const isWrappedToken0InStable = wrappedStableToken0.toLowerCase() === WRAPPED_NATIVE_ADDRESS;
              const wrappedInStablePair = isWrappedToken0InStable 
                ? Number(wrappedStableReserves[0]) / 1e18 
                : Number(wrappedStableReserves[1]) / 1e18;
              const stableInWrappedPair = isWrappedToken0InStable 
                ? Number(wrappedStableReserves[1]) / Math.pow(10, STABLECOIN_DECIMALS)
                : Number(wrappedStableReserves[0]) / Math.pow(10, STABLECOIN_DECIMALS);
              const wrappedPriceUSD = wrappedInStablePair > 0 ? stableInWrappedPair / wrappedInStablePair : 0;
              
              // Reward token price = reward/wrapped × wrapped/USD
              rewardTokenPriceUSD = rewardPriceInWrapped * wrappedPriceUSD;
              console.log('[fetchPools] Reward token price via wrapped native:', {
                rewardPriceInWrapped,
                wrappedPriceUSD,
                rewardTokenPriceUSD
              });
            }
          }
        } catch (priceError) {
          console.error('[fetchPools] Error fetching reward token price:', priceError);
        }
      }
      
      // Use config price as fallback if on-chain price is 0 or very low
      const REWARD_TOKEN_CONFIG_PRICE = dexTokenConfig?.rewardTokenPriceUSD || 0;
      if (rewardTokenPriceUSD <= 0 && REWARD_TOKEN_CONFIG_PRICE > 0) {
        rewardTokenPriceUSD = REWARD_TOKEN_CONFIG_PRICE;
        console.log('[fetchPools] Using config fallback price:', rewardTokenPriceUSD);
      }
      
      console.log('[fetchPools] Final reward token price USD:', rewardTokenPriceUSD);
      
      // Dynamically fetch all pools from blockchain
      for (let pid = 0; pid < numPools; pid++) {
        try {
          console.log('[fetchPools] Fetching pool', pid);
          const info = await masterChef.getPoolInfo(pid);
          
          // Get LP token info
          const lpToken = new Contract(info.lpToken, ERC20_ABI, provider);
          let lpName = 'LP Token';
          let token0Symbol = 'Token0';
          let token1Symbol = 'Token1';
          let token0Addr = '';
          let token1Addr = '';
          let token0Decimals = 18;
          let token1Decimals = 18;
          
          try {
            lpName = await lpToken.name();
          } catch {
            // If name() fails, use a generic name
            lpName = `LP Token ${pid}`;
          }
          
          // Try to get pair tokens from LP contract (Uniswap V2 pair)
          try {
            const pairABI = [
              { inputs: [], name: "token0", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
              { inputs: [], name: "token1", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
              { inputs: [], name: "getReserves", outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], stateMutability: "view", type: "function" },
              { inputs: [], name: "totalSupply", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }
            ];
            const pair = new Contract(info.lpToken, pairABI, provider);
            [token0Addr, token1Addr] = await Promise.all([
              pair.token0(),
              pair.token1()
            ]);
            
            // Get token symbols and decimals
            const token0Contract = new Contract(token0Addr, ERC20_ABI, provider);
            const token1Contract = new Contract(token1Addr, ERC20_ABI, provider);
            const [sym0, sym1, dec0, dec1] = await Promise.all([
              token0Contract.symbol().catch(() => 'Token'),
              token1Contract.symbol().catch(() => 'Token'),
              token0Contract.decimals().catch(() => 18),
              token1Contract.decimals().catch(() => 18)
            ]);
            token0Symbol = sym0;
            token1Symbol = sym1;
            // Ensure decimals are numbers (contract may return BigInt)
            token0Decimals = typeof dec0 === 'bigint' ? Number(dec0) : Number(dec0);
            token1Decimals = typeof dec1 === 'bigint' ? Number(dec1) : Number(dec1);
            lpName = `${sym0}-${sym1}`;
          } catch {
            // If pair interface fails, keep default names
            console.log('[fetchPools] Could not fetch pair token info for pool', pid);
          }
          
          // Calculate APR based on TVL (Total Value Locked)
          const blocksPerYearBigInt = BigInt(blocksPerYear);
          const poolYearlyReward = totalAlloc > 0n 
            ? (rewardRate * blocksPerYearBigInt * info.allocPoint) / totalAlloc
            : 0n;
          
          let apr = 0;
          
          // APR Calculation based on pool TVL (Total Value Locked)
          // Formula: APR = (Yearly Reward Value / Pool TVL) × 100
          if (token0Addr && token1Addr) {
            try {
              // Get LP pair reserves
              const pairABI = [
                { inputs: [], name: "getReserves", outputs: [{ type: "uint256" }, { type: "uint256" }], stateMutability: "view", type: "function" }
              ];
              const pair = new Contract(info.lpToken, pairABI, provider);
              const reserves = await pair.getReserves();
              
              const reserve0 = reserves[0];
              const reserve1 = reserves[1];
              const token0Lower = token0Addr.toLowerCase();
              const token1Lower = token1Addr.toLowerCase();
              
              // Normalize reserves to human-readable values
              const reserve0Normalized = Number(reserve0) / Math.pow(10, token0Decimals);
              const reserve1Normalized = Number(reserve1) / Math.pow(10, token1Decimals);
              
              // Yearly reward (already calculated with allocPoint ratio)
              const yearlyReward = Number(poolYearlyReward) / 1e18;
              
              if (STABLECOIN_ADDRESS && (token0Lower === STABLECOIN_ADDRESS || token1Lower === STABLECOIN_ADDRESS)) {
                // Pool contains stablecoin (e.g., VBC/USDT)
                // TVL = stablecoin reserve × 2 (AMM has equal value on both sides)
                const stablecoinReserve = token0Lower === STABLECOIN_ADDRESS 
                  ? reserve0Normalized
                  : reserve1Normalized;
                const wrappedNativeReserve = token0Lower === STABLECOIN_ADDRESS
                  ? reserve1Normalized
                  : reserve0Normalized;
                
                const tvlUSD = stablecoinReserve * 2;
                
                // Calculate native token price from this pool's reserves
                // nativePrice = stablecoin / wrappedNative (e.g., USDT / WVBC)
                const nativePriceUSD = wrappedNativeReserve > 0 
                  ? stablecoinReserve / wrappedNativeReserve 
                  : 0;
                
                // Value yearly reward using native token price
                // (assumes reward token has similar value to native token)
                const yearlyRewardUSD = yearlyReward * nativePriceUSD;
                
                if (tvlUSD > 0) {
                  apr = (yearlyRewardUSD / tvlUSD) * 100;
                }
                
                console.log('[fetchPools] Pool', pid, 'APR (stablecoin pool):', {
                  stablecoinReserve,
                  wrappedNativeReserve,
                  nativePriceUSD,
                  tvlUSD,
                  yearlyReward,
                  yearlyRewardUSD,
                  apr: apr.toFixed(2) + '%'
                });
              } else {
                // Non-stablecoin pool (native token pairs, e.g., VBC/VBCG)
                // TVL = reserve0 + reserve1 (both tokens assumed similar value)
                const tvlNative = reserve0Normalized + reserve1Normalized;
                
                // APR = (yearly reward / TVL) × 100
                // Since both reward and TVL are in native units, no USD conversion needed
                if (tvlNative > 0) {
                  apr = (yearlyReward / tvlNative) * 100;
                }
                
                console.log('[fetchPools] Pool', pid, 'APR (native pool):', {
                  reserve0: reserve0Normalized,
                  reserve1: reserve1Normalized,
                  tvlNative,
                  yearlyReward,
                  apr: apr.toFixed(2) + '%'
                });
              }
              
              // Cap APR at reasonable maximum
              if (apr > 9999) {
                apr = 9999;
              }
            } catch (aprError) {
              console.error('[fetchPools] Error calculating APR for pool', pid, ':', aprError);
              // APR calculation failed - leave as 0
            }
          }

          poolsData.push({
            pid,
            name: lpName,
            lpToken: info.lpToken,
            allocPoint: info.allocPoint,
            totalStaked: info.totalStaked,
            apr,
            token0Symbol,
            token1Symbol
          });
          console.log('[fetchPools] Pool', pid, 'loaded:', lpName, 'APR:', apr.toFixed(2) + '%');
        } catch (poolError) {
          console.error(`Error fetching pool ${pid}:`, poolError);
        }
      }

      setPools(poolsData);
    } catch (err) {
      console.error('Failed to fetch pools:', err);
      setError('Failed to fetch pool information');
    }
  }, [getReadOnlyProvider, getMasterChef, configReady, staticContracts, networkConfig, blocksPerYear, dexTokenConfig]);

  // Fetch user information
  const fetchUserInfo = useCallback(async () => {
    console.log('[fetchUserInfo] Called with:', { isConnected, account, poolsLength: pools.length });
    if (!isConnected || pools.length === 0 || !account || !staticContracts) {
      console.log('[fetchUserInfo] Skipping - conditions not met');
      return;
    }
    
    try {
      console.log('[fetchUserInfo] Fetching for account:', account);
      const provider = getReadOnlyProvider();
      const userAddress = account;
      
      const masterChef = getMasterChef(provider);
      const newUserPools = new Map<number, UserPoolData>();

      for (const pool of pools) {
        try {
          console.log('[fetchUserInfo] Fetching pool', pool.pid, 'lpToken:', pool.lpToken);
          const [userInfo, pending] = await Promise.all([
            masterChef.userInfo(pool.pid, userAddress),
            masterChef.pendingReward(pool.pid, userAddress)
          ]);

          const lpToken = new Contract(pool.lpToken, ERC20_ABI, provider);
          const balance = await lpToken.balanceOf(userAddress);
          
          // Try to get allowance, but some LP tokens may not support it
          let allowance = 0n;
          try {
            allowance = await lpToken.allowance(userAddress, staticContracts.masterChef);
          } catch (allowanceError) {
            console.log('[fetchUserInfo] Could not get allowance, setting to 0 (will require approval)');
            allowance = 0n; // Require approval if allowance call fails
          }

          console.log('[fetchUserInfo] Pool', pool.pid, 'balance:', balance.toString(), 'allowance:', allowance.toString());
          
          newUserPools.set(pool.pid, {
            stakedAmount: userInfo.amount,
            pendingReward: pending,
            lpBalance: balance,
            allowance
          });
        } catch (userError) {
          console.error(`Error fetching user info for pool ${pool.pid}:`, userError);
          newUserPools.set(pool.pid, {
            stakedAmount: 0n,
            pendingReward: 0n,
            lpBalance: 0n,
            allowance: 0n
          });
        }
      }

      console.log('[fetchUserInfo] Setting userPools:', newUserPools.size, 'pools');
      setUserPools(newUserPools);
    } catch (err) {
      console.error('Failed to fetch user info:', err);
    }
  }, [getReadOnlyProvider, getMasterChef, pools, isConnected, account, staticContracts]);

  // Connect wallet
  const connectWallet = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask is not installed');
      }
      
      if (!networkConfig) {
        throw new Error('Config not loaded');
      }
      
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      // Check and switch network if needed
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(chainId as string, 16) !== networkConfig.chainId) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${networkConfig.chainId.toString(16)}` }]
          });
        } catch (switchError: unknown) {
          // Chain not added, try to add it
          if ((switchError as { code?: number })?.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: `0x${networkConfig.chainId.toString(16)}`,
                chainName: networkConfig.name,
                rpcUrls: [networkConfig.rpcUrl],
                blockExplorerUrls: [networkConfig.explorer],
                nativeCurrency: {
                  name: 'VBC',
                  symbol: 'VBC',
                  decimals: 18
                }
              }]
            });
          } else {
            throw switchError;
          }
        }
      }
      
      const { address } = await getProviderAndSigner();
      setInternalAccount(address);
      setInternalIsConnected(true);
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, networkConfig]);

  // Approve LP token
  const approve = useCallback(async (pid: number) => {
    setLoading(true);
    setError(null);
    try {
      if (!staticContracts) {
        throw new Error('Config not loaded');
      }
      
      console.log('[approve] Starting approval for pid:', pid);
      const { signer, address } = await getProviderAndSigner();
      console.log('[approve] Signer address:', address);
      
      const pool = pools.find(p => p.pid === pid);
      if (!pool) throw new Error('Pool not found');
      console.log('[approve] LP Token:', pool.lpToken);
      console.log('[approve] MasterChef:', staticContracts.masterChef);

      const lpToken = new Contract(pool.lpToken, ERC20_ABI, signer);
      
      // Use a large but not max value to avoid potential overflow issues
      const approveAmount = ethers.parseEther('1000000000'); // 1 billion tokens
      console.log('[approve] Approve amount:', approveAmount.toString());
      
      const tx = await lpToken.approve(
        staticContracts.masterChef, 
        approveAmount
      );
      console.log('[approve] Transaction sent:', tx.hash);
      await tx.wait();
      console.log('[approve] Transaction confirmed');
      await fetchUserInfo();
      return true;
    } catch (err) {
      console.error('Approve failed:', err);
      setError(getErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, pools, fetchUserInfo, staticContracts]);

  // Deposit LP tokens
  const deposit = useCallback(async (pid: number, amount: string) => {
    setLoading(true);
    setError(null);
    try {
      if (!staticContracts) {
        throw new Error('Config not loaded');
      }
      
      console.log('[deposit] Starting deposit for pid:', pid, 'amount:', amount);
      const { signer, address } = await getProviderAndSigner();
      console.log('[deposit] Signer address:', address);
      
      const masterChef = getMasterChef(signer);
      const amountWei = ethers.parseEther(amount);
      console.log('[deposit] Amount in wei:', amountWei.toString());
      console.log('[deposit] MasterChef address:', staticContracts.masterChef);
      
      const tx = await masterChef.deposit(pid, amountWei);
      console.log('[deposit] Transaction sent:', tx.hash);
      await tx.wait();
      console.log('[deposit] Transaction confirmed');
      await fetchUserInfo();
      return true;
    } catch (err) {
      console.error('Deposit failed:', err);
      setError(getErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, getMasterChef, fetchUserInfo, staticContracts]);

  // Withdraw LP tokens
  const withdraw = useCallback(async (pid: number, amount: string) => {
    setLoading(true);
    setError(null);
    try {
      const { signer } = await getProviderAndSigner();
      const masterChef = getMasterChef(signer);
      const tx = await masterChef.withdraw(pid, ethers.parseEther(amount));
      await tx.wait();
      await fetchUserInfo();
      return true;
    } catch (err) {
      console.error('Withdraw failed:', err);
      setError(getErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, getMasterChef, fetchUserInfo]);

  // Harvest rewards
  const harvest = useCallback(async (pid: number) => {
    setLoading(true);
    setError(null);
    try {
      const { signer } = await getProviderAndSigner();
      const masterChef = getMasterChef(signer);
      const tx = await masterChef.harvest(pid);
      await tx.wait();
      await fetchUserInfo();
      return true;
    } catch (err) {
      console.error('Harvest failed:', err);
      setError(getErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, getMasterChef, fetchUserInfo]);

  // Harvest all rewards
  const harvestAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { signer } = await getProviderAndSigner();
      const masterChef = getMasterChef(signer);
      
      const pidsWithReward = Array.from(userPools.entries())
        .filter(([, data]) => data.pendingReward > 0n)
        .map(([pid]) => pid);

      if (pidsWithReward.length === 0) {
        setError('収穫可能な報酬がありません');
        return false;
      }

      const tx = await masterChef.harvestMultiple(pidsWithReward);
      await tx.wait();
      await fetchUserInfo();
      return true;
    } catch (err) {
      console.error('Harvest all failed:', err);
      setError(getErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, getMasterChef, userPools, fetchUserInfo]);

  // Emergency withdraw (no rewards)
  const emergencyWithdraw = useCallback(async (pid: number) => {
    setLoading(true);
    setError(null);
    try {
      const { signer } = await getProviderAndSigner();
      const masterChef = getMasterChef(signer);
      const tx = await masterChef.emergencyWithdraw(pid);
      await tx.wait();
      await fetchUserInfo();
      return true;
    } catch (err) {
      console.error('Emergency withdraw failed:', err);
      setError(getErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getProviderAndSigner, getMasterChef, fetchUserInfo]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Check if wallet is already connected (only when not using external address)
  useEffect(() => {
    if (externalAddress !== undefined) return; // Skip if using external address
    
    const checkConnection = async () => {
      if (typeof window !== 'undefined' && window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[];
          if (accounts.length > 0) {
            setInternalAccount(accounts[0]);
            setInternalIsConnected(true);
          }
        } catch (err) {
          console.error('Error checking connection:', err);
        }
      }
    };
    checkConnection();
  }, [externalAddress]);

  // Listen for account changes (only when not using external address)
  useEffect(() => {
    if (externalAddress !== undefined) return; // Skip if using external address
    
    if (typeof window !== 'undefined' && window.ethereum) {
      const handleAccountsChanged = (...args: unknown[]) => {
        const accounts = args[0] as string[];
        if (!accounts || accounts.length === 0) {
          setInternalAccount(null);
          setInternalIsConnected(false);
          setUserPools(new Map());
        } else {
          setInternalAccount(accounts[0]);
          setInternalIsConnected(true);
        }
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      return () => {
        window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [externalAddress]);

  // Initial pool fetch - only when config is ready
  useEffect(() => {
    if (configReady) {
      console.log('[useFarming] Config ready, fetching pools...');
      fetchPools();
    }
  }, [configReady, fetchPools]);

  // Fetch user info when pools are loaded and connected or account changes
  useEffect(() => {
    const fetchUserData = async () => {
      if (pools.length === 0 || !isConnected || !account || !staticContracts) {
        console.log('[useFarming] Skipping fetch:', { poolsLength: pools.length, isConnected, account, staticContracts: !!staticContracts });
        if (!isConnected || !account) {
          setUserPools(new Map());
        }
        return;
      }

      console.log('[useFarming] Fetching user info for:', account);
      
      try {
        const provider = getReadOnlyProvider();
        const masterChef = getMasterChef(provider);
        const newUserPools = new Map<number, UserPoolData>();

        for (const pool of pools) {
          try {
            console.log('[useFarming] Fetching pool', pool.pid);
            const [userInfo, pending] = await Promise.all([
              masterChef.userInfo(pool.pid, account),
              masterChef.pendingReward(pool.pid, account)
            ]);

            const lpToken = new Contract(pool.lpToken, ERC20_ABI, provider);
            const balance = await lpToken.balanceOf(account);
            
            // Try to get allowance, but some LP tokens may not support it
            let allowance = 0n;
            try {
              allowance = await lpToken.allowance(account, staticContracts.masterChef);
            } catch (allowanceError) {
              console.log('[useFarming] Could not get allowance, setting to 0 (will require approval)');
              allowance = 0n; // Require approval if allowance call fails
            }

            console.log('[useFarming] Pool', pool.pid, 'LP balance:', ethers.formatEther(balance));
            
            newUserPools.set(pool.pid, {
              stakedAmount: userInfo.amount,
              pendingReward: pending,
              lpBalance: balance,
              allowance
            });
          } catch (userError) {
            console.error(`[useFarming] Error fetching pool ${pool.pid}:`, userError);
            newUserPools.set(pool.pid, {
              stakedAmount: 0n,
              pendingReward: 0n,
              lpBalance: 0n,
              allowance: 0n
            });
          }
        }

        console.log('[useFarming] Setting userPools with', newUserPools.size, 'pools');
        setUserPools(newUserPools);
      } catch (err) {
        console.error('[useFarming] Failed to fetch user info:', err);
      }
    };

    fetchUserData();

    // Auto-refresh every 15 seconds
    if (isConnected && account && pools.length > 0) {
      const interval = setInterval(fetchUserData, 15000);
      return () => clearInterval(interval);
    }
  }, [pools, isConnected, account, getReadOnlyProvider, getMasterChef, staticContracts]);

  return {
    // State
    pools,
    userPools,
    rewardPerBlock,
    totalAllocPoint,
    loading,
    error,
    account,
    isConnected,
    configReady,
    
    // Actions
    connectWallet,
    approve,
    deposit,
    withdraw,
    harvest,
    harvestAll,
    emergencyWithdraw,
    refresh: fetchUserInfo,
    clearError
  };
}
