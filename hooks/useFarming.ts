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

// Configuration cache
let configLoaded = false;
let networkConfigCache: NetworkConfig | null = null;
let staticContractsCache: MinimalContracts | null = null;
let blocksPerYearCache: number = 2628000; // Default

async function loadFarmingConfig(): Promise<{
  networkConfig: NetworkConfig;
  staticContracts: MinimalContracts;
  blocksPerYear: number;
}> {
  if (configLoaded && networkConfigCache && staticContractsCache) {
    return {
      networkConfig: networkConfigCache,
      staticContracts: staticContractsCache,
      blocksPerYear: blocksPerYearCache
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
    configLoaded = true;
    
    console.log('[loadFarmingConfig] Loaded config:', {
      chainId: networkConfigCache.chainId,
      masterChef: staticContractsCache.masterChef,
      router: staticContractsCache.router,
      blocksPerYear: blocksPerYearCache
    });
    
    return {
      networkConfig: networkConfigCache,
      staticContracts: staticContractsCache,
      blocksPerYear: blocksPerYearCache
    };
  } catch (error) {
    console.error('[loadFarmingConfig] Failed to load config:', error);
    // Return defaults
    return {
      networkConfig: getNetworkConfig(),
      staticContracts: getStaticContracts(),
      blocksPerYear: getBlocksPerYear()
    };
  }
}

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
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
              { inputs: [], name: "token1", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }
            ];
            const pair = new Contract(info.lpToken, pairABI, provider);
            const [token0Addr, token1Addr] = await Promise.all([
              pair.token0(),
              pair.token1()
            ]);
            
            // Get token symbols
            const token0 = new Contract(token0Addr, ERC20_ABI, provider);
            const token1 = new Contract(token1Addr, ERC20_ABI, provider);
            const [sym0, sym1] = await Promise.all([
              token0.symbol().catch(() => 'Token'),
              token1.symbol().catch(() => 'Token')
            ]);
            token0Symbol = sym0;
            token1Symbol = sym1;
            lpName = `${sym0}-${sym1}`;
          } catch {
            // If pair interface fails, keep default names
            console.log('[fetchPools] Could not fetch pair token info for pool', pid);
          }
          
          // Calculate APR
          const blocksPerYearBigInt = BigInt(blocksPerYear);
          const poolYearlyReward = totalAlloc > 0n 
            ? (rewardRate * blocksPerYearBigInt * info.allocPoint) / totalAlloc
            : 0n;
          
          // Simple APR calculation (assumes 1 LP = 1 reward token for simplicity)
          const apr = info.totalStaked > 0n
            ? Number((poolYearlyReward * 10000n) / info.totalStaked) / 100
            : 0;

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
          console.log('[fetchPools] Pool', pid, 'loaded:', lpName);
        } catch (poolError) {
          console.error(`Error fetching pool ${pid}:`, poolError);
        }
      }

      setPools(poolsData);
    } catch (err) {
      console.error('Failed to fetch pools:', err);
      setError('Failed to fetch pool information');
    }
  }, [getReadOnlyProvider, getMasterChef, configReady, staticContracts, networkConfig, blocksPerYear]);

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
