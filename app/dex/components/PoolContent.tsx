'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { type Address } from 'viem';
import Image from 'next/image';
import { TokenInput, SlippageSettings } from './index';
import {
  type Token,
  getNativeToken,
  DEFAULT_TOKENS,
  getWrappedNativeToken,
  DEFAULT_SLIPPAGE,
  DEX_CONTRACTS,
} from '@/lib/dex/config';
import {
  useAddLiquidity,
  useRemoveLiquidity,
  useTransferLPToPair,
  useBurnLP,
  useApproveToken,
  useTokenAllowance,
  usePairAddress,
  usePairInfo,
  useUserLPBalance,
  useReserves,
  isNativeToken,
  getTokenAddress,
  formatTokenAmount,
  formatTokenAmountForInput,
  parseTokenAmount,
} from '@/lib/dex/hooks';
import { useDexTokens } from '@/hooks/useDexTokens';
import { useTokenConfig } from '@/hooks/useTokenConfig';
import { ERC20ABI } from '@/abi/TokenFactoryABI';

// Default color for unknown tokens
const DEFAULT_TOKEN_COLOR = 'from-gray-500 to-gray-600';

// Token Icon Component for Pool - uses config for icons/colors
function PoolTokenIcon({ 
  symbol, 
  size = 20,
  getIcon,
  getColor 
}: { 
  symbol: string; 
  size?: number;
  getIcon: (symbol: string) => string | null;
  getColor: (symbol: string) => string;
}) {
  const iconPath = getIcon(symbol);
  const color = getColor(symbol);
  
  if (iconPath) {
    return (
      <div className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center border-2 border-gray-800 overflow-hidden`} style={{ width: size, height: size }}>
        <Image 
          src={iconPath} 
          alt={symbol} 
          width={size - 4} 
          height={size - 4}
          className="object-contain"
        />
      </div>
    );
  }
  
  return (
    <div className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center border-2 border-gray-800`} style={{ width: size, height: size }}>
      <span className="font-bold text-white" style={{ fontSize: size * 0.4 }}>{symbol.charAt(0)}</span>
    </div>
  );
}

type Tab = 'add' | 'remove';

interface PoolContentProps {
  initialTokenAddress?: string | null;
}

export function PoolContent({ initialTokenAddress }: PoolContentProps) {
  const { address, isConnected } = useAccount();
  const [initialTokenSet, setInitialTokenSet] = useState(false);
  const [customToken, setCustomToken] = useState<Token | null>(null);
  
  // Fetch tokens from API
  const { tokens: availableTokens, isLoading: isTokensLoading } = useDexTokens();
  
  // Token configuration from config.json
  const { 
    config: tokenConfig,
    getTokenIcon, 
    getTokenColor, 
    displaySymbol,
    isLoading: tokenConfigLoading 
  } = useTokenConfig();
  
  // Fetch custom token info from blockchain if not in available tokens
  const shouldFetchCustomToken = initialTokenAddress && 
    availableTokens.length > 0 && 
    !availableTokens.find(t => t.address.toLowerCase() === initialTokenAddress.toLowerCase());
  
  const { data: tokenName } = useReadContract({
    address: initialTokenAddress as Address,
    abi: ERC20ABI,
    functionName: 'name',
    query: { enabled: !!shouldFetchCustomToken },
  });
  
  const { data: tokenSymbol } = useReadContract({
    address: initialTokenAddress as Address,
    abi: ERC20ABI,
    functionName: 'symbol',
    query: { enabled: !!shouldFetchCustomToken },
  });
  
  const { data: tokenDecimals } = useReadContract({
    address: initialTokenAddress as Address,
    abi: ERC20ABI,
    functionName: 'decimals',
    query: { enabled: !!shouldFetchCustomToken },
  });
  
  // Build custom token when data is available
  useEffect(() => {
    if (shouldFetchCustomToken && tokenName && tokenSymbol && tokenDecimals !== undefined && initialTokenAddress) {
      console.log('Building custom token from blockchain:', { tokenName, tokenSymbol, tokenDecimals });
      setCustomToken({
        address: initialTokenAddress as Address,
        name: tokenName as string,
        symbol: tokenSymbol as string,
        decimals: tokenDecimals as number,
      });
    }
  }, [shouldFetchCustomToken, tokenName, tokenSymbol, tokenDecimals, initialTokenAddress]);
  
  // Combined token list (available + custom)
  const allTokens = useMemo(() => {
    if (customToken && !availableTokens.find(t => t.address.toLowerCase() === customToken.address.toLowerCase())) {
      return [...availableTokens, customToken];
    }
    return availableTokens;
  }, [availableTokens, customToken]);
  
  // State - use function to get current native token
  const [activeTab, setActiveTab] = useState<Tab>('add');
  const [tokenA, setTokenA] = useState<Token>(() => getNativeToken());
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [lpAmount, setLpAmount] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);

  // Update tokenA when available tokens change (config may have loaded)
  useEffect(() => {
    if (allTokens.length > 0) {
      // Find native token from available tokens
      const nativeToken = allTokens.find(t => t.address === '0x0000000000000000000000000000000000000000');
      if (nativeToken && tokenA.symbol !== nativeToken.symbol) {
        setTokenA(nativeToken);
      }
    }
  }, [allTokens, tokenA.symbol]);

  // Set tokenB from URL parameter or default
  useEffect(() => {
    if (allTokens.length > 0 && !initialTokenSet && tokenConfig) {
      // If initialTokenAddress is provided, find and set that token
      if (initialTokenAddress) {
        const targetToken = allTokens.find(t => 
          t.address.toLowerCase() === initialTokenAddress.toLowerCase()
        );
        if (targetToken) {
          console.log('Setting initial token B from URL:', targetToken.symbol);
          setTokenB(targetToken);
          setInitialTokenSet(true);
          return;
        }
        // If custom token is still loading, wait
        if (shouldFetchCustomToken && !customToken) {
          return;
        }
      }
      
      // Default: Find a token that's not native or wrapped native
      if (!tokenB) {
        const nativeSymbol = tokenConfig.native.symbol;
        const wrappedSymbol = tokenConfig.wrapped.symbol;
        const defaultB = allTokens.find(t => 
          t.symbol !== nativeSymbol && t.symbol !== wrappedSymbol
        );
        setTokenB(defaultB || (allTokens.length > 1 ? allTokens[1] : allTokens[0]));
      }
      setInitialTokenSet(true);
    }
  }, [allTokens, tokenB, tokenConfig, initialTokenAddress, initialTokenSet, shouldFetchCustomToken, customToken]);

  // Get pair address and reserves
  const tokenAAddress = getTokenAddress(tokenA);
  const tokenBAddress = tokenB ? getTokenAddress(tokenB) : ('0x0000000000000000000000000000000000000000' as Address);
  
  const { data: pairAddress } = usePairAddress(tokenAAddress, tokenBAddress);
  const { data: reserves, isLoading: isLoadingReserves } = useReserves(tokenAAddress, tokenBAddress);
  const pairInfo = usePairInfo(pairAddress as Address);
  const { data: lpBalance } = useUserLPBalance(pairAddress as Address, address);

  // Check if pair exists
  const pairExists = useMemo(() => {
    return pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000';
  }, [pairAddress]);

  // Check if this is first liquidity (no reserves yet)
  const isFirstLiquidity = useMemo(() => {
    if (!reserves) return true;
    return reserves[0] === 0n && reserves[1] === 0n;
  }, [reserves]);

  // Parse amounts
  const amountAParsed = useMemo(() => parseTokenAmount(amountA, tokenA.decimals), [amountA, tokenA.decimals]);
  const amountBParsed = useMemo(() => parseTokenAmount(amountB, tokenB?.decimals || 18), [amountB, tokenB?.decimals]);
  const lpAmountParsed = useMemo(() => parseTokenAmount(lpAmount, 18), [lpAmount]);

  // Calculate optimal amount B based on amount A
  const calculateOptimalAmountB = useCallback((inputAmountA: string) => {
    if (!reserves || !inputAmountA || reserves[0] === 0n || reserves[1] === 0n || !tokenB) {
      return '';
    }
    const parsedA = parseTokenAmount(inputAmountA, tokenA.decimals);
    if (parsedA === 0n) return '';
    
    // amountB = amountA * reserveB / reserveA
    const optimalB = (parsedA * reserves[1]) / reserves[0];
    return formatTokenAmount(optimalB, tokenB.decimals);
  }, [reserves, tokenA.decimals, tokenB]);

  // Calculate optimal amount A based on amount B
  const calculateOptimalAmountA = useCallback((inputAmountB: string) => {
    if (!reserves || !inputAmountB || reserves[0] === 0n || reserves[1] === 0n || !tokenB) {
      return '';
    }
    const parsedB = parseTokenAmount(inputAmountB, tokenB.decimals);
    if (parsedB === 0n) return '';
    
    // amountA = amountB * reserveA / reserveB
    const optimalA = (parsedB * reserves[0]) / reserves[1];
    return formatTokenAmount(optimalA, tokenA.decimals);
  }, [reserves, tokenA.decimals, tokenB]);

  // Handle amount A change - calculate optimal B
  const handleAmountAChange = (value: string) => {
    setAmountA(value);
    // Only auto-calculate if pair has liquidity (not first liquidity)
    if (pairExists && !isFirstLiquidity && value) {
      const optimalB = calculateOptimalAmountB(value);
      setAmountB(optimalB);
    }
    // For first liquidity, let user set both amounts freely
  };

  // Handle amount B change - calculate optimal A
  const handleAmountBChange = (value: string) => {
    setAmountB(value);
    // Only auto-calculate if pair has liquidity (not first liquidity)
    if (pairExists && !isFirstLiquidity && value) {
      const optimalA = calculateOptimalAmountA(value);
      setAmountA(optimalA);
    }
    // For first liquidity, let user set both amounts freely
  };

  // Check allowances
  const { data: allowanceA } = useTokenAllowance(
    tokenA.address as Address,
    address,
    DEX_CONTRACTS.router
  );
  const { data: allowanceB } = useTokenAllowance(
    tokenB?.address as Address,
    address,
    DEX_CONTRACTS.router
  );

  const needsApprovalA = useMemo(() => {
    if (isNativeToken(tokenA)) return false;
    if (!allowanceA) return true;
    return (allowanceA as bigint) < amountAParsed;
  }, [tokenA, allowanceA, amountAParsed]);

  const needsApprovalB = useMemo(() => {
    if (!tokenB || isNativeToken(tokenB)) return false;
    if (!allowanceB) return true;
    return (allowanceB as bigint) < amountBParsed;
  }, [tokenB, allowanceB, amountBParsed]);

  // Approve hook
  const {
    approve,
    isPending: isApproving,
    isConfirming: isApproveConfirming,
  } = useApproveToken();

  // Add liquidity hook
  const {
    addLiquidity,
    addLiquidityVBC,
    isPending: isAdding,
    isConfirming: isAddConfirming,
    isSuccess: isAddSuccess,
    error: addError,
    hash: addHash,
  } = useAddLiquidity();

  // Remove liquidity hooks (2-step: transfer to pair, then burn)
  const {
    transferToPair,
    isPending: isTransferring,
    isConfirming: isTransferConfirming,
    isSuccess: isTransferSuccess,
    error: transferError,
    hash: transferHash,
  } = useTransferLPToPair();

  const {
    burn,
    isPending: isBurning,
    isConfirming: isBurnConfirming,
    isSuccess: isBurnSuccess,
    error: burnError,
    hash: burnHash,
  } = useBurnLP();

  // Track remove liquidity state
  const [removeStep, setRemoveStep] = useState<'idle' | 'transferring' | 'burning' | 'done'>('idle');
  
  const isRemoving = isTransferring || isBurning;
  const isRemoveConfirming = isTransferConfirming || isBurnConfirming;
  const isRemoveSuccess = isBurnSuccess;
  const removeError = transferError || burnError;
  const removeHash = burnHash || transferHash;

  // Handle approve token A
  const handleApproveA = useCallback(async () => {
    if (!address) return;
    try {
      await approve(tokenA.address as Address, DEX_CONTRACTS.router, amountAParsed);
    } catch (error) {
      console.error('Approve A error:', error);
    }
  }, [approve, tokenA.address, address, amountAParsed]);

  // Handle approve token B
  const handleApproveB = useCallback(async () => {
    if (!address || !tokenB) return;
    try {
      await approve(tokenB.address as Address, DEX_CONTRACTS.router, amountBParsed);
    } catch (error) {
      console.error('Approve B error:', error);
    }
  }, [approve, tokenB, address, amountBParsed]);

  // Handle add liquidity
  const handleAddLiquidity = useCallback(async () => {
    if (!address || amountAParsed === 0n || amountBParsed === 0n || !tokenB) return;

    // Calculate minimum amounts with slippage
    const minAmountA = (amountAParsed * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;
    const minAmountB = (amountBParsed * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;

    try {
      if (isNativeToken(tokenA)) {
        // Add liquidity with VBC
        await addLiquidityVBC(
          tokenBAddress,
          amountBParsed,
          minAmountB,
          minAmountA,
          address,
          amountAParsed
        );
      } else if (isNativeToken(tokenB)) {
        // Add liquidity with VBC (swapped)
        await addLiquidityVBC(
          tokenAAddress,
          amountAParsed,
          minAmountA,
          minAmountB,
          address,
          amountBParsed
        );
      } else {
        // Add liquidity tokens only
        await addLiquidity(
          tokenAAddress,
          tokenBAddress,
          amountAParsed,
          amountBParsed,
          minAmountA,
          minAmountB,
          address
        );
      }
    } catch (error) {
      console.error('Add liquidity error:', error);
    }
  }, [address, amountAParsed, amountBParsed, slippage, tokenA, tokenB, tokenAAddress, tokenBAddress, addLiquidity, addLiquidityVBC]);

  // Handle remove liquidity (2-step: transfer LP to pair, then burn)
  const handleRemoveLiquidity = useCallback(async () => {
    if (!address || lpAmountParsed === 0n || !pairAddress) return;

    try {
      setRemoveStep('transferring');
      // Step 1: Transfer LP tokens to the pair contract
      await transferToPair(pairAddress as Address, lpAmountParsed);
    } catch (error) {
      console.error('Remove liquidity error (transfer step):', error);
      setRemoveStep('idle');
    }
  }, [address, lpAmountParsed, pairAddress, transferToPair]);

  // Step 2: After transfer succeeds, burn the LP tokens
  useEffect(() => {
    const executeBurn = async () => {
      if (isTransferSuccess && removeStep === 'transferring' && address && pairAddress) {
        try {
          setRemoveStep('burning');
          await burn(pairAddress as Address, address);
        } catch (error) {
          console.error('Remove liquidity error (burn step):', error);
          setRemoveStep('idle');
        }
      }
    };
    executeBurn();
  }, [isTransferSuccess, removeStep, address, pairAddress, burn]);

  // Reset remove step on burn success
  useEffect(() => {
    if (isBurnSuccess) {
      setRemoveStep('done');
      setTimeout(() => setRemoveStep('idle'), 2000);
    }
  }, [isBurnSuccess]);

  // Clear amounts on success
  useEffect(() => {
    if (isAddSuccess) {
      setAmountA('');
      setAmountB('');
    }
  }, [isAddSuccess]);

  useEffect(() => {
    if (isRemoveSuccess) {
      setLpAmount('');
    }
  }, [isRemoveSuccess]);

  // Calculate pool share
  const poolShare = useMemo(() => {
    if (!reserves || !amountAParsed || reserves[0] === 0n) return '0';
    const share = (Number(amountAParsed) / Number(reserves[0] + amountAParsed)) * 100;
    return share.toFixed(4);
  }, [reserves, amountAParsed]);

  // Button state for add
  const addButtonState = useMemo(() => {
    if (!isConnected) return { text: 'Connect Wallet', disabled: true };
    if (!tokenB) return { text: 'Select Token B', disabled: true };
    if (!amountA || amountAParsed === 0n) return { text: 'Enter Amount', disabled: true };
    if (!amountB || amountBParsed === 0n) return { text: 'Enter Amount', disabled: true };
    if (needsApprovalA) {
      if (isApproving || isApproveConfirming) return { text: 'Approving...', disabled: true };
      return { text: `Approve ${tokenA.symbol}`, disabled: false, action: 'approveA' };
    }
    if (needsApprovalB) {
      if (isApproving || isApproveConfirming) return { text: 'Approving...', disabled: true };
      return { text: `Approve ${tokenB.symbol}`, disabled: false, action: 'approveB' };
    }
    if (isAdding || isAddConfirming) return { text: 'Adding...', disabled: true };
    return { text: 'Add Liquidity', disabled: false, action: 'add' };
  }, [isConnected, tokenB, amountA, amountB, amountAParsed, amountBParsed, needsApprovalA, needsApprovalB, isApproving, isApproveConfirming, isAdding, isAddConfirming, tokenA.symbol]);

  // Button state for remove (no approval needed - direct transfer to pair)
  const removeButtonState = useMemo(() => {
    if (!isConnected) return { text: 'Connect Wallet', disabled: true };
    if (!lpAmount || lpAmountParsed === 0n) return { text: 'Enter Amount', disabled: true };
    if (removeStep === 'transferring') return { text: 'Transferring LP...', disabled: true };
    if (removeStep === 'burning') return { text: 'Burning LP...', disabled: true };
    if (isRemoving || isRemoveConfirming) return { text: 'Removing...', disabled: true };
    return { text: 'Remove Liquidity', disabled: false, action: 'remove' };
  }, [isConnected, lpAmount, lpAmountParsed, removeStep, isRemoving, isRemoveConfirming]);

  const handleAddButtonClick = () => {
    if (addButtonState.action === 'approveA') {
      handleApproveA();
    } else if (addButtonState.action === 'approveB') {
      handleApproveB();
    } else if (addButtonState.action === 'add') {
      handleAddLiquidity();
    }
  };

  const handleRemoveButtonClick = () => {
    if (removeButtonState.action === 'remove') {
      handleRemoveLiquidity();
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Main Pool Card */}
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-gray-700/50 relative overflow-hidden">
        {/* Background Glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 relative">
          <div>
            <h1 className="text-2xl font-bold text-white">Pool</h1>
            <p className="text-sm text-gray-400 mt-1">Add or remove liquidity</p>
          </div>
          <SlippageSettings slippage={slippage} onSlippageChange={setSlippage} />
        </div>

        {/* Tabs */}
        <div className="flex mb-6 bg-gray-800/60 rounded-2xl p-1.5 relative">
          <button
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-2.5 rounded-xl font-semibold transition-all ${
              activeTab === 'add'
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Add
          </button>
          <button
            onClick={() => setActiveTab('remove')}
            className={`flex-1 py-2.5 rounded-xl font-semibold transition-all ${
              activeTab === 'remove'
                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Remove
          </button>
        </div>

        {activeTab === 'add' ? (
          // Add Liquidity
          <>
            <div className="space-y-2 relative">
              <TokenInput
                label="Token A"
                token={tokenA}
                amount={amountA}
                onAmountChange={handleAmountAChange}
                onTokenChange={setTokenA}
                otherToken={tokenB || undefined}
                tokens={allTokens}
              />

              {/* Plus Icon */}
              <div className="flex justify-center -my-4 relative z-10">
                <div className="bg-gray-700 p-3 rounded-xl border-4 border-gray-900 shadow-lg">
                  <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              </div>

              {tokenB && (
                <TokenInput
                  label="Token B"
                  token={tokenB}
                  amount={amountB}
                  onAmountChange={handleAmountBChange}
                  onTokenChange={setTokenB}
                  otherToken={tokenA}
                  tokens={allTokens}
                />
              )}
            </div>

            {/* Pool Info */}
            {amountA && amountB && tokenB && (
              <div className="mt-4 p-4 bg-gray-800/60 border border-gray-700/50 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Pool Share</span>
                  <span className="font-semibold text-white">{poolShare}%</span>
                </div>
                {reserves && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">{tokenA.symbol} Pooled</span>
                      <span className="font-medium text-gray-200">{formatTokenAmount(reserves[0], tokenA.decimals)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">{tokenB.symbol} Pooled</span>
                      <span className="font-medium text-gray-200">{formatTokenAmount(reserves[1], tokenB.decimals)}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* First LP Warning */}
            {isFirstLiquidity && amountA && amountB && (
              <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-yellow-400 font-semibold text-sm">First Liquidity Provider</p>
                  <p className="text-yellow-500/80 text-xs mt-1">The ratio you set will define the initial price. Enter amounts for both tokens.</p>
                </div>
              </div>
            )}

            <button
              onClick={handleAddButtonClick}
              disabled={addButtonState.disabled}
              className={`w-full mt-6 py-4 rounded-2xl font-bold text-lg transition-all relative overflow-hidden ${
                addButtonState.disabled
                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02]'
              }`}
            >
              {(isAdding || isAddConfirming || isApproving || isApproveConfirming) && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg className="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </span>
              )}
              <span className={isAdding || isAddConfirming || isApproving || isApproveConfirming ? 'opacity-0' : ''}>
                {addButtonState.text}
              </span>
            </button>

            {/* Transaction Status */}
            {isAddSuccess && addHash && (
              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-green-400 font-semibold">Liquidity Added!</p>
                  <a
                    href={`/tx/${addHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-500/80 text-sm hover:text-green-400 flex items-center gap-1 mt-1"
                  >
                    View transaction
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            )}

            {addError && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-red-400 font-semibold">Transaction Failed</p>
                  <p className="text-red-500/80 text-sm mt-1">{addError.message}</p>
                </div>
              </div>
            )}
          </>
        ) : (
          // Remove Liquidity
          <>
            <div className="space-y-4 relative">
              {/* LP Balance Info */}
              <div className="p-4 bg-gray-800/60 border border-gray-700/50 rounded-2xl">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400 text-sm">Your LP Balance</span>
                  <span className="font-semibold text-white">
                    {lpBalance ? formatTokenAmount(lpBalance as bigint, 18, 6) : '0'} LP
                  </span>
                </div>
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <div className="flex -space-x-1">
                    <PoolTokenIcon symbol={tokenA.symbol} size={20} getIcon={getTokenIcon} getColor={getTokenColor} />
                    <PoolTokenIcon symbol={tokenB?.symbol || '?'} size={20} getIcon={getTokenIcon} getColor={getTokenColor} />
                  </div>
                  {displaySymbol(tokenA.symbol)}/{tokenB ? displaySymbol(tokenB.symbol) : '???'} Pool
                </div>
              </div>

              {/* LP Amount Input */}
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-400">LP Amount to Remove</label>
                  <button
                    onClick={() => lpBalance && setLpAmount(formatTokenAmountForInput(lpBalance as bigint, 18, 18))}
                    className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                <input
                  type="text"
                  value={lpAmount}
                  onChange={(e) => setLpAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-transparent text-3xl font-bold outline-none text-white placeholder-gray-600"
                />
              </div>

              {/* Percentage Buttons */}
              <div className="flex gap-2">
                {[25, 50, 75, 100].map((percent) => (
                  <button
                    key={percent}
                    onClick={() => {
                      if (lpBalance) {
                        const amount = ((lpBalance as bigint) * BigInt(percent)) / 100n;
                        setLpAmount(formatTokenAmountForInput(amount, 18, 18));
                      }
                    }}
                    className="flex-1 py-2.5 bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700/50 hover:border-gray-600 rounded-xl text-sm font-semibold transition-all hover:scale-105"
                  >
                    {percent}%
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleRemoveButtonClick}
              disabled={removeButtonState.disabled}
              className={`w-full mt-6 py-4 rounded-2xl font-bold text-lg transition-all relative overflow-hidden ${
                removeButtonState.disabled
                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40 hover:scale-[1.02]'
              }`}
            >
              {(isRemoving || isRemoveConfirming || isApproving || isApproveConfirming) && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg className="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </span>
              )}
              <span className={isRemoving || isRemoveConfirming || isApproving || isApproveConfirming ? 'opacity-0' : ''}>
                {removeButtonState.text}
              </span>
            </button>

            {/* Transaction Status */}
            {isRemoveSuccess && removeHash && (
              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-green-400 font-semibold">Liquidity Removed!</p>
                  <a
                    href={`/tx/${removeHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-500/80 text-sm hover:text-green-400 flex items-center gap-1 mt-1"
                  >
                    View transaction
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            )}

            {removeError && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-red-400 font-semibold">Transaction Failed</p>
                  <p className="text-red-500/80 text-sm mt-1">{removeError.message}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
