'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { formatUnits, parseUnits, type Address, isAddress } from 'viem';
import { useReadContracts } from 'wagmi';
import { TokenFactoryV2ABI, LaunchpadTokenV2ABI } from '@/abi/TokenFactoryV2ABI';
import { TokenFactoryABI, ERC20ABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import { ConnectWalletButton } from './ConnectWalletButton';
import Link from 'next/link';

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creator: string;
  createdAt: number;
  userBalance?: bigint;
  logoUrl?: string;
  description?: string;
  website?: string;
  isPaused?: boolean;
}

type ModalType = 'burn' | 'transfer' | 'approve' | null;

export function MyTokens() {
  const { address, isConnected } = useAccount();
  const { config, isLoading: isConfigLoading, activeFactoryAddress } = useLaunchpadConfig();
  const [refreshKey, setRefreshKey] = useState(0);

  const isV2 = config?.useV2 ?? true;
  const factoryABI = isV2 ? TokenFactoryV2ABI : TokenFactoryABI;

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const { data: userTokenAddresses, isLoading: isTokensLoading, refetch: refetchTokens } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: 'getTokensByCreator',
    args: [address as Address],
    query: {
      enabled: !!activeFactoryAddress && !!address && isConnected,
    },
  });

  const tokenInfoContracts = (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: isV2 ? 'getTokenDetails' : 'tokenInfo',
    args: [tokenAddress] as const,
  }));

  const { data: tokenInfoResults, isLoading: isInfoLoading, refetch: refetchTokenInfo } = useReadContracts({
    contracts: tokenInfoContracts,
    query: { enabled: tokenInfoContracts.length > 0 },
  });

  const balanceContracts = (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf' as const,
    args: [address as Address] as const,
  }));

  const { data: balanceResults, isLoading: isBalanceLoading, refetch: refetchBalances } = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: balanceContracts.length > 0 && !!address },
  });

  const pauseContracts = isV2 ? (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: LaunchpadTokenV2ABI,
    functionName: 'paused' as const,
    args: [] as const,
  })) : [];

  const { data: pauseResults, refetch: refetchPause } = useReadContracts({
    contracts: pauseContracts,
    query: { enabled: isV2 && pauseContracts.length > 0 },
  });

  const refreshAllData = useCallback(async () => {
    await Promise.all([
      refetchTokens(),
      refetchTokenInfo(),
      refetchBalances(),
      isV2 ? refetchPause() : Promise.resolve(),
    ]);
    triggerRefresh();
  }, [refetchTokens, refetchTokenInfo, refetchBalances, refetchPause, triggerRefresh, isV2]);

  const tokens = useMemo(() => {
    if (!userTokenAddresses || !tokenInfoResults) return [];
    
    const processedTokens: TokenInfo[] = [];
    
    for (let i = 0; i < userTokenAddresses.length; i++) {
      const result = tokenInfoResults[i];
      const balanceResult = balanceResults?.[i];
      const pauseResult = pauseResults?.[i];
      
      if (result.status === 'success' && result.result) {
        let tokenData: TokenInfo;
        
        if (isV2) {
          const [creator, name, symbol, decimals, totalSupply, createdAt, logoUrl, description, website] = result.result as [string, string, string, number, bigint, bigint, string, string, string];
          tokenData = { address: userTokenAddresses[i] as string, name, symbol, decimals, totalSupply, creator, createdAt: Number(createdAt), logoUrl, description, website };
        } else {
          const [creator, name, symbol, decimals, totalSupply, createdAt] = result.result as [string, string, string, number, bigint, bigint];
          tokenData = { address: userTokenAddresses[i] as string, name, symbol, decimals, totalSupply, creator, createdAt: Number(createdAt) };
        }
        
        const userBalance = balanceResult?.status === 'success' ? balanceResult.result as bigint : BigInt(0);
        const isPaused = pauseResult?.status === 'success' ? pauseResult.result as boolean : false;
        
        if (userBalance === BigInt(0)) continue;
        
        processedTokens.push({ ...tokenData, userBalance, isPaused });
      }
    }
    
    processedTokens.sort((a, b) => b.createdAt - a.createdAt);
    return processedTokens;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTokenAddresses, tokenInfoResults, balanceResults, pauseResults, isV2, refreshKey]);

  const isLoading = isConfigLoading || isTokensLoading || isInfoLoading || isBalanceLoading;
  const isFactoryDeployed = activeFactoryAddress && activeFactoryAddress !== '0x0000000000000000000000000000000000000000';

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-gray-700/50 text-center">
          <div className="w-20 h-20 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400 mb-6">Connect your wallet to see tokens you&apos;ve created</p>
          <div className="max-w-xs mx-auto"><ConnectWalletButton /></div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800/90 rounded-3xl p-6 shadow-xl border border-gray-700/50">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-700 rounded w-48 mb-6"></div>
            <div className="space-y-3">{[...Array(3)].map((_, i) => (<div key={i} className="h-20 bg-gray-700 rounded-xl"></div>))}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isFactoryDeployed) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-gray-700/50 text-center">
          <div className="w-16 h-16 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No Tokens Yet</h3>
          <p className="text-gray-400">Token Factory is not yet deployed on this network.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-gray-700/50">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            My Tokens
            {isV2 && <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs font-semibold rounded-lg">V2</span>}
          </h2>
          <div className="text-gray-400 text-sm">{tokens.length} token{tokens.length !== 1 ? 's' : ''} created</div>
        </div>

        {tokens.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Tokens Yet</h3>
            <p className="text-gray-400 mb-4">You haven&apos;t created any tokens yet</p>
            <Link href="/launchpad" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Token
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (<MyTokenCard key={token.address} token={token} isV2={isV2} onSuccess={refreshAllData} />))}
          </div>
        )}
      </div>
    </div>
  );
}

function MyTokenCard({ token, isV2, onSuccess }: { token: TokenInfo; isV2: boolean; onSuccess?: () => void }) {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [spender, setSpender] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const createdDate = new Date(token.createdAt * 1000).toLocaleDateString();
  const createdTime = new Date(token.createdAt * 1000).toLocaleTimeString();
  const userBalance = token.userBalance ?? BigInt(0);
  const formattedBalance = userBalance ? formatUnits(userBalance, token.decimals) : '0';

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { writeContract: writePause, data: pauseHash, isPending: isPausing } = useWriteContract();
  const { isLoading: isConfirmingPause, isSuccess: isPauseConfirmed } = useWaitForTransactionReceipt({ hash: pauseHash });

  useEffect(() => { if (isPauseConfirmed && onSuccess) onSuccess(); }, [isPauseConfirmed, onSuccess]);
  useEffect(() => { if (isConfirmed && onSuccess) onSuccess(); }, [isConfirmed, onSuccess]);

  const handleTransfer = async () => {
    if (!amount || !recipient || !token.address) return;
    setError(null);
    if (!isAddress(recipient)) { setError('Invalid recipient address'); return; }
    try {
      const amountToSend = parseUnits(amount, token.decimals);
      if (amountToSend > userBalance) { setError(`Insufficient balance. You have ${formatUnits(userBalance, token.decimals)} ${token.symbol}`); return; }
      writeContract({ address: token.address as Address, abi: ERC20ABI, functionName: 'transfer', args: [recipient as Address, amountToSend] });
    } catch { setError(`Invalid amount format: ${amount}`); }
  };

  const handleApprove = async () => {
    if (!amount || !spender || !token.address) return;
    setError(null);
    if (!isAddress(spender)) { setError('Invalid spender address'); return; }
    try {
      const amountToApprove = parseUnits(amount, token.decimals);
      writeContract({ address: token.address as Address, abi: ERC20ABI, functionName: 'approve', args: [spender as Address, amountToApprove] });
    } catch { setError(`Invalid amount format: ${amount}`); }
  };

  const handleBurn = async () => {
    if (!amount || !token.address) return;
    setError(null);
    try {
      const amountToBurn = parseUnits(amount, token.decimals);
      if (amountToBurn > userBalance) { setError(`Insufficient balance. You have ${formatUnits(userBalance, token.decimals)} ${token.symbol}`); return; }
      if (isV2) {
        writeContract({ address: token.address as Address, abi: LaunchpadTokenV2ABI, functionName: 'burn', args: [amountToBurn] });
      } else {
        const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;
        writeContract({ address: token.address as Address, abi: ERC20ABI, functionName: 'transfer', args: [DEAD_ADDRESS, amountToBurn] });
      }
    } catch { setError(`Invalid amount format: ${amount}`); }
  };

  const handleTogglePause = () => {
    if (!isV2 || !token.address) return;
    writePause({ address: token.address as Address, abi: LaunchpadTokenV2ABI, functionName: token.isPaused ? 'unpause' : 'pause', args: [] });
  };

  const handleMax = () => { if (userBalance > BigInt(0)) setAmount(formatUnits(userBalance, token.decimals)); };
  const handleUnlimited = () => { setAmount('115792089237316195423570985008687907853269984665640564039457584007913129639935'); };
  const closeModal = () => { setActiveModal(null); setAmount(''); setRecipient(''); setSpender(''); setError(null); reset(); };

  const addToMetaMask = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: { type: 'ERC20', options: { address: token.address, symbol: token.symbol.slice(0, 11), decimals: token.decimals, image: token.logoUrl || undefined } },
      });
    } catch (err) { console.error('Failed to add token to MetaMask:', err); }
  };

  return (
    <>
      <div className="bg-gray-800/50 rounded-xl p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {token.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={token.logoUrl} alt={token.name} className="w-14 h-14 rounded-full object-cover" onError={(e) => { const target = e.target as HTMLImageElement; target.style.display = 'none'; target.nextElementSibling?.classList.remove('hidden'); }} />
            ) : null}
            <div className={`w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl ${token.logoUrl ? 'hidden' : ''}`}>
              {token.symbol.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-lg">{token.name}</span>
                <span className="text-gray-400">({token.symbol})</span>
                {token.isPaused && <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg">Paused</span>}
              </div>
              {token.description && <p className="text-gray-500 text-xs mt-0.5 line-clamp-1 max-w-xs">{token.description}</p>}
              <div className="flex items-center gap-2 mt-1">
                <Link href={`/launchpad/token/${token.address}`} className="text-purple-400 hover:text-purple-300 text-sm font-mono">{token.address.slice(0, 14)}...{token.address.slice(-10)}</Link>
                <button onClick={() => navigator.clipboard.writeText(token.address)} className="p-1 hover:bg-gray-600 rounded transition-colors" title="Copy address">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="bg-purple-500/20 text-purple-400 text-xs px-2 py-1 rounded-full mb-2">Created</div>
            <div className="text-sm text-gray-400">{createdDate}</div>
            <div className="text-xs text-gray-500">{createdTime}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
          <div><div className="text-xs text-gray-500">Total Supply</div><div className="text-sm text-white font-medium">{Number(formattedSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
          <div><div className="text-xs text-gray-500">Your Balance</div><div className="text-sm text-white font-medium">{Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
          <div><div className="text-xs text-gray-500">Decimals</div><div className="text-sm text-white font-medium">{token.decimals}</div></div>
          <div className="flex justify-end gap-1 flex-wrap">
            <Link href={`/launchpad/token/${token.address}`} className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white transition-colors" title="View Details">👁️</Link>
            <button onClick={addToMetaMask} className="px-2 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 rounded-lg text-xs text-orange-400 transition-colors" title="Add to MetaMask">🦊</button>
            <button onClick={() => setActiveModal('transfer')} className="px-2 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg text-xs text-blue-400 transition-colors" title="Transfer">📤</button>
            <button onClick={() => setActiveModal('approve')} className="px-2 py-1.5 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-xs text-green-400 transition-colors" title="Approve">✅</button>
            {isV2 && <button onClick={handleTogglePause} disabled={isPausing || isConfirmingPause} className={`px-2 py-1.5 rounded-lg text-xs transition-colors ${token.isPaused ? 'bg-green-500/20 hover:bg-green-500/30 text-green-400' : 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400'} disabled:opacity-50`} title={token.isPaused ? 'Unpause' : 'Pause'}>{isPausing || isConfirmingPause ? '...' : token.isPaused ? '▶️' : '⏸️'}</button>}
            <button onClick={() => setActiveModal('burn')} className="px-2 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs text-red-400 transition-colors" title="Burn">🔥</button>
          </div>
        </div>
      </div>

      {activeModal === 'transfer' && (
        <Modal title={`📤 Transfer ${token.symbol}`} onClose={closeModal} isV2={isV2}>
          {isConfirmed ? <SuccessMessage message={`${amount} ${token.symbol} has been sent to ${recipient.slice(0, 10)}...`} onClose={closeModal} /> : (
            <>
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Recipient Address</label>
                <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm" />
              </div>
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">Amount</label>
                  <span className="text-xs text-gray-500">Balance: {Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}</span>
                </div>
                <div className="relative">
                  <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className="w-full px-4 py-3 pr-20 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  <button onClick={handleMax} className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg transition-colors">MAX</button>
                </div>
              </div>
              {error && <ErrorMessage message={error} />}
              <button onClick={handleTransfer} disabled={!amount || !recipient || isPending || isConfirming || Number(amount) <= 0} className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                {isPending || isConfirming ? <LoadingSpinner text={isPending ? 'Confirming...' : 'Processing...'} /> : <>📤 Send Tokens</>}
              </button>
            </>
          )}
        </Modal>
      )}

      {activeModal === 'approve' && (
        <Modal title={`✅ Approve ${token.symbol}`} onClose={closeModal} isV2={isV2}>
          {isConfirmed ? <SuccessMessage message={`Approval granted for ${spender.slice(0, 10)}...`} onClose={closeModal} /> : (
            <>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-4">
                <p className="text-blue-400 text-sm">ℹ️ Approval allows a contract (like DEX) to spend your tokens on your behalf. Common uses: trading on DEX, staking, farming.</p>
              </div>
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Spender Address (Contract)</label>
                <input type="text" value={spender} onChange={(e) => setSpender(e.target.value)} placeholder="0x... (DEX Router, Staking Contract, etc.)" className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm" />
              </div>
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">Amount to Approve</label>
                  <span className="text-xs text-gray-500">Balance: {Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}</span>
                </div>
                <div className="relative">
                  <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className="w-full px-4 py-3 pr-32 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    <button onClick={handleMax} className="px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-green-500/20 hover:bg-green-500/30 rounded-lg transition-colors">MAX</button>
                    <button onClick={handleUnlimited} className="px-2 py-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg transition-colors">∞</button>
                  </div>
                </div>
              </div>
              {error && <ErrorMessage message={error} />}
              <button onClick={handleApprove} disabled={!amount || !spender || isPending || isConfirming} className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                {isPending || isConfirming ? <LoadingSpinner text={isPending ? 'Confirming...' : 'Processing...'} /> : <>✅ Approve Tokens</>}
              </button>
            </>
          )}
        </Modal>
      )}

      {activeModal === 'burn' && (
        <Modal title={`🔥 Burn ${token.symbol}`} onClose={closeModal} isV2={isV2}>
          {isConfirmed ? <SuccessMessage message={`${amount} ${token.symbol} has been permanently burned.`} onClose={closeModal} /> : (
            <>
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
                <p className="text-red-400 text-sm">⚠️ Warning: Burning tokens is irreversible. The burned tokens will be permanently destroyed.{isV2 && ' (Using native V2 burn function)'}</p>
              </div>
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">Amount to Burn</label>
                  <span className="text-xs text-gray-500">Balance: {Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}</span>
                </div>
                <div className="relative">
                  <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className="w-full px-4 py-3 pr-20 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent" />
                  <button onClick={handleMax} className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors">MAX</button>
                </div>
              </div>
              {error && <ErrorMessage message={error} />}
              <button onClick={handleBurn} disabled={!amount || isPending || isConfirming || Number(amount) <= 0 || Number(amount) > Number(formattedBalance)} className="w-full py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                {isPending || isConfirming ? <LoadingSpinner text={isPending ? 'Confirming...' : 'Processing...'} /> : <>�� Burn Tokens</>}
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function Modal({ title, children, onClose, isV2 }: { title: string; children: React.ReactNode; onClose: () => void; isV2: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            {title}
            {isV2 && <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs font-semibold rounded-lg">V2</span>}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SuccessMessage({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      </div>
      <h4 className="text-lg font-semibold text-white mb-2">Success!</h4>
      <p className="text-gray-400 text-sm mb-4">{message}</p>
      <button onClick={onClose} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-white transition-colors">Close</button>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-3 mb-4"><p className="text-red-400 text-sm">{message}</p></div>;
}

function LoadingSpinner({ text }: { text: string }) {
  return (
    <>
      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
      {text}
    </>
  );
}
