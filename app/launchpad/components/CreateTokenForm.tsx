'use client';

import { useState, useEffect, useRef } from 'react';
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useBalance,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { parseUnits, formatUnits, parseEventLogs, type Address, erc20Abi } from 'viem';
import { useWriteContract, useReadContract } from 'wagmi';
import { TokenFactoryV2ABI } from '@/abi/TokenFactoryV2ABI';

import { useLaunchpadConfig, getActiveFactoryAddress } from '@/hooks/useLaunchpadConfig';
import { ConnectWalletButton } from './ConnectWalletButton';
import { getCurrencySymbol, initializeCurrencyConfig } from '@/lib/client-config';

type PaymentMethod = 'native' | 'alternative';

// sessionStorage key for the create-form draft (survives tab switches)
const DRAFT_KEY = 'launchpad-create-token-draft';

export function CreateTokenForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { config, isLoading: isConfigLoading, activeFactoryAddress } = useLaunchpadConfig();

  // Form state - Basic
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [totalSupply, setTotalSupply] = useState('');

  // Form state - Metadata (V2 only)
  const [logoUrl, setLogoUrl] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Payment method state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('native');
  const [isApproving, setIsApproving] = useState(false);

  // UI state
  const [showSuccess, setShowSuccess] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);

  // Native currency symbol (loaded from config)
  const [nativeCurrencySymbol, setNativeCurrencySymbol] = useState<string>('');

  // Always use V2 factory ABI
  const factoryABI = TokenFactoryV2ABI;

  // Alternative payment token from config
  const altPayment = config?.alternativePayment;
  const altTokenAddress = altPayment?.token?.address as Address | undefined;
  const altTokenSymbol = altPayment?.token?.symbol || 'TOKEN';
  const altTokenDecimals = altPayment?.token?.decimals || 18;

  // Get user native balance
  const { data: balance } = useBalance({
    address,
    query: {
      enabled: isConnected,
    },
  });

  // Get user alternative token balance
  const { data: altTokenBalance } = useReadContract({
    address: altTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!altTokenAddress && !!address && !!altPayment?.enabled,
    },
  });

  // Get alternative token allowance
  const { data: altTokenAllowance, refetch: refetchAllowance } = useReadContract({
    address: altTokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && activeFactoryAddress ? [address, activeFactoryAddress as Address] : undefined,
    query: {
      enabled:
        isConnected &&
        !!altTokenAddress &&
        !!address &&
        !!activeFactoryAddress &&
        !!altPayment?.enabled,
    },
  });

  // Get creation fee from contract (native)
  const { data: creationFee } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: 'creationFee',
    query: {
      enabled: !!activeFactoryAddress,
    },
  });

  // Get alternative fee info from contract
  // Note: The actual function name depends on the contract deployment
  // Use getVBCGFeeInfo for current contract, or getAlternativeFeeInfo for generic contracts
  const altFeeFunction = altPayment?.contractFunctions?.getFeeInfo || 'getVBCGFeeInfo';
  const { data: altFeeInfo } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: altFeeFunction as 'getVBCGFeeInfo' | 'getAlternativeFeeInfo',
    query: {
      enabled: !!activeFactoryAddress && !!altPayment?.enabled,
    },
  }) as { data: [Address, bigint, bigint] | undefined };

  const altFee = altFeeInfo?.[1] ?? 0n;
  const altTotalBurned = altFeeInfo?.[2] ?? 0n;

  // Write contract hook
  const {
    data: txHash,
    isPending,
    writeContract,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Separate hook for approve
  const {
    data: approveTxHash,
    isPending: isApprovePending,
    writeContract: writeApprove,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  // Wait for transaction
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Wait for approve transaction
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({
      hash: approveTxHash,
    });

  // Handle approve confirmation - proceed to create token
  useEffect(() => {
    if (isApproveConfirmed && isApproving) {
      setIsApproving(false);
      refetchAllowance();
      // Trigger token creation after approval
      handleCreateTokenWithAltPayment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproveConfirmed]);

  // Register token to database
  const registerToken = async (tokenAddress: string, creatorAddress: string) => {
    console.log('[RegisterToken] Starting registration for:', tokenAddress, 'by:', creatorAddress);
    try {
      const response = await fetch('/api/launchpad/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          creator: creatorAddress,
          metadata: { logoUrl, description, website },
        }),
      });
      const data = await response.json();
      if (data.success) {
        console.log('[RegisterToken] Token registered to database successfully:', data);
      } else {
        console.error('[RegisterToken] Failed to register token:', data.error);
      }
    } catch (error) {
      console.error('[RegisterToken] Error registering token:', error);
    }
  };

  // Initialize currency config on mount
  useEffect(() => {
    initializeCurrencyConfig().then(() => {
      setNativeCurrencySymbol(getCurrencySymbol());
    });
  }, []);

  // Restore a draft saved before a tab switch. The create tab unmounts when
  // switching tabs, which used to silently drop filled-in metadata.
  // (Runs post-hydration; restoring in useState initializers would mismatch SSR.)
  const isDraftLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<Record<string, string>>;
        if (draft.tokenName) setTokenName(draft.tokenName);
        if (draft.tokenSymbol) setTokenSymbol(draft.tokenSymbol);
        if (draft.decimals) setDecimals(draft.decimals);
        if (draft.totalSupply) setTotalSupply(draft.totalSupply);
        if (draft.logoUrl) setLogoUrl(draft.logoUrl);
        if (draft.description) setDescription(draft.description);
        if (draft.website) setWebsite(draft.website);
        // Reopen the metadata section so restored values stay visible
        if (draft.logoUrl || draft.description || draft.website) setShowAdvanced(true);
      }
    } catch {
      // Corrupt/unavailable storage - start with a clean form
    }
    isDraftLoaded.current = true;
  }, []);

  // Save the draft on every change (after the initial restore has run)
  useEffect(() => {
    if (!isDraftLoaded.current) return;
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          tokenName,
          tokenSymbol,
          decimals,
          totalSupply,
          logoUrl,
          description,
          website,
        })
      );
    } catch {
      // Storage unavailable (private mode etc.) - drafts just won't persist
    }
  }, [tokenName, tokenSymbol, decimals, totalSupply, logoUrl, description, website]);

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed && receipt) {
      console.log(
        'Transaction receipt:',
        JSON.stringify(
          receipt,
          (key, value) => (typeof value === 'bigint' ? value.toString() : value),
          2
        )
      );

      let foundTokenAddress: string | null = null;

      // Use viem's parseEventLogs to decode the TokenCreated event
      try {
        // Try TokenCreatedWithMetadata first
        try {
          const parsedLogsV2 = parseEventLogs({
            abi: TokenFactoryV2ABI,
            logs: receipt.logs,
            eventName: 'TokenCreatedWithMetadata',
          });
          if (parsedLogsV2.length > 0) {
            foundTokenAddress = parsedLogsV2[0].args.token;
            console.log(
              'Extracted token address from TokenCreatedWithMetadata:',
              foundTokenAddress
            );
          }
        } catch {
          // Try regular TokenCreated
        }

        // Fall back to TokenCreated
        if (!foundTokenAddress) {
          const parsedLogs = parseEventLogs({
            abi: factoryABI,
            logs: receipt.logs,
            eventName: 'TokenCreated',
          });

          console.log('Parsed TokenCreated events:', parsedLogs);

          if (parsedLogs.length > 0) {
            foundTokenAddress = parsedLogs[0].args.token;
            console.log('Extracted token address:', foundTokenAddress);
          }
        }

        // Fallback: Find any log from a new contract (not factory)
        if (!foundTokenAddress) {
          console.log('No TokenCreated event found, trying fallback...');
          for (const log of receipt.logs) {
            if (
              log.address &&
              log.address.toLowerCase() !== activeFactoryAddress?.toLowerCase() &&
              log.address !== '0x0000000000000000000000000000000000000000'
            ) {
              console.log('Using log address as fallback:', log.address);
              foundTokenAddress = log.address;
              break;
            }
          }
        }
      } catch (parseError) {
        console.error('Failed to parse logs:', parseError);
        // Fallback to manual extraction
        for (const log of receipt.logs) {
          if (
            log.address &&
            log.address.toLowerCase() !== activeFactoryAddress?.toLowerCase() &&
            log.address !== '0x0000000000000000000000000000000000000000'
          ) {
            console.log('Using log address as fallback:', log.address);
            foundTokenAddress = log.address;
            break;
          }
        }
      }

      // Set deployed address and register to database
      if (foundTokenAddress) {
        console.log('[CreateToken] Token address found:', foundTokenAddress);
        setDeployedAddress(foundTokenAddress);
        // Register token to database for /tokens page
        if (address) {
          console.log('[CreateToken] Registering token to database...');
          registerToken(foundTokenAddress, address);
        } else {
          console.warn('[CreateToken] No wallet address available, skipping registration');
        }
      } else {
        console.error('[CreateToken] Failed to extract token address from receipt');
      }

      setShowSuccess(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, receipt, activeFactoryAddress, address]);

  // Validation
  const isValidForm =
    tokenName.trim().length > 0 &&
    tokenName.trim().length <= 50 &&
    tokenSymbol.trim().length > 0 &&
    tokenSymbol.trim().length <= 11 &&
    parseInt(decimals) >= 0 &&
    parseInt(decimals) <= 18 &&
    parseFloat(totalSupply) > 0;

  // URL validation
  const isValidUrl = (url: string) => {
    if (!url) return true; // Empty is valid (optional field)
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const isMetadataValid = isValidUrl(logoUrl) && isValidUrl(website) && description.length <= 500;

  const hasEnoughBalance = balance && creationFee && balance.value >= creationFee;
  const hasEnoughAltToken =
    altTokenBalance !== undefined && altFee > 0n && altTokenBalance >= altFee;
  const hasAltTokenAllowance =
    altTokenAllowance !== undefined && altFee > 0n && altTokenAllowance >= altFee;

  // Check if on correct chain
  const isCorrectChain = config?.chainId ? chainId === config.chainId : true;

  // Determine if using metadata
  const hasMetadata = logoUrl.trim() || description.trim() || website.trim();

  // Handle alternative token approval
  const handleApproveAltToken = async () => {
    if (!altTokenAddress || !activeFactoryAddress || !altFee) return;

    setIsApproving(true);
    try {
      writeApprove({
        address: altTokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [activeFactoryAddress as Address, altFee],
      });
    } catch (error) {
      console.error('Failed to approve alternative token:', error);
      setIsApproving(false);
    }
  };

  // Handle create token with alternative payment
  const handleCreateTokenWithAltPayment = async () => {
    console.log('[CreateToken] Using ALTERNATIVE payment method (VBCG)');
    if (!activeFactoryAddress || !isValidForm || !isMetadataValid) return;

    // Get contract function names from config
    const createTokenFunc = altPayment?.contractFunctions?.createToken || 'createTokenWithVBCG';
    const createTokenWithMetadataFunc =
      altPayment?.contractFunctions?.createTokenWithMetadata || 'createTokenWithVBCGAndMetadata';

    try {
      const supplyWithDecimals = parseUnits(totalSupply, parseInt(decimals));
      console.log(
        '[CreateToken] Creating token with alternative payment, supply:',
        supplyWithDecimals.toString(),
        'function:',
        hasMetadata ? createTokenWithMetadataFunc : createTokenFunc
      );

      if (hasMetadata) {
        writeContract({
          address: activeFactoryAddress as Address,
          abi: TokenFactoryV2ABI,
          functionName: createTokenWithMetadataFunc as
            'createTokenWithVBCGAndMetadata' | 'createTokenWithAlternativeAndMetadata',
          args: [
            tokenName,
            tokenSymbol.toUpperCase(),
            parseInt(decimals),
            supplyWithDecimals,
            logoUrl.trim(),
            description.trim(),
            website.trim(),
          ],
        });
      } else {
        writeContract({
          address: activeFactoryAddress as Address,
          abi: TokenFactoryV2ABI,
          functionName: createTokenFunc as 'createTokenWithVBCG' | 'createTokenWithAlternative',
          args: [tokenName, tokenSymbol.toUpperCase(), parseInt(decimals), supplyWithDecimals],
        });
      }
    } catch (error) {
      console.error('Failed to create token with alternative payment:', error);
    }
  };

  // Handle create token (main handler)
  const handleCreateToken = async () => {
    console.log('[CreateToken] Attempting to create token:', {
      isConnected,
      activeFactoryAddress,
      isValidForm,
      isMetadataValid,
      paymentMethod,
      creationFee: creationFee?.toString(),
      altFee: altFee?.toString(),
    });

    if (!isConnected) {
      console.error('[CreateToken] Wallet not connected');
      return;
    }
    if (!activeFactoryAddress) {
      console.error('[CreateToken] Factory address not available');
      return;
    }
    if (!isValidForm) {
      console.error('[CreateToken] Form validation failed');
      return;
    }
    if (!isMetadataValid) {
      console.error('[CreateToken] Metadata validation failed');
      return;
    }

    // Handle alternative token payment
    if (paymentMethod === 'alternative') {
      if (!hasEnoughAltToken) {
        console.error('[CreateToken] Insufficient alternative token balance');
        return;
      }
      if (!hasAltTokenAllowance) {
        // Need to approve first
        handleApproveAltToken();
        return;
      }
      // Has allowance, proceed with creation
      handleCreateTokenWithAltPayment();
      return;
    }

    // Handle native payment
    console.log('[CreateToken] Using NATIVE payment method (VBC)');
    try {
      const supplyWithDecimals = parseUnits(totalSupply, parseInt(decimals));
      console.log(
        '[CreateToken] Creating token with native payment, supply:',
        supplyWithDecimals.toString(),
        'fee:',
        creationFee?.toString()
      );

      if (hasMetadata) {
        // Use createTokenWithMetadata with metadata
        console.log(
          '[CreateToken] Calling createTokenWithMetadata with value:',
          creationFee?.toString()
        );
        writeContract({
          address: activeFactoryAddress as Address,
          abi: TokenFactoryV2ABI,
          functionName: 'createTokenWithMetadata',
          args: [
            tokenName,
            tokenSymbol.toUpperCase(),
            parseInt(decimals),
            supplyWithDecimals,
            logoUrl.trim(),
            description.trim(),
            website.trim(),
          ],
          value: creationFee || 0n,
        });
      } else {
        // Use standard createToken
        console.log('[CreateToken] Calling createToken with value:', creationFee?.toString());
        writeContract({
          address: activeFactoryAddress as Address,
          abi: factoryABI,
          functionName: 'createToken',
          args: [tokenName, tokenSymbol.toUpperCase(), parseInt(decimals), supplyWithDecimals],
          value: creationFee || 0n,
        });
      }
    } catch (error) {
      console.error('Failed to create token:', error);
    }
  };

  // Reset form
  const handleReset = () => {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Storage unavailable - nothing to clear
    }
    setTokenName('');
    setTokenSymbol('');
    setDecimals('18');
    setTotalSupply('');
    setLogoUrl('');
    setDescription('');
    setWebsite('');
    setShowAdvanced(false);
    setPaymentMethod('native');
    setIsApproving(false);
    setShowSuccess(false);
    setDeployedAddress(null);
    resetWrite();
    resetApprove();
  };

  // Add token to MetaMask
  const addToMetaMask = async () => {
    if (!deployedAddress || typeof window === 'undefined' || !window.ethereum) return;

    try {
      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: deployedAddress,
            symbol: tokenSymbol.toUpperCase(),
            decimals: parseInt(decimals),
            image: logoUrl || undefined,
          },
        },
      });
    } catch (error) {
      console.error('Failed to add token to MetaMask:', error);
    }
  };

  // Format fee for display
  const formattedFee = creationFee ? formatUnits(creationFee, 18) : '0';

  // Check if factory is deployed
  const isFactoryDeployed =
    activeFactoryAddress && activeFactoryAddress !== '0x0000000000000000000000000000000000000000';

  if (isConfigLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gray-800/90 rounded-3xl p-6 shadow-xl border border-gray-700/50 animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-48 mb-6"></div>
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-700 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Show message if factory is not deployed
  if (!isFactoryDeployed) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-yellow-500/30 text-center">
          <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-yellow-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Coming Soon</h2>
          <p className="text-gray-400 mb-4">
            Token Factory contract is not yet deployed on this network.
          </p>
        </div>
      </div>
    );
  }

  // Success State
  if (showSuccess && deployedAddress) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-green-500/30">
          <div className="text-center">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-10 h-10 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Token Created Successfully!</h2>
            <p className="text-gray-400 mb-6">Your token has been deployed to the blockchain</p>

            {/* Token Info Card */}
            <div className="bg-gray-800/50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={tokenName}
                    className="w-12 h-12 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                    {tokenSymbol.charAt(0)}
                  </div>
                )}
                <div className="text-left">
                  <div className="text-lg font-semibold text-white">{tokenName}</div>
                  <div className="text-gray-400 text-sm">{tokenSymbol}</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-xl p-4 mb-6">
              <div className="text-sm text-gray-400 mb-1">Contract Address</div>
              <div className="flex items-center justify-center gap-2">
                <code className="text-sm text-purple-400 break-all">{deployedAddress}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(deployedAddress)}
                  className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors"
                  title="Copy address"
                >
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Add to MetaMask button */}
            <button
              onClick={addToMetaMask}
              className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors mb-4 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 35 33" fill="none">
                <path
                  d="M32.9582 1L19.8241 10.7183L22.2665 4.99099L32.9582 1Z"
                  fill="#E17726"
                  stroke="#E17726"
                  strokeWidth="0.25"
                />
                <path
                  d="M2.04858 1L15.0707 10.809L12.7396 4.99098L2.04858 1Z"
                  fill="#E27625"
                  stroke="#E27625"
                  strokeWidth="0.25"
                />
              </svg>
              Add to MetaMask
            </button>

            {/* Verify Contract Button */}
            <a
              href={`/contract/verify?address=${deployedAddress}&contractName=${encodeURIComponent(tokenName)}&isLaunchpadToken=true`}
              className="w-full py-3 px-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors mb-4 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              Verify Contract
            </a>

            <div className="flex gap-4">
              <button
                onClick={handleReset}
                className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-colors"
              >
                Create Another Token
              </button>
              <a
                href={`/launchpad/token/${deployedAddress}`}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity text-center"
              >
                View Token
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-gray-700/50">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <svg
              className="w-6 h-6 text-purple-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Create New Token
          </h2>
        </div>

        <div className="space-y-4">
          {/* Token Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Token Name *</label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g., My Awesome Token"
              className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              maxLength={50}
            />
            <p className="text-xs text-gray-500 mt-1">{tokenName.length}/50 characters</p>
          </div>

          {/* Token Symbol */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Token Symbol *</label>
            <input
              type="text"
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
              placeholder="e.g., MAT"
              className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent uppercase"
              maxLength={11}
            />
            <p className="text-xs text-gray-500 mt-1">{tokenSymbol.length}/11 characters</p>
          </div>

          {/* Decimals & Total Supply - Side by Side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Decimals *</label>
              <input
                type="number"
                value={decimals}
                onChange={(e) => setDecimals(e.target.value)}
                placeholder="18"
                min="0"
                max="18"
                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">0-18</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Total Supply *</label>
              <input
                type="number"
                value={totalSupply}
                onChange={(e) => setTotalSupply(e.target.value)}
                placeholder="e.g., 1000000"
                min="1"
                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">All tokens go to your wallet</p>
            </div>
          </div>

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full py-3 px-4 bg-gray-700/30 hover:bg-gray-700/50 border border-gray-600 rounded-xl text-gray-300 flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-purple-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
              Token Metadata (Optional)
            </span>
            <svg
              className={`w-5 h-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {/* Advanced Options Panel */}
          {showAdvanced && (
            <div className="space-y-4 p-4 bg-gray-800/30 rounded-xl border border-gray-700">
              <p className="text-xs text-gray-400 mb-2">
                📝 Add metadata to make your token more discoverable. You can edit these later.
              </p>

              {/* Logo URL */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Logo URL</label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className={`w-full px-4 py-3 bg-gray-700/50 border rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
                    logoUrl && !isValidUrl(logoUrl) ? 'border-red-500' : 'border-gray-600'
                  }`}
                />
                {logoUrl && !isValidUrl(logoUrl) && (
                  <p className="text-xs text-red-400 mt-1">Please enter a valid URL</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your token..."
                  rows={3}
                  maxLength={500}
                  className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">{description.length}/500 characters</p>
              </div>

              {/* Website */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Website</label>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourproject.com"
                  className={`w-full px-4 py-3 bg-gray-700/50 border rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
                    website && !isValidUrl(website) ? 'border-red-500' : 'border-gray-600'
                  }`}
                />
                {website && !isValidUrl(website) && (
                  <p className="text-xs text-red-400 mt-1">Please enter a valid URL</p>
                )}
              </div>
            </div>
          )}

          {/* Payment Method Selection */}
          {(creationFee !== undefined && creationFee > 0n) ||
          (altPayment?.enabled && altFee > 0n) ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-300">Payment Method</label>

              {/* Native Payment Option */}
              <div
                onClick={() => setPaymentMethod('native')}
                className={`p-4 border rounded-xl cursor-pointer transition-all ${
                  paymentMethod === 'native'
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-600 hover:border-gray-500'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        paymentMethod === 'native' ? 'border-purple-500' : 'border-gray-500'
                      }`}
                    >
                      {paymentMethod === 'native' && (
                        <div className="w-2 h-2 rounded-full bg-purple-500" />
                      )}
                    </div>
                    <span className="font-medium text-white">Pay with {nativeCurrencySymbol}</span>
                  </div>
                  <span className="text-lg font-bold text-white">
                    {formattedFee} {nativeCurrencySymbol}
                  </span>
                </div>
                {balance && (
                  <div className="text-xs text-gray-500 mt-2 ml-7">
                    Balance: {formatUnits(balance.value, 18)} {nativeCurrencySymbol}
                  </div>
                )}
              </div>

              {/* Alternative Token Payment Option */}
              {altPayment?.enabled && altFee > 0n && (
                <div
                  onClick={() => setPaymentMethod('alternative')}
                  className={`p-4 border rounded-xl cursor-pointer transition-all ${
                    paymentMethod === 'alternative'
                      ? 'border-yellow-500 bg-yellow-500/10'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          paymentMethod === 'alternative' ? 'border-yellow-500' : 'border-gray-500'
                        }`}
                      >
                        {paymentMethod === 'alternative' && (
                          <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        )}
                      </div>
                      <div>
                        <span className="font-medium text-white">Pay with {altTokenSymbol}</span>
                        {altPayment.discountLabel && (
                          <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                            {altPayment.discountLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-lg font-bold text-white">
                      {formatUnits(altFee, altTokenDecimals)} {altTokenSymbol}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 ml-7 space-y-1">
                    {altPayment.burnNote && (
                      <div>
                        🔥 {altTokenSymbol} {altPayment.burnNote}
                      </div>
                    )}
                    {altTokenBalance !== undefined && (
                      <div>
                        Balance:{' '}
                        {Number(formatUnits(altTokenBalance, altTokenDecimals)).toLocaleString()}{' '}
                        {altTokenSymbol}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Error Display */}
          {(writeError || approveError) && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400 text-sm">
                {(writeError?.message || approveError?.message || '').includes('User rejected')
                  ? 'Transaction was rejected'
                  : (writeError?.message || approveError?.message || '').includes(
                        'insufficient funds'
                      )
                    ? 'Insufficient balance for creation fee'
                    : 'Failed to create token. Please try again.'}
              </p>
            </div>
          )}

          {/* Validation Hints */}
          {isConnected && isCorrectChain && !isValidForm && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <p className="text-yellow-400 text-sm">
                {!tokenName.trim()
                  ? 'Please enter a token name'
                  : tokenName.trim().length > 50
                    ? 'Token name must be 50 characters or less'
                    : !tokenSymbol.trim()
                      ? 'Please enter a token symbol'
                      : tokenSymbol.trim().length > 11
                        ? 'Token symbol must be 11 characters or less'
                        : parseInt(decimals) < 0 || parseInt(decimals) > 18
                          ? 'Decimals must be between 0 and 18'
                          : parseFloat(totalSupply) <= 0 || !totalSupply
                            ? 'Please enter a valid total supply'
                            : 'Please fill in all required fields'}
              </p>
            </div>
          )}

          {/* Connect Wallet / Wrong Chain / Create Button */}
          {!isConnected ? (
            <ConnectWalletButton />
          ) : !isCorrectChain ? (
            <button
              onClick={() => config?.chainId && switchChain({ chainId: config.chainId })}
              className="w-full py-4 bg-yellow-500 hover:bg-yellow-600 text-black font-bold rounded-xl transition-colors"
            >
              Switch to {config?.networkName || 'VirBiCoin'}
            </button>
          ) : paymentMethod === 'native' && !hasEnoughBalance && creationFee && creationFee > 0n ? (
            <button
              disabled
              className="w-full py-4 bg-gray-600 text-gray-400 font-bold rounded-xl cursor-not-allowed"
            >
              Insufficient Balance (Need {formattedFee} {nativeCurrencySymbol})
            </button>
          ) : paymentMethod === 'alternative' && !hasEnoughAltToken ? (
            <button
              disabled
              className="w-full py-4 bg-gray-600 text-gray-400 font-bold rounded-xl cursor-not-allowed"
            >
              Insufficient {altTokenSymbol} (Need {formatUnits(altFee, altTokenDecimals)}{' '}
              {altTokenSymbol})
            </button>
          ) : (
            <button
              key={`create-btn-${paymentMethod}`}
              onClick={handleCreateToken}
              disabled={
                !isValidForm ||
                !isMetadataValid ||
                isPending ||
                isConfirming ||
                isApproving ||
                isApprovePending ||
                isApproveConfirming
              }
              className={`w-full py-4 font-bold rounded-xl transition-all ${
                isValidForm &&
                isMetadataValid &&
                !isPending &&
                !isConfirming &&
                !isApproving &&
                !isApprovePending &&
                !isApproveConfirming
                  ? paymentMethod === 'alternative'
                    ? 'bg-gradient-to-r from-yellow-500 to-amber-500 text-black hover:opacity-90 shadow-lg'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 shadow-lg'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isApprovePending || isApproveConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Approving {altTokenSymbol}...
                </span>
              ) : isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Confirm in Wallet...
                </span>
              ) : isConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Deploying Token...
                </span>
              ) : paymentMethod === 'alternative' && !hasAltTokenAllowance ? (
                `Approve & Create Token${hasMetadata ? ' with Metadata' : ''}`
              ) : (
                `Create Token${hasMetadata ? ' with Metadata' : ''}`
              )}
            </button>
          )}
          {!isMetadataValid && (
            <p className="mt-2 text-sm text-red-400 text-center">
              Invalid metadata: Logo URL and Website must be valid URLs (or left empty).
            </p>
          )}
        </div>

        {/* Preview Section */}
        {isValidForm && (
          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Token Preview</h3>
            <div className="bg-gray-800/50 rounded-xl p-4">
              <div className="flex items-center gap-4">
                {logoUrl && isValidUrl(logoUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={tokenName}
                    className="w-12 h-12 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                    {tokenSymbol.charAt(0)}
                  </div>
                )}
                <div>
                  <div className="text-white font-semibold">{tokenName}</div>
                  <div className="text-gray-400 text-sm">{tokenSymbol}</div>
                </div>
              </div>
              {description && (
                <p className="text-gray-400 text-sm mt-3 line-clamp-2">{description}</p>
              )}
              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-700">
                <div>
                  <div className="text-xs text-gray-500">Total Supply</div>
                  <div className="text-sm text-white">{Number(totalSupply).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Decimals</div>
                  <div className="text-sm text-white">{decimals}</div>
                </div>
              </div>
              {website && isValidUrl(website) && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                    {website}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
