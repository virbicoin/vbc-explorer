'use client';

import { useState, useEffect } from 'react';
import { formatUnits, parseUnits, type Address } from 'viem';
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getDexContracts, FACTORY_ABI, ERC20_ABI, ROUTER_ABI } from '@/lib/dex/config';
import Link from 'next/link';

interface ListOnDexModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenBalance: bigint;
}

export default function ListOnDexModal({
  isOpen,
  onClose,
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  tokenBalance,
}: ListOnDexModalProps) {
  const { address, isConnected } = useAccount();
  const contracts = getDexContracts();
  
  const [tokenAmount, setTokenAmount] = useState('');
  const [vbcAmount, setVbcAmount] = useState('');
  const [step, setStep] = useState<'input' | 'approve' | 'liquidity' | 'success'>('input');
  const [txHash, setTxHash] = useState<string | null>(null);
  
  // Get VBC balance
  const { data: vbcBalance } = useBalance({
    address: address,
    query: { enabled: !!address },
  });

  // Check if pair already exists
  const { data: pairAddress, refetch: refetchPair } = useReadContract({
    address: contracts.factory,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [tokenAddress as Address, contracts.wrappedNative],
    query: { enabled: !!tokenAddress },
  });

  const pairExists = pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000';

  // Check current allowance
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, contracts.router] : undefined,
    query: { enabled: !!address },
  });

  // Approve transaction
  const { 
    writeContract: approveWrite, 
    data: approveHash, 
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isLoading: isConfirmingApprove, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  // Add liquidity transaction
  const {
    writeContract: liquidityWrite,
    data: liquidityHash,
    isPending: isAddingLiquidity,
    error: liquidityError,
    reset: resetLiquidity,
  } = useWriteContract();

  const { isLoading: isConfirmingLiquidity, isSuccess: isLiquiditySuccess } = useWaitForTransactionReceipt({
    hash: liquidityHash,
  });

  // Calculate parsed amounts
  const parsedTokenAmount = tokenAmount ? parseUnits(tokenAmount, tokenDecimals) : 0n;
  const parsedVbcAmount = vbcAmount ? parseUnits(vbcAmount, 18) : 0n;
  
  // Check if we need approval
  const needsApproval = currentAllowance !== undefined && parsedTokenAmount > 0n && currentAllowance < parsedTokenAmount;

  // Calculate initial price
  const initialPrice = parsedTokenAmount > 0n && parsedVbcAmount > 0n
    ? (Number(parsedVbcAmount) / Number(parsedTokenAmount)) * Math.pow(10, tokenDecimals - 18)
    : 0;

  // Handle approval success
  useEffect(() => {
    if (isApproveSuccess) {
      refetchAllowance();
      setStep('liquidity');
    }
  }, [isApproveSuccess, refetchAllowance]);

  // Handle liquidity success
  useEffect(() => {
    if (isLiquiditySuccess && liquidityHash) {
      setTxHash(liquidityHash);
      setStep('success');
      refetchPair();
    }
  }, [isLiquiditySuccess, liquidityHash, refetchPair]);

  const handleApprove = async () => {
    if (!parsedTokenAmount) return;
    
    try {
      approveWrite({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [contracts.router, parsedTokenAmount],
      });
      setStep('approve');
    } catch (err) {
      console.error('Approve error:', err);
    }
  };

  const handleAddLiquidity = async () => {
    if (!address || !parsedTokenAmount || !parsedVbcAmount) return;
    
    // Calculate min amounts with 1% slippage
    const amountTokenMin = (parsedTokenAmount * 99n) / 100n;
    const amountVbcMin = (parsedVbcAmount * 99n) / 100n;
    
    try {
      // Try VirBiCoin router first
      liquidityWrite({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidityVBC',
        args: [tokenAddress as Address, parsedTokenAmount, amountTokenMin, amountVbcMin, address],
        value: parsedVbcAmount,
      });
      setStep('liquidity');
    } catch (err) {
      console.error('Add liquidity error:', err);
    }
  };

  const handleSubmit = () => {
    if (needsApproval) {
      handleApprove();
    } else {
      handleAddLiquidity();
    }
  };

  const handleClose = () => {
    setStep('input');
    setTokenAmount('');
    setVbcAmount('');
    setTxHash(null);
    resetApprove();
    resetLiquidity();
    onClose();
  };

  const setMaxToken = () => {
    if (tokenBalance) {
      setTokenAmount(formatUnits(tokenBalance, tokenDecimals));
    }
  };

  const setMaxVbc = () => {
    if (vbcBalance?.value) {
      // Leave some for gas
      const maxVbc = vbcBalance.value > parseUnits('0.1', 18) 
        ? vbcBalance.value - parseUnits('0.1', 18) 
        : vbcBalance.value;
      setVbcAmount(formatUnits(maxVbc, 18));
    }
  };

  if (!isOpen) return null;

  const isProcessing = isApproving || isConfirmingApprove || isAddingLiquidity || isConfirmingLiquidity;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-2xl">💧</span>
            List on DEX
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'success' ? (
            <div className="text-center">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-white mb-2">Listing Complete!</h3>
              <p className="text-gray-400 mb-6">
                {tokenSymbol} has been listed on DEX.
              </p>
              
              {txHash && (
                <Link
                  href={`/tx/${txHash}`}
                  className="block mb-4 text-purple-400 hover:text-purple-300 text-sm font-mono"
                >
                  Tx: {txHash.slice(0, 16)}...{txHash.slice(-12)}
                </Link>
              )}

              <div className="flex gap-3 justify-center">
                <Link
                  href={`/dex?inputToken=${contracts.wrappedNative}&outputToken=${tokenAddress}`}
                  className="px-6 py-3 bg-purple-500 hover:bg-purple-600 rounded-xl text-white font-medium transition-colors"
                >
                  Trade on DEX
                </Link>
                <button
                  onClick={handleClose}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-white font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Warning for existing pair */}
              {pairExists && (
                <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <h4 className="text-yellow-400 font-medium mb-1">Pair Already Exists</h4>
                      <p className="text-gray-400 text-sm">
                        This token is already listed on DEX. You can add more liquidity.
                      </p>
                      <Link
                        href={`/dex?inputToken=${contracts.wrappedNative}&outputToken=${tokenAddress}`}
                        className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block"
                      >
                        View on DEX →
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Token Amount Input */}
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">
                  {tokenSymbol} Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-20 text-white text-lg focus:outline-none focus:border-purple-500"
                    disabled={isProcessing}
                  />
                  <button
                    onClick={setMaxToken}
                    className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 rounded text-purple-400 text-xs font-medium"
                    disabled={isProcessing}
                  >
                    MAX
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Balance: {formatUnits(tokenBalance || 0n, tokenDecimals)} {tokenSymbol}
                </div>
              </div>

              {/* VBC Amount Input */}
              <div className="mb-6">
                <label className="block text-sm text-gray-400 mb-2">
                  VBC Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={vbcAmount}
                    onChange={(e) => setVbcAmount(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-20 text-white text-lg focus:outline-none focus:border-purple-500"
                    disabled={isProcessing}
                  />
                  <button
                    onClick={setMaxVbc}
                    className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 rounded text-purple-400 text-xs font-medium"
                    disabled={isProcessing}
                  >
                    MAX
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Balance: {vbcBalance ? Number(formatUnits(vbcBalance.value, 18)).toFixed(4) : '0'} VBC
                </div>
              </div>

              {/* Price Info */}
              {initialPrice > 0 && (
                <div className="mb-6 p-4 bg-gray-800/50 rounded-xl">
                  <div className="text-sm text-gray-400 mb-2">Initial Price</div>
                  <div className="text-lg text-white font-medium">
                    1 {tokenSymbol} = {initialPrice.toFixed(6)} VBC
                  </div>
                  <div className="text-sm text-gray-500">
                    1 VBC = {(1 / initialPrice).toFixed(4)} {tokenSymbol}
                  </div>
                </div>
              )}

              {/* Info Box */}
              <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                <h4 className="text-blue-400 font-medium mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  About Listing
                </h4>
                <ul className="text-gray-400 text-sm space-y-1">
                  <li>• You will receive LP tokens for providing liquidity</li>
                  <li>• Initial price is determined by the ratio you input</li>
                  <li>• After listing, anyone can trade this token</li>
                </ul>
              </div>

              {/* Error Display */}
              {(approveError || liquidityError) && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                  {approveError?.message || liquidityError?.message || 'Transaction failed'}
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={handleSubmit}
                disabled={!parsedTokenAmount || !parsedVbcAmount || isProcessing || !isConnected}
                className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                  parsedTokenAmount && parsedVbcAmount && !isProcessing
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white'
                    : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isApproving ? 'Approving...' : isConfirmingApprove ? 'Confirming Approval...' : isAddingLiquidity ? 'Listing...' : 'Confirming...'}
                  </span>
                ) : needsApproval ? (
                  `Approve ${tokenSymbol}`
                ) : pairExists ? (
                  'Add Liquidity'
                ) : (
                  'List on DEX'
                )}
              </button>

              {!isConnected && (
                <p className="text-center text-yellow-400 text-sm mt-3">
                  Please connect your wallet
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
