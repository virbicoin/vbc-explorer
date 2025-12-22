'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { formatUnits, parseUnits, type Address, isAddress } from 'viem';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { TokenFactoryV2ABI, LaunchpadTokenV2ABI } from '@/abi/TokenFactoryV2ABI';
import { ERC20ABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import { Web3Provider } from '@/lib/dex/providers';
import Link from 'next/link';
import ListOnDexModal from './components/ListOnDexModal';

type ActionModalType = 'transfer' | 'approve' | 'burn' | null;

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

// Main page component wrapped with Web3Provider
export default function TokenDetailPage() {
  return (
    <Web3Provider>
      <TokenDetailContent />
    </Web3Provider>
  );
}

function TokenDetailContent() {
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
  const [isVerified, setIsVerified] = useState(false);
  
  // Token action states
  const [actionModal, setActionModal] = useState<ActionModalType>(null);
  const [actionAmount, setActionAmount] = useState('');
  const [actionRecipient, setActionRecipient] = useState('');
  const [actionSpender, setActionSpender] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDexModal, setShowDexModal] = useState(false);

  // Check if contract is verified
  useEffect(() => {
    if (tokenAddress) {
      fetch(`/api/contract/status/${tokenAddress}`)
        .then(res => res.json())
        .then(data => setIsVerified(data.verified === true))
        .catch(() => setIsVerified(false));
    }
  }, [tokenAddress]);

  const isV2 = config?.useV2 ?? true;
  const ITEMS_PER_PAGE = 20;

  // Fetch basic token info from factory (creator, name, symbol, decimals, totalSupply, createdAt)
  const { data: tokenDetails, isLoading: isDetailsLoading, refetch: refetchDetails } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: TokenFactoryV2ABI,
    functionName: 'getTokenDetails',
    args: [tokenAddress as Address],
    query: { enabled: !!activeFactoryAddress && !!tokenAddress && isV2 },
  });

  // Fetch mutable metadata directly from token contract (logoUrl, description, website)
  const { data: tokenLogoUrl, refetch: refetchLogoUrl } = useReadContract({
    address: tokenAddress as Address,
    abi: LaunchpadTokenV2ABI,
    functionName: 'logoUrl',
    query: { enabled: !!tokenAddress && isV2 },
  });

  const { data: tokenDescription, refetch: refetchDescription } = useReadContract({
    address: tokenAddress as Address,
    abi: LaunchpadTokenV2ABI,
    functionName: 'description',
    query: { enabled: !!tokenAddress && isV2 },
  });

  const { data: tokenWebsite, refetch: refetchWebsite } = useReadContract({
    address: tokenAddress as Address,
    abi: LaunchpadTokenV2ABI,
    functionName: 'website',
    query: { enabled: !!tokenAddress && isV2 },
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

  // Token action write contracts
  const { writeContract: writeAction, data: actionHash, isPending: isActionPending, reset: resetAction } = useWriteContract();
  const { isLoading: isActionConfirming, isSuccess: isActionConfirmed } = useWaitForTransactionReceipt({ hash: actionHash });

  useEffect(() => { if (isPauseConfirmed) refetchPaused(); }, [isPauseConfirmed, refetchPaused]);
  useEffect(() => { 
    if (isMetadataConfirmed) { 
      // Refetch metadata from token contract directly
      refetchLogoUrl();
      refetchDescription();
      refetchWebsite();
      setShowEditModal(false); 
    } 
  }, [isMetadataConfirmed, refetchLogoUrl, refetchDescription, refetchWebsite]);

  // Fetch holders
  const fetchHolders = useCallback(async () => {
    if (!tokenAddress) return;
    setHoldersLoading(true);
    try {
      const res = await fetch(`/api/tokens/${tokenAddress}?holdersPage=${holdersPage}&holdersLimit=${ITEMS_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json();
        setHolders(data.holders || []);
        setTotalHolders(data.pagination?.holders?.total || data.statistics?.holders || 0);
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
        setTotalTransfers(data.pagination?.transfers?.total || data.statistics?.transfers || 0);
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
      totalSupply: details[4], createdAt: Number(details[5]), 
      // Use metadata from token contract directly (not from factory cache)
      logoUrl: (tokenLogoUrl as string) ?? details[6],
      description: (tokenDescription as string) ?? details[7], 
      website: (tokenWebsite as string) ?? details[8], 
      isPaused: isPaused as boolean ?? false, owner: owner as string ?? '',
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

  // Token action handlers
  const closeActionModal = () => {
    setActionModal(null);
    setActionAmount('');
    setActionRecipient('');
    setActionSpender('');
    setActionError(null);
    resetAction();
  };

  const handleMaxAmount = () => {
    if (userBalance && token) {
      setActionAmount(formatUnits(userBalance as bigint, token.decimals));
    }
  };

  const handleUnlimitedApprove = () => {
    setActionAmount('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  };

  const handleTransfer = async () => {
    if (!actionAmount || !actionRecipient || !token) return;
    setActionError(null);
    if (!isAddress(actionRecipient)) { setActionError('Invalid recipient address'); return; }
    try {
      const amountToSend = parseUnits(actionAmount, token.decimals);
      const balance = userBalance as bigint;
      if (amountToSend > balance) { setActionError(`Insufficient balance. You have ${formatUnits(balance, token.decimals)} ${token.symbol}`); return; }
      writeAction({ address: tokenAddress as Address, abi: ERC20ABI, functionName: 'transfer', args: [actionRecipient as Address, amountToSend] });
    } catch { setActionError(`Invalid amount format: ${actionAmount}`); }
  };

  const handleApprove = async () => {
    if (!actionAmount || !actionSpender || !token) return;
    setActionError(null);
    if (!isAddress(actionSpender)) { setActionError('Invalid spender address'); return; }
    try {
      const amountToApprove = parseUnits(actionAmount, token.decimals);
      writeAction({ address: tokenAddress as Address, abi: ERC20ABI, functionName: 'approve', args: [actionSpender as Address, amountToApprove] });
    } catch { setActionError(`Invalid amount format: ${actionAmount}`); }
  };

  const handleBurn = async () => {
    if (!actionAmount || !token) return;
    setActionError(null);
    try {
      const amountToBurn = parseUnits(actionAmount, token.decimals);
      const balance = userBalance as bigint;
      if (amountToBurn > balance) { setActionError(`Insufficient balance. You have ${formatUnits(balance, token.decimals)} ${token.symbol}`); return; }
      if (isV2) {
        writeAction({ address: tokenAddress as Address, abi: LaunchpadTokenV2ABI, functionName: 'burn', args: [amountToBurn] });
      } else {
        const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;
        writeAction({ address: tokenAddress as Address, abi: ERC20ABI, functionName: 'transfer', args: [DEAD_ADDRESS, amountToBurn] });
      }
    } catch { setActionError(`Invalid amount format: ${actionAmount}`); }
  };

  const addToMetaMask = async () => {
    if (typeof window === 'undefined' || !window.ethereum || !token) return;
    try {
       
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
                {isVerified && (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-semibold rounded-lg flex items-center gap-1" title="Verified Contract">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    Verified
                  </span>
                )}
                {token.isPaused && <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg">Paused</span>}
              </div>
              {token.description && <p className="text-gray-400 text-sm mb-3">{token.description}</p>}
              <div className="flex items-center gap-2">
                <span className="text-purple-400 font-mono text-sm">{tokenAddress.slice(0, 10)}...{tokenAddress.slice(-8)}</span>
                <button onClick={copyAddress} className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors" title="Copy address">
                  {copied ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  : <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                </button>
                <button onClick={addToMetaMask} className="px-3 py-1.5 hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-1" title="Add to MetaMask">
                  <span>🦊</span>
                  <span className="text-sm text-gray-400">Add to MetaMask</span>
                </button>
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
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-1">Created</div><div className="text-lg text-white font-semibold">{createdDate.toLocaleDateString()}</div><div className="text-xs text-gray-500">{createdDate.toLocaleTimeString()} {createdDate.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop()}</div></div>
                {isConnected && <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-1">Your Balance</div><div className="text-lg text-white font-semibold">{Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-2">Creator</div><Link href={`/address/${token.creator}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{token.creator.slice(0, 14)}...{token.creator.slice(-10)}</Link></div>
                <div className="bg-gray-800/50 rounded-xl p-4"><div className="text-xs text-gray-500 mb-2">Owner</div><div className="flex items-center justify-between"><Link href={`/address/${token.owner}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{token.owner.slice(0, 14)}...{token.owner.slice(-10)}</Link>{isOwner && <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-lg">You</span>}</div></div>
              </div>

              {/* DEX Listing Section - Available for everyone with balance */}
              {isConnected && userBalance && (userBalance as bigint) > 0n && (
                <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl p-6 border border-cyan-500/30 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <span className="text-xl">💧</span>
                      DEX Trading
                    </h3>
                  </div>
                  <p className="text-gray-400 text-sm mb-4">
                    List this token on DEX to enable trading. Provide liquidity to earn LP tokens.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowDexModal(true)}
                      className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-xl text-white font-medium transition-colors flex items-center gap-2"
                    >
                      <span>💧</span>
                      Add Liquidity
                    </button>
                    <Link
                      href={`/dex?outputToken=${tokenAddress}`}
                      className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-white font-medium transition-colors flex items-center gap-2"
                    >
                      <span>📈</span>
                      Trade on DEX
                    </Link>
                  </div>
                </div>
              )}

              {isOwner && (
                <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-xl p-6 border border-purple-500/30 mb-6">
                  <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2"><svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>Owner Controls</h3>
                  <p className="text-gray-400 text-sm mb-4">As the owner of this token, you have access to the following management features:</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Transfer */}
                    <button onClick={() => setActionModal('transfer')} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left transition-colors group border border-transparent hover:border-blue-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">📤</span>
                        <span className="text-blue-400 font-semibold group-hover:text-blue-300">Transfer</span>
                      </div>
                      <p className="text-gray-500 text-xs">Send tokens to another wallet address. Useful for distribution, payments, or moving funds.</p>
                    </button>

                    {/* Approve */}
                    <button onClick={() => setActionModal('approve')} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left transition-colors group border border-transparent hover:border-green-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">✅</span>
                        <span className="text-green-400 font-semibold group-hover:text-green-300">Approve</span>
                      </div>
                      <p className="text-gray-500 text-xs">Allow a contract (DEX, staking, etc.) to spend your tokens. Required for trading on DEXes.</p>
                    </button>

                    {/* Burn */}
                    <button onClick={() => setActionModal('burn')} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left transition-colors group border border-transparent hover:border-red-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">🔥</span>
                        <span className="text-red-400 font-semibold group-hover:text-red-300">Burn</span>
                      </div>
                      <p className="text-gray-500 text-xs">Permanently destroy tokens to reduce supply. This action is irreversible.</p>
                    </button>

                    {/* Pause/Unpause */}
                    <button onClick={handleTogglePause} disabled={isPausing || isConfirmingPause} className={`bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left transition-colors group border border-transparent disabled:opacity-50 ${token.isPaused ? 'hover:border-green-500/30' : 'hover:border-yellow-500/30'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{isPausing || isConfirmingPause ? '⏳' : token.isPaused ? '▶️' : '⏸️'}</span>
                        <span className={`font-semibold ${token.isPaused ? 'text-green-400 group-hover:text-green-300' : 'text-yellow-400 group-hover:text-yellow-300'}`}>
                          {isPausing || isConfirmingPause ? 'Processing...' : token.isPaused ? 'Unpause Token' : 'Pause Token'}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs">{token.isPaused ? 'Resume all token transfers. Users will be able to send and receive tokens again.' : 'Temporarily halt all token transfers. Useful for emergencies or maintenance.'}</p>
                    </button>

                    {/* Edit Metadata */}
                    <button onClick={openEditModal} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left transition-colors group border border-transparent hover:border-purple-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">✏️</span>
                        <span className="text-purple-400 font-semibold group-hover:text-purple-300">Edit Metadata</span>
                      </div>
                      <p className="text-gray-500 text-xs">Update token logo, description, and website URL. Helps users identify your token.</p>
                    </button>

                    {/* Verify Contract */}
                    <Link href={`/contract/verify?address=${tokenAddress}&contractName=${encodeURIComponent(token.name)}&isLaunchpadToken=true`} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left transition-colors group border border-transparent hover:border-blue-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">🛡️</span>
                        <span className="text-blue-400 font-semibold group-hover:text-blue-300">Verify Contract</span>
                      </div>
                      <p className="text-gray-500 text-xs">Verify and publish your contract source code. Makes your token more trustworthy.</p>
                    </Link>
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
                            <td className="py-3 px-4 text-right text-sm text-white font-medium">{holder.balance}</td>
                            <td className="py-3 px-4 text-right text-sm text-gray-400">{parseFloat(String(holder.percentage || 0)).toFixed(2)}%</td>
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
                    {transfers.map((tx) => {
                      const txDate = tx.timestamp ? new Date(tx.timestamp) : null;
                      const txTimeStr = txDate ? `${txDate.toLocaleString()} ${txDate.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop()}` : `Block #${tx.blockNumber}`;
                      return (
                      <div key={tx.hash} className="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-700/30 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <Link href={`/tx/${tx.hash}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm">{tx.hash.slice(0, 16)}...{tx.hash.slice(-12)}</Link>
                          <span className="text-xs text-gray-500">{txTimeStr}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Link href={`/address/${tx.from}`} className="text-blue-400 hover:text-blue-300 font-mono">{tx.from.slice(0, 8)}...</Link>
                          <span className="text-gray-500">→</span>
                          <Link href={`/address/${tx.to}`} className="text-green-400 hover:text-green-300 font-mono">{tx.to.slice(0, 8)}...</Link>
                          <span className="ml-auto text-white font-medium">{tx.value} {token.symbol}</span>
                        </div>
                      </div>
                      );
                    })}
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

      {/* Transfer Modal */}
      {actionModal === 'transfer' && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">📤 Transfer {token.symbol}</h3>
              <button onClick={closeActionModal} className="p-1 hover:bg-gray-700 rounded-lg transition-colors"><svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            {isActionConfirmed ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4"><svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
                <h4 className="text-lg font-semibold text-white mb-2">Success!</h4>
                <p className="text-gray-400 text-sm mb-4">{actionAmount} {token.symbol} sent to {actionRecipient.slice(0, 10)}...</p>
                <button onClick={closeActionModal} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-white transition-colors">Close</button>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-2">Recipient Address</label>
                  <input type="text" value={actionRecipient} onChange={(e) => setActionRecipient(e.target.value)} placeholder="0x..." className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm" />
                </div>
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm text-gray-400">Amount</label>
                    <span className="text-xs text-gray-500">Balance: {formattedBalance} {token.symbol}</span>
                  </div>
                  <div className="relative">
                    <input type="text" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} placeholder="0.0" className="w-full px-4 py-3 pr-20 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={handleMaxAmount} className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg transition-colors">MAX</button>
                  </div>
                </div>
                {actionError && <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-3 mb-4"><p className="text-red-400 text-sm">{actionError}</p></div>}
                <button onClick={handleTransfer} disabled={!actionAmount || !actionRecipient || isActionPending || isActionConfirming} className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                  {isActionPending || isActionConfirming ? <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>{isActionPending ? 'Confirming...' : 'Processing...'}</> : <>📤 Send Tokens</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {actionModal === 'approve' && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">✅ Approve {token.symbol}</h3>
              <button onClick={closeActionModal} className="p-1 hover:bg-gray-700 rounded-lg transition-colors"><svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            {isActionConfirmed ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4"><svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
                <h4 className="text-lg font-semibold text-white mb-2">Success!</h4>
                <p className="text-gray-400 text-sm mb-4">Approval granted for {actionSpender.slice(0, 10)}...</p>
                <button onClick={closeActionModal} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-white transition-colors">Close</button>
              </div>
            ) : (
              <>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-4">
                  <p className="text-blue-400 text-sm">ℹ️ Approval allows a contract (like DEX) to spend your tokens on your behalf.</p>
                </div>
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-2">Spender Address (Contract)</label>
                  <input type="text" value={actionSpender} onChange={(e) => setActionSpender(e.target.value)} placeholder="0x... (DEX Router, Staking Contract, etc.)" className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm" />
                </div>
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm text-gray-400">Amount to Approve</label>
                    <span className="text-xs text-gray-500">Balance: {formattedBalance} {token.symbol}</span>
                  </div>
                  <div className="relative">
                    <input type="text" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} placeholder="0.0" className="w-full px-4 py-3 pr-32 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                      <button onClick={handleMaxAmount} className="px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-green-500/20 hover:bg-green-500/30 rounded-lg transition-colors">MAX</button>
                      <button onClick={handleUnlimitedApprove} className="px-2 py-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg transition-colors">∞</button>
                    </div>
                  </div>
                </div>
                {actionError && <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-3 mb-4"><p className="text-red-400 text-sm">{actionError}</p></div>}
                <button onClick={handleApprove} disabled={!actionAmount || !actionSpender || isActionPending || isActionConfirming} className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                  {isActionPending || isActionConfirming ? <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>{isActionPending ? 'Confirming...' : 'Processing...'}</> : <>✅ Approve Tokens</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Burn Modal */}
      {actionModal === 'burn' && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">🔥 Burn {token.symbol}</h3>
              <button onClick={closeActionModal} className="p-1 hover:bg-gray-700 rounded-lg transition-colors"><svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            {isActionConfirmed ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4"><svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
                <h4 className="text-lg font-semibold text-white mb-2">Success!</h4>
                <p className="text-gray-400 text-sm mb-4">{actionAmount} {token.symbol} has been burned.</p>
                <button onClick={closeActionModal} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-white transition-colors">Close</button>
              </div>
            ) : (
              <>
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
                  <p className="text-red-400 text-sm">⚠️ Warning: Burning tokens is irreversible. The burned tokens will be permanently destroyed.</p>
                </div>
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm text-gray-400">Amount to Burn</label>
                    <span className="text-xs text-gray-500">Balance: {formattedBalance} {token.symbol}</span>
                  </div>
                  <div className="relative">
                    <input type="text" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} placeholder="0.0" className="w-full px-4 py-3 pr-20 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500" />
                    <button onClick={handleMaxAmount} className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors">MAX</button>
                  </div>
                </div>
                {actionError && <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-3 mb-4"><p className="text-red-400 text-sm">{actionError}</p></div>}
                <button onClick={handleBurn} disabled={!actionAmount || isActionPending || isActionConfirming} className="w-full py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                  {isActionPending || isActionConfirming ? <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>{isActionPending ? 'Confirming...' : 'Processing...'}</> : <>🔥 Burn Tokens</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* List on DEX Modal */}
      {token && (
        <ListOnDexModal
          isOpen={showDexModal}
          onClose={() => setShowDexModal(false)}
          tokenAddress={tokenAddress}
          tokenSymbol={token.symbol}
          tokenDecimals={token.decimals}
          tokenBalance={(userBalance as bigint) || 0n}
        />
      )}
    </div>
  );
}
