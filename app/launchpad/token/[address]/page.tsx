'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { formatUnits, type Address } from 'viem';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { TokenFactoryV2ABI, LaunchpadTokenV2ABI } from '@/abi/TokenFactoryV2ABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import Link from 'next/link';

interface TokenDetails {
  creator: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  createdAt: number;
  logoUrl: string;
  description: string;
  website: string;
  isPaused: boolean;
  owner: string;
}

interface Holder {
  address: string;
  balance: string;
  percentage: number;
}

interface Transfer {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: string;
  blockNumber: number;
}

type TabType = 'overview' | 'holders' | 'transfers';

export default function TokenDetailPage() {
  const params = useParams();
  const tokenAddress = params.address as string;
  const { address, isConnected } = useAccount();
  const { config, isLoading: isConfigLoading, activeFactoryAddress } = useLaunchpadConfig();
  
  const [copied, setCopied] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [holdersPage, setHoldersPage] = useState(1);
  const [transfersPage, setTransfersPage] = useState(1);
  const [totalHolders, setTotalHolders] = useState(0);
  const [totalTransfers, setTotalTransfers] = useState(0);
  const [editForm, setEditForm] = useState({ logoUrl: '', description: '', website: '' });

  const isV2 = config?.useV2 ?? true;
  const ITEMS_PER_PAGE = 20;

  const { data: tokenDetails, isLoading: isDetailsLoading, refetch: refetchDetails } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: TokenFactoryV2ABI,
    functionName: 'getTokenDetails',
    args: [tokenAddress as Address],
    query: { enabled: !!activeFactoryAddress && !!tokenAddress && isV2 },
  });

  const { data: isPaused, refetch: refetchPaused } = useReadContract({
    address: tokenAddress as Address,
    abi: LaunchpadTokenV2ABI,
    functionName: 'paused',
    query: { enabled: !!tokenAddress && isV2 },
  });

  const { data: owner } = useReadContract({
    address: tokenAddress as Address,
    abi: LaunchpadTokenV2ABI,
    functionName: 'owner',
    query: { enabled: !!tokenAddress && isV2 },
  });

  const { data: userBalance } = useReadContract({
    address: tokenAddress as Address,
    abi: LaunchpadTokenV2ABI,
    functionName: 'balanceOf',
    args: [address as Address],
    query: { enabled: !!tokenAddress && !!address && isConnected },
  });

  const { writeContract: writePause, data: pauseHash, isPending: isPausing } = useWriteContract();
  const { isLoading: isConfirmingPause, isSuccess: isPauseConfirmed } = useWaitForTransactionReceipt({ hash: pauseHash });

  const { writeContract: writeMetadata, data: metadataHash, isPending: isUpdating } = useWriteContract();
  const { isLoading: isConfirmingMetadata, isSuccess: isMetadataConfirmed } = useWaitForTransactionReceipt({ hash: metadataHash });

  useEffect(() => { if (isPauseConfirmed) refetchPaused(); }, [isPauseConfirmed, refetchPaused]);
  useEffect(() => { if (isMetadataConfirmed) { refetchDetails(); setShowEditModal(false); } }, [isMetadataConfirmed, refetchDetails]);

  // Fetch holders
  const fetchHolders = useCallback(async () => {
    if (!tokenAddress) return;
    setHoldersLoading(true);
    try {
      const res = await fetch(`/api/tokens/${tokenAddress}?holdersPage=${holdersPage}&holdersLimit=${ITEMS_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json();
        setHolders(data.holders || []);
        setTotalHolders(data.totalHolders || 0);
      }
    } catch (err) { console.error('Failed to fetch holders:', err); }
    setHoldersLoading(false);
  }, [tokenAddress, holdersPage]);

  // Fetch transfers
  const fetchTransfers = useCallback(async () => {
    if (!tokenAddress) return;
    setTransfersLoading(true);
    try {
      const res = await fetch(`/api/tokens/${tokenAddress}?transfersPage=${transfersPage}&transfersLimit=${ITEMS_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json();
        setTransfers(data.transfers || []);
        setTotalTransfers(data.totalTransfers || 0);
      }
    } catch (err) { console.error('Failed to fetch transfers:', err); }
    setTransfersLoading(false);
  }, [tokenAddress, transfersPage]);

  useEffect(() => { if (activeTab === 'holders') fetchHolders(); }, [activeTab, fetchHolders]);
  useEffect(() => { if (activeTab === 'transfers') fetchTransfers(); }, [activeTab, fetchTransfers]);

  const token: TokenDetails | null = tokenDetails ? (() => {
    const details = tokenDetails as readonly [string, string, string, number, bigint, bigint, string, string, string];
    return {
      creator: details[0], name: details[1], symbol: details[2], decimals: details[3],
      totalSupply: details[4], createdAt: Number(details[5]), logoUrl: details[6],
      description: details[7], website: details[8], isPaused: isPaused as boolean ?? false, owner: owner as string ?? '',
    };
  })() : null;

  const isOwner = token && address && token.owner.toLowerCase() === address.toLowerCase();

  const copyAddress = () => { navigator.clipboard.writeText(tokenAddress); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleTogglePause = () => {
    if (!isOwner) return;
    writePause({ address: tokenAddress as Address, abi: LaunchpadTokenV2ABI, functionName: token?.isPaused ? 'unpause' : 'pause', args: [] });
  };

  const handleUpdateMetadata = () => {
    if (!isOwner || !token) return;
    if (editForm.logoUrl !== token.logoUrl) writeMetadata({ address: tokenAddress as Address, abi: LaunchpadTokenV2ABI, functionName: 'setLogoUrl', args: [editForm.logoUrl] });
    if (editForm.description !== token.description) writeMetadata({ address: tokenAddress as Address, abi: LaunchpadTokenV2ABI, functionName: 'setDescription', args: [editForm.description] });
    if (editForm.website !== token.website) writeMetadata({ address: tokenAddress as Address, abi: LaunchpadTokenV2ABI, functionName: 'setWebsite', args: [editForm.website] });
  };

  const openEditModal = () => { if (token) setEditForm({ logoUrl: token.logoUrl, description: token.description, website: token.website }); setShowEditModal(true); };

  const addToMetaMask = async () => {
    if (typeof window === 'undefined' || !window.ethereum || !token) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: { type: 'ERC20', options: { address: tokenAddress, symbol: token.symbol.slice(0, 11), decimals: token.decimals, image: token.logoUrl || undefined } },
      });
    } catch (error) { console.error('Failed to add token to MetaMask:', error); }
  };

  if (isConfigLoading || isDetailsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-800/90 rounded-3xl p-8 shadow-xl border border-gray-700/50">
            <div className="animate-pulse">
              <div className="flex items-center gap-6 mb-8"><div className="w-24 h-24 bg-gray-700 rounded-full"></div><div className="flex-1"><div className="h-8 bg-gray-700 rounded w-48 mb-2"></div><div className="h-4 bg-gray-700 rounded w-32"></div></div></div>
              <div className="grid grid-cols-3 gap-4">{[...Array(6)].map((_, i) => (<div key={i} className="h-20 bg-gray-700 rounded-xl"></div>))}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-800/90 rounded-3xl p-8 shadow-xl border border-gray-700/50 text-center">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Token Not Found</h2>
            <p className="text-gray-400 mb-6">This token does not exist or was not created through TokenFactory V2.</p>
            <Link href="/launchpad" className="inline-flex items-center gap-2 px-6 py-3 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition-colors">← Back to Launchpad</Link>
          </div>
        </div>
      </div>
    );
  }

  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const formattedBalance = userBalance ? formatUnits(userBalance as bigint, token.decimals) : '0';
  const createdDate = new Date(token.createdAt * 1000);
  const totalHoldersPages = Math.ceil(totalHolders / ITEMS_PER_PAGE);
  const totalTransfersPages = Math.ceil(totalTransfers / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <Link href="/launchpad" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to Launchpad
        </Link>

        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-gray-700/50">
          {/* Header */}
          <div className="flex items-start gap-6 mb-8">
            {token.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={token.logoUrl} alt={token.name} className="w-24 h-24 rounded-full object-cover border-4 border-gray-700" onError={(e) => { const target = e.target as HTMLImageElement; target.style.display = 'none'; target.nextElementSibling?.classList.remove('hidden'); }} />
            ) : null}
            <div className={`w-24 h-24 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-3xl border-4 border-gray-700 ${token.logoUrl ? 'hidden' : ''}`}>{token.symbol.charAt(0)}</div>

            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-white">{token.name}</h1>
                <span className="text-gray-400 text-lg">({token.symbol})</span>
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs font-semibold rounded-lg">V2</span>
                {token.isPaused && <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg">Paused</span>}
              </div>
              {token.description && <p className="text-gray-400 text-sm mb-3">{token.description}</p>}
              <div className="flex items-center gap-2">
                <span className="text-purple-400 font-mono text-sm">{tokenAddress.slice(0, 10)}...{tokenAddress.slice(-8)}</span>
                <button onClick={copyAddress} className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors" title="Copy address">
                  {copied ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  : <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                </button>
                <button onClick={addToMetaMask} className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors" title="Add to MetaMask">🦊</button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {token.website && <a href={token.website} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-white text-sm transition-colors flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>Website</a>}
              <Link href={`/token/${tokenAddress}`} className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 rounded-xl text-purple-400 text-sm transition-colors text-center">View on Explorer</Link>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-gray-800/50 rounded-xl p-1">
            {(['overview', 'holders', 'transfers'] as TabType[]).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}>
                {tab === 'overview' ? '📊 Overview' : tab === 'holders' ? `👥 Holders ${totalHolders > 0 ? `(${totalHolders})` : ''}` : `📜 Transfers ${totalTransfers > 0 ? `(${totalTransfers})` : ''}`}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-1">Total Supply</div><div className="text-lg text-white font-semibold">{Number(formattedSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-1">Decimals</div><div className="text-lg text-white font-semibold">{token.decimals}</div></div>
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-1">Created</div><div className="text-lg text-white font-semibold">{createdDate.toLocaleDateString()}</div><div className="text-xs text-gray-500">{createdDate.toLocaleTimeString()}</div></div>
                {isConnected && <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-1">Your Balance</div><div className="text-lg text-white font-semibold">{Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-2">Creator</div><Link href={`/address/${token.creator}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{token.creator.slice(0, 14)}...{token.creator.slice(-10)}</Link></div>
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-2">Owner</div><div className="flex items-center justify-between"><Link href={`/address/${token.owner}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{token.owner.slice(0, 14)}...{token.owner.slice(-10)}</Link>{isOwner && <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-lg">You</span>}</div></div>
              </div>

              {isOwner && (
                <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-xl p-6 border border-purple-500/30">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>Owner Controls</h3>
                  <div className="flex flex-wrap gap-3">
                    <button onClick={handleTogglePause} disabled={isPausing || isConfirmingPause} className={`px-4 py-2 rounded-xl font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 ${token.isPaused ? 'bg-green-500/20 hover:bg-green-500/30 text-green-400' : 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400'}`}>
                      {isPausing || isConfirmingPause ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Processing...</> : token.isPaused ? <>▶️ Unpause Token</> : <>⏸️ Pause Token</>}
                    </button>
                    <button onClick={openEditModal} className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 rounded-xl text-purple-400 font-semibold transition-colors flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>Edit Metadata</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Holders Tab */}
          {activeTab === 'holders' && (
            <div>
              {holdersLoading ? (
                <div className="flex items-center justify-center py-12"><svg className="animate-spin h-8 w-8 text-purple-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
              ) : holders.length === 0 ? (
                <div className="text-center py-12 text-gray-400">No holders found</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr className="border-b border-gray-700"><th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">Rank</th><th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">Address</th><th className="text-right py-3 px-4 text-xs text-gray-500 font-medium">Balance</th><th className="text-right py-3 px-4 text-xs text-gray-500 font-medium">%</th></tr></thead>
                      <tbody>
                        {holders.map((holder, index) => (
                          <tr key={holder.address} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                            <td className="py-3 px-4 text-sm text-gray-400">{(holdersPage - 1) * ITEMS_PER_PAGE + index + 1}</td>
                            <td className="py-3 px-4"><Link href={`/address/${holder.address}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{holder.address.slice(0, 10)}...{holder.address.slice(-8)}</Link></td>
                            <td className="py-3 px-4 text-right text-sm text-white font-medium">{Number(holder.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                            <td className="py-3 px-4 text-right text-sm text-gray-400">{holder.percentage?.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalHoldersPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-6">
                      <button onClick={() => setHoldersPage(p => Math.max(1, p - 1))} disabled={holdersPage === 1} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">←</button>
                      <span className="text-sm text-gray-400">{holdersPage} / {totalHoldersPages}</span>
                      <button onClick={() => setHoldersPage(p => Math.min(totalHoldersPages, p + 1))} disabled={holdersPage === totalHoldersPages} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">→</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Transfers Tab */}
          {activeTab === 'transfers' && (
            <div>
              {transfersLoading ? (
                <div className="flex items-center justify-center py-12"><svg className="animate-spin h-8 w-8 text-purple-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
              ) : transfers.length === 0 ? (
                <div className="text-center py-12 text-gray-400">No transfers found</div>
              ) : (
                <>
                  <div className="space-y-2">
                    {transfers.map((tx) => (
                      <div key={tx.hash} className="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-700/30 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <Link href={`/tx/${tx.hash}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{tx.hash.slice(0, 16)}...{tx.hash.slice(-12)}</Link>
                          <span className="text-xs text-gray-500">{tx.timestamp ? new Date(tx.timestamp).toLocaleString() : `Block #${tx.blockNumber}`}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Link href={`/address/${tx.from}`} className="text-blue-400 hover:text-blue-300 font-mono">{tx.from.slice(0, 8)}...</Link>
                          <span className="text-gray-500">→</span>
                          <Link href={`/address/${tx.to}`} className="text-green-400 hover:text-green-300 font-mono">{tx.to.slice(0, 8)}...</Link>
                          <span className="ml-auto text-white font-medium">{Number(tx.value).toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {totalTransfersPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-6">
                      <button onClick={() => setTransfersPage(p => Math.max(1, p - 1))} disabled={transfersPage === 1} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">←</button>
                      <span className="text-sm text-gray-400">{transfersPage} / {totalTransfersPages}</span>
                      <button onClick={() => setTransfersPage(p => Math.min(totalTransfersPages, p + 1))} disabled={transfersPage === totalTransfersPages} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">→</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-lg w-full border border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Edit Token Metadata</h3>
              <button onClick={() => setShowEditModal(false)} className="p-1 hover:bg-gray-700 rounded-lg transition-colors"><svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm text-gray-400 mb-2">Logo URL</label><input type="url" value={editForm.logoUrl} onChange={(e) => setEditForm({ ...editForm, logoUrl: e.target.value })} placeholder="https://example.com/logo.png" className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" /></div>
              <div><label className="block text-sm text-gray-400 mb-2">Description</label><textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Describe your token..." rows={3} className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" /></div>
              <div><label className="block text-sm text-gray-400 mb-2">Website</label><input type="url" value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} placeholder="https://yourtoken.com" className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" /></div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowEditModal(false)} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-white font-semibold transition-colors">Cancel</button>
              <button onClick={handleUpdateMetadata} disabled={isUpdating || isConfirmingMetadata} className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2">
                {isUpdating || isConfirmingMetadata ? <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving...</> : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
