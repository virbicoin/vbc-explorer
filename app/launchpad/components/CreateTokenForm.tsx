'use client';

import { useState, useEffect } from 'react';
import { useAccount, useChainId, useSwitchChain, useBalance, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, parseEventLogs, type Address } from 'viem';
import { useWriteContract, useReadContract } from 'wagmi';
import { TokenFactoryABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import { ConnectWalletButton } from './ConnectWalletButton';

export function CreateTokenForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { config, isLoading: isConfigLoading } = useLaunchpadConfig();
  
  // Form state
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [totalSupply, setTotalSupply] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  
  // Get user balance
  const { data: balance } = useBalance({
    address,
    query: {
      enabled: isConnected,
    },
  });

  // Get creation fee from contract
  const { data: creationFee } = useReadContract({
    address: config?.factoryAddress as Address,
    abi: TokenFactoryABI,
    functionName: 'creationFee',
    query: {
      enabled: !!config?.factoryAddress,
    },
  });

  // Write contract hook
  const { 
    data: txHash,
    isPending,
    writeContract,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for transaction
  const { 
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Register token to database
  const registerToken = async (tokenAddress: string, creatorAddress: string) => {
    try {
      const response = await fetch('/api/launchpad/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          creator: creatorAddress,
        }),
      });
      const data = await response.json();
      if (data.success) {
        console.log('Token registered to database:', data);
      } else {
        console.error('Failed to register token:', data.error);
      }
    } catch (error) {
      console.error('Error registering token:', error);
    }
  };

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed && receipt) {
      console.log('Transaction receipt:', JSON.stringify(receipt, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      , 2));
      
      let foundTokenAddress: string | null = null;
      
      // Use viem's parseEventLogs to decode the TokenCreated event
      try {
        const parsedLogs = parseEventLogs({
          abi: TokenFactoryABI,
          logs: receipt.logs,
          eventName: 'TokenCreated',
        });
        
        console.log('Parsed TokenCreated events:', parsedLogs);
        
        if (parsedLogs.length > 0) {
          foundTokenAddress = parsedLogs[0].args.token;
          console.log('Extracted token address:', foundTokenAddress);
        } else {
          // Fallback: Find any log from a new contract (not factory)
          console.log('No TokenCreated event found, trying fallback...');
          for (const log of receipt.logs) {
            if (log.address && 
                log.address.toLowerCase() !== config?.factoryAddress?.toLowerCase() &&
                log.address !== '0x0000000000000000000000000000000000000000') {
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
          if (log.address && 
              log.address.toLowerCase() !== config?.factoryAddress?.toLowerCase() &&
              log.address !== '0x0000000000000000000000000000000000000000') {
            console.log('Using log address as fallback:', log.address);
            foundTokenAddress = log.address;
            break;
          }
        }
      }
      
      // Set deployed address and register to database
      if (foundTokenAddress) {
        setDeployedAddress(foundTokenAddress);
        // Register token to database for /tokens page
        if (address) {
          registerToken(foundTokenAddress, address);
        }
      }
      
      setShowSuccess(true);
    }
  }, [isConfirmed, receipt, config?.factoryAddress, address]);

  // Validation
  const isValidForm = tokenName.trim().length > 0 && 
                      tokenSymbol.trim().length > 0 && 
                      tokenSymbol.trim().length <= 11 &&
                      parseInt(decimals) >= 0 && 
                      parseInt(decimals) <= 18 &&
                      parseFloat(totalSupply) > 0;

  const hasEnoughBalance = balance && creationFee && balance.value >= creationFee;

  // Check if on correct chain
  const isCorrectChain = config?.chainId ? chainId === config.chainId : true;

  // Handle create token
  const handleCreateToken = async () => {
    if (!isConnected || !config?.factoryAddress || !isValidForm) return;

    try {
      const supplyWithDecimals = parseUnits(totalSupply, parseInt(decimals));
      
      writeContract({
        address: config.factoryAddress as Address,
        abi: TokenFactoryABI,
        functionName: 'createToken',
        args: [tokenName, tokenSymbol.toUpperCase(), parseInt(decimals), supplyWithDecimals],
        value: creationFee || 0n,
      });
    } catch (error) {
      console.error('Failed to create token:', error);
    }
  };

  // Reset form
  const handleReset = () => {
    setTokenName('');
    setTokenSymbol('');
    setDecimals('18');
    setTotalSupply('');
    setShowSuccess(false);
    setDeployedAddress(null);
    resetWrite();
  };

  // Format fee for display
  const formattedFee = creationFee ? formatUnits(creationFee, 18) : '0';

  // Check if factory is deployed
  const isFactoryDeployed = config?.factoryAddress && 
    config.factoryAddress !== '0x0000000000000000000000000000000000000000';

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
            <svg className="w-10 h-10 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Coming Soon</h2>
          <p className="text-gray-400 mb-4">
            Token Factory contract is not yet deployed on this network.
          </p>
          <p className="text-gray-500 text-sm">
            Please check back later or contact the administrator.
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
              <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Token Created Successfully!</h2>
            <p className="text-gray-400 mb-6">Your token has been deployed to the blockchain</p>
            
            <div className="bg-gray-800/50 rounded-xl p-4 mb-6">
              <div className="text-sm text-gray-400 mb-1">Token Name</div>
              <div className="text-lg font-semibold text-white">{tokenName} ({tokenSymbol})</div>
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
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleReset}
                className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-colors"
              >
                Create Another Token
              </button>
              <a
                href={`/token/${deployedAddress}`}
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
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create New Token
        </h2>

        <div className="space-y-4">
          {/* Token Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Token Name *
            </label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g., My Awesome Token"
              className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              maxLength={50}
            />
          </div>

          {/* Token Symbol */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Token Symbol *
            </label>
            <input
              type="text"
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
              placeholder="e.g., MAT"
              className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent uppercase"
              maxLength={11}
            />
            <p className="text-xs text-gray-500 mt-1">Max 11 characters</p>
          </div>

          {/* Decimals */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Decimals *
            </label>
            <input
              type="number"
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              placeholder="18"
              min="0"
              max="18"
              className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Standard is 18, USDT uses 6</p>
          </div>

          {/* Total Supply */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Total Supply *
            </label>
            <input
              type="number"
              value={totalSupply}
              onChange={(e) => setTotalSupply(e.target.value)}
              placeholder="e.g., 1000000"
              min="1"
              className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">All tokens will be sent to your wallet</p>
          </div>

          {/* Creation Fee Info */}
          {creationFee !== undefined && creationFee > 0n && (
            <div className="bg-gray-700/30 rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Creation Fee</span>
                <span className="text-white font-semibold">{formattedFee} VBC</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {writeError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400 text-sm">
                {writeError.message.includes('User rejected') 
                  ? 'Transaction was rejected'
                  : writeError.message.includes('insufficient funds')
                  ? 'Insufficient balance for creation fee'
                  : 'Failed to create token. Please try again.'}
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
          ) : !hasEnoughBalance && creationFee && creationFee > 0n ? (
            <button
              disabled
              className="w-full py-4 bg-gray-600 text-gray-400 font-bold rounded-xl cursor-not-allowed"
            >
              Insufficient Balance
            </button>
          ) : (
            <button
              onClick={handleCreateToken}
              disabled={!isValidForm || isPending || isConfirming}
              className={`w-full py-4 font-bold rounded-xl transition-all ${
                isValidForm && !isPending && !isConfirming
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 shadow-lg'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Confirm in Wallet...
                </span>
              ) : isConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Deploying Token...
                </span>
              ) : (
                'Create Token'
              )}
            </button>
          )}
        </div>

        {/* Preview Section */}
        {isValidForm && (
          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Token Preview</h3>
            <div className="bg-gray-800/50 rounded-xl p-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  {tokenSymbol.charAt(0)}
                </div>
                <div>
                  <div className="text-white font-semibold">{tokenName}</div>
                  <div className="text-gray-400 text-sm">{tokenSymbol}</div>
                </div>
              </div>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
