'use client';

import { use } from 'react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  UserIcon, 
  ArrowUpIcon,
  CurrencyDollarIcon,
  CubeIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  CodeBracketIcon,
  PlayIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import SummaryCard from '../../components/SummaryCard';
import { getCurrencySymbol, initializeCurrencyConfig } from '../../../lib/client-config';
import { initializeCurrency } from '../../../lib/bigint-utils';

interface Account {
  address: string;
  balance: string;
  balanceRaw: string;
  percentage: string;
  rank: number | null;
  transactionCount: number;
  blocksMined: number;
  tokenTransferCount: number;
  firstSeen: string;
  lastActivity: string;
}

interface Contract {
  address: string;
  name: string;
  symbol: string;
  type: string;
  decimals: number;
  totalSupply: string;
  verified: boolean;
  creationTransaction: string;
  blockNumber: number;
  isContract?: boolean;
  bytecodeSize?: number;
  sourceCode?: string;
  abi?: string;
  byteCode?: string;
  compilerVersion?: string;
  optimization?: boolean;
}

interface Config {
  miners: Record<string, string>;
  explorer: {
    name: string;
    description: string;
    version: string;
    url: string;
  };
}

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  type: string;
  value: string;
  tokenId?: number;
}

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  valueRaw?: string;
  timestamp: number;
  blockNumber: number;
  gasUsed?: number;
  gasPrice?: string;
  status?: number | string;
  type?: string;
  action?: string;
  direction?: 'in' | 'out' | 'self';
  input?: string;
  tokenInfo?: TokenInfo;
  nftInfo?: {
    tokenId: number;
    tokenAddress: string;
  };
}

export default function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<'transactions' | 'mining' | 'source'>('transactions');
  const [transactionStats, setTransactionStats] = useState<{
    regularCount: number;
    miningCount: number;
    totalCount: number;
  } | null>(null);
  const [currencySymbol, setCurrencySymbol] = useState<string>('');
  const [contractDetails, setContractDetails] = useState<{
    sourceCode?: string;
    abi?: string;
    byteCode?: string;
    compilerVersion?: string;
    optimization?: boolean;
  } | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        await initializeCurrency();
        await initializeCurrencyConfig();
        const symbol = getCurrencySymbol();
        setCurrencySymbol(symbol);
        const response = await fetch('/api/config');
        if (response.ok) {
          const configData = await response.json();
          setConfig(configData);
        }
      } catch (err) {
        console.error('Error fetching config:', err);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    const fetchAddressData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // First check if this is a token contract - if so, redirect to /token/ page
        try {
          const tokenRes = await fetch(`/api/tokens/${resolvedParams.address}`);
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            // If it's a registered token (VRC-20, VRC-721, VRC-1155), redirect
            if (tokenData.token && ['VRC-20', 'VRC-721', 'VRC-1155', 'ERC20', 'ERC721'].includes(tokenData.token.type)) {
              router.replace(`/token/${resolvedParams.address}`);
              return;
            }
          }
        } catch {
          // Not a token, continue checking if contract
        }
        
        const response = await fetch(`/api/address/${resolvedParams.address}`);
        if (!response.ok) {
          throw new Error('Address not found');
        }
        const data = await response.json();
        
        // If it's a contract (but not a token), redirect to /contract/ page
        if (data.contract?.isContract) {
          router.replace(`/contract/${resolvedParams.address}`);
          return;
        }
        
        setAccount(data.account);
        setContract(data.contract);
        setTransactions(data.transactions || []);
        setTransactionStats(data.transactionStats || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch address data');
      } finally {
        setLoading(false);
      }
    };
    if (resolvedParams.address) {
      fetchAddressData();
    }
  }, [resolvedParams.address, router]);

  // 通貨記号が取得できるまでローディング表示
  if (!currencySymbol) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex justify-center items-center h-64'>
            <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500'></div>
          </div>
          <div className='text-center text-gray-400 mt-4'>Loading currency symbol...</div>
        </div>
      </div>
    );
  }

  const copyToClipboard = async (text: string) => {
    try {
      // モダンなブラウザでは Clipboard API を使用
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // フォールバック: 古いブラウザや非セキュアコンテキスト用
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      
      // コピー成功時のフィードバック
      setCopiedItem(text);
      setTimeout(() => {
        setCopiedItem(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const formatValue = (value: string) => {
    try {
      const weiValue = BigInt(value);
      const nativeValue = Number(weiValue) / 1e18;
      if (nativeValue === 0) return `0 ${currencySymbol}`;
      if (nativeValue < 0.000001) return `<0.000001 ${currencySymbol}`;
      return `${nativeValue.toFixed(4)} ${currencySymbol}`;
    } catch {
      return `${value} ${currencySymbol}`;
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    if (address === '0x0000000000000000000000000000000000000000') return 'System';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const getTimeAgo = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const parseDate = (dateString: string) => {
    if (!dateString || dateString === 'Invalid Date') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  };

  const getMinerDisplayInfo = (miner: string) => {
    if (!miner || !config?.miners) return { name: 'Unknown', isPool: false, address: null };

    const minerKey = Object.keys(config.miners).find(
      key => key.toLowerCase() === miner.toLowerCase()
    );
    
    if (minerKey) {
      return {
        name: config.miners[minerKey],
        isPool: true,
        address: miner
      };
    }

    return {
      name: miner,
      isPool: false,
      address: miner
    };
  };

  const getAddressType = () => {
    if (contract?.isContract) {
      if (contract.type === 'ERC20' || contract.type === 'VRC-20') return 'Token Contract';
      if (contract.type === 'VRC-721' || contract.type === 'ERC721') return 'NFT Contract';
      return 'Smart Contract';
    }
    if (resolvedParams.address === '0x0000000000000000000000000000000000000000') return 'System Address';
    return 'Wallet Address';
  };

  const getAddressName = () => {
    // コントラクトの場合
    if (contract?.name && contract.name !== 'Unknown Contract' && contract.name !== 'Unverified Contract') {
      return contract.name;
    }
    
    // プールアドレスの場合
    const minerInfo = getMinerDisplayInfo(resolvedParams.address);
    if (minerInfo.isPool) {
      return minerInfo.name;
    }
    
    // システムアドレスの場合
    if (resolvedParams.address === '0x0000000000000000000000000000000000000000') {
      return 'System';
    }
    
    return null;
  };

  // MetaMask準拠のトランザクションタイプバッジを返す
  const getTransactionTypeBadge = (tx: Transaction) => {
    const type = tx.type || 'unknown';
    const action = tx.action || type;
    const direction = tx.direction || 'out';
    
    // タイプごとのスタイル定義
    const styles: Record<string, { bg: string; text: string; icon: string }> = {
      'send': { bg: 'bg-red-500/20', text: 'text-red-400', icon: '↑' },
      'receive': { bg: 'bg-green-500/20', text: 'text-green-400', icon: '↓' },
      'token_transfer': { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: '⇄' },
      'nft_transfer': { bg: 'bg-pink-500/20', text: 'text-pink-400', icon: '🎨' },
      'approve': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '✓' },
      'swap': { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '⟲' },
      'liquidity': { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: '💧' },
      'stake': { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '📥' },
      'unstake': { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '📤' },
      'harvest': { bg: 'bg-lime-500/20', text: 'text-lime-400', icon: '🌾' },
      'mint': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '✨' },
      'burn': { bg: 'bg-red-600/20', text: 'text-red-500', icon: '🔥' },
      'contract_creation': { bg: 'bg-indigo-500/20', text: 'text-indigo-400', icon: '📄' },
      'contract_interaction': { bg: 'bg-violet-500/20', text: 'text-violet-400', icon: '⚡' },
      'mining_reward': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⛏️' },
      'unknown': { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: '?' }
    };
    
    const style = styles[type] || styles['unknown'];
    
    // 方向矢印（receive/sendの場合を除く）
    let directionIcon = '';
    if (type !== 'send' && type !== 'receive' && type !== 'mining_reward') {
      if (direction === 'in') directionIcon = ' ↓';
      else if (direction === 'out') directionIcon = ' ↑';
    }
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${style.bg} ${style.text}`}>
        <span>{style.icon}</span>
        <span>{action}{directionIcon}</span>
      </span>
    );
  };

  // トークン転送値をフォーマット
  const formatTokenValue = (tx: Transaction) => {
    if (!tx.tokenInfo) return null;
    
    const { value, decimals, symbol, tokenId, type } = tx.tokenInfo;
    
    // NFTの場合
    if (type === 'VRC-721' || type === 'ERC721' || tokenId !== undefined) {
      return (
        <span className='text-pink-400'>
          Token ID: #{tokenId}
        </span>
      );
    }
    
    // ERC20の場合
    try {
      const numValue = BigInt(value);
      const divisor = BigInt(10 ** decimals);
      const intPart = numValue / divisor;
      const fracPart = numValue % divisor;
      const formatted = fracPart > 0n 
        ? `${intPart}.${fracPart.toString().padStart(decimals, '0').slice(0, 4)}`
        : intPart.toString();
      return (
        <span className='text-purple-400'>
          {formatted} {symbol}
        </span>
      );
    } catch {
      return <span className='text-purple-400'>{value} {symbol}</span>;
    }
  };

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
          <div className='container mx-auto px-4 py-8'>
          <div className='flex justify-center items-center h-64'>
            <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500'></div>
          </div>
        </div>
          </div>
    );
  }

  if (error) {
    return (
      <div className='min-h-screen bg-gray-900 text-white'>
          <div className='container mx-auto px-4 py-8'>
          <div className='bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded mb-4'>
            <strong className='font-bold'>Error:</strong>
            <span className='block sm:inline'> {error || 'Address not found'}</span>
          </div>
            <Link
              href='/'
              className='inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors'
            >
              <ArrowUpIcon className='w-4 h-4' />
              Back to Explorer
            </Link>
      </div>
      </div>
    );
  }

  // Filter transactions by type (needed for both contract and wallet views)
  // Mining rewards以外の全てのトランザクションを通常トランザクションとして表示
  const regularTransactions = transactions.filter(tx => 
    tx.type !== 'mining_reward'
  );
  
  const miningRewards = transactions.filter(tx => 
    tx.type === 'mining_reward'
  );

  // 統計情報を使用して件数を表示（APIから取得した正確な件数）
  const regularCount = transactionStats?.regularCount || regularTransactions.length;
  const miningCount = transactionStats?.miningCount || miningRewards.length;
  
  // Check if this is a contract address
  const isContractAddress = contract?.isContract === true;

  // Contract Page (Token-like design)
  if (isContractAddress) {
    const tabs = [
      { id: 'transactions', label: 'Transactions', icon: ArrowPathIcon },
      ...(miningCount > 0 ? [{ id: 'mining', label: 'Mining Rewards', icon: CubeIcon }] : []),
      { id: 'source', label: 'Contract Source', icon: CodeBracketIcon },
    ];

    return (
      <div className='min-h-screen bg-gray-900 text-white'>
        {/* Page Header */}
        <div className='bg-gray-800 border-b border-gray-700'>
          <div className='container mx-auto px-4 py-8'>
            <div className='flex items-center gap-3 mb-2'>
              <CodeBracketIcon className='w-8 h-8 text-purple-400' />
              <h1 className='text-3xl font-bold text-gray-100'>Contract Details</h1>
            </div>
            <p className='text-gray-400'>
              {contract?.name || 'Smart Contract'} {contract?.symbol ? `(${contract.symbol})` : ''} - {formatAddress(resolvedParams.address)}
            </p>
          </div>
        </div>

        <main className='container mx-auto px-4 py-8'>
          {/* Stats Cards */}
          <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-8'>
            <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
              <h3 className='text-sm font-medium text-gray-300 mb-2'>Balance</h3>
              <p className='text-2xl font-bold text-green-400'>
                {account ? (() => {
                  try {
                    const weiValue = BigInt(account.balanceRaw);
                    const nativeValue = Number(weiValue) / 1e18;
                    if (nativeValue === 0) return '0';
                    if (nativeValue < 0.0001) return '<0.0001';
                    return nativeValue.toFixed(4);
                  } catch {
                    return account.balance;
                  }
                })() : '0'} {currencySymbol}
              </p>
              <p className='text-xs text-gray-400'>Contract balance</p>
            </div>

            <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
              <h3 className='text-sm font-medium text-gray-300 mb-2'>Transactions</h3>
              <p className='text-2xl font-bold text-blue-400'>{(account?.transactionCount || 0).toLocaleString()}</p>
              <p className='text-xs text-gray-400'>Total interactions</p>
            </div>

            <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
              <h3 className='text-sm font-medium text-gray-300 mb-2'>Token Transfers</h3>
              <p className='text-2xl font-bold text-purple-400'>{(account?.tokenTransferCount || 0).toLocaleString()}</p>
              <p className='text-xs text-gray-400'>ERC20/721 transfers</p>
            </div>

            <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
              <h3 className='text-sm font-medium text-gray-300 mb-2'>Verification</h3>
              <p className='text-2xl font-bold'>
                {contract?.verified ? (
                  <span className='text-green-400 flex items-center gap-2'>
                    <CheckCircleIcon className='w-6 h-6' />
                    Verified
                  </span>
                ) : (
                  <span className='text-yellow-400'>Unverified</span>
                )}
              </p>
              <p className='text-xs text-gray-400'>Source code status</p>
            </div>
          </div>

          {/* Contract Info Card */}
          <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
            <div className='flex items-center justify-between mb-6'>
              <h2 className='text-xl font-semibold text-gray-100'>Contract Information</h2>
              <div className='flex gap-2'>
                <Link
                  href={`/contract/interact?address=${resolvedParams.address}`}
                  className='inline-flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm'
                >
                  <PlayIcon className='w-4 h-4' />
                  Interact
                </Link>
                {!contract?.verified && (
                  <Link
                    href={`/contract/verify?address=${resolvedParams.address}&contractName=${contract?.name?.replace(/\s+/g, '') || 'Contract'}`}
                    className='inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm'
                  >
                    <CodeBracketIcon className='w-4 h-4' />
                    Verify
                  </Link>
                )}
              </div>
            </div>
            
            <div className='grid grid-cols-1 md:grid-cols-4 gap-6'>
              <div className='md:col-span-2'>
                <div className='text-sm font-medium text-gray-300 mb-2'>Contract Address</div>
                <div className='flex items-center gap-2 font-mono text-blue-400 text-sm break-all bg-white/10 rounded px-3 py-2'>
                  <span>{resolvedParams.address}</span>
                  <button
                    onClick={() => copyToClipboard(resolvedParams.address)}
                    className='p-1 text-gray-400 hover:text-blue-400 transition-colors'
                    title='Copy address'
                  >
                    <ClipboardDocumentIcon className='w-4 h-4' />
                  </button>
                  {copiedItem === resolvedParams.address && (
                    <span className='text-green-400 text-xs'>Copied!</span>
                  )}
                </div>
              </div>
              
              <div>
                <div className='text-sm font-medium text-gray-300 mb-2'>Contract Name</div>
                <div className='text-orange-400 text-lg font-semibold'>{contract?.name || 'Unknown'}</div>
              </div>
              
              <div>
                <div className='text-sm font-medium text-gray-300 mb-2'>Type</div>
                <span className={`px-3 py-1 rounded text-sm font-medium ${
                  contract?.type === 'ERC20' || contract?.type === 'VRC-20' ? 'bg-blue-500/20 text-blue-400' :
                  contract?.type === 'VRC-721' || contract?.type === 'ERC721' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {contract?.type || 'Contract'}
                </span>
              </div>
              
              {contract?.symbol && (
                <div>
                  <div className='text-sm font-medium text-gray-300 mb-2'>Symbol</div>
                  <div className='text-green-400 text-lg font-bold'>{contract.symbol}</div>
                </div>
              )}
              
              {contract?.decimals !== undefined && contract.decimals > 0 && (
                <div>
                  <div className='text-sm font-medium text-gray-300 mb-2'>Decimals</div>
                  <div className='text-gray-200 text-lg font-bold'>{contract.decimals}</div>
                </div>
              )}
              
              {contract?.blockNumber && contract.blockNumber > 0 && (
                <div>
                  <div className='text-sm font-medium text-gray-300 mb-2'>Created at Block</div>
                  <Link
                    href={`/block/${contract.blockNumber}`}
                    className='text-blue-400 hover:text-blue-300 text-lg font-bold'
                  >
                    #{contract.blockNumber.toLocaleString()}
                  </Link>
                </div>
              )}
              
              {contract?.creationTransaction && (
                <div>
                  <div className='text-sm font-medium text-gray-300 mb-2'>Creation Tx</div>
                  <Link
                    href={`/tx/${contract.creationTransaction}`}
                    className='text-blue-400 hover:text-blue-300 font-mono text-sm'
                  >
                    {formatAddress(contract.creationTransaction)}
                  </Link>
                </div>
              )}

              {contract?.verified && (
                <div>
                  <div className='text-sm font-medium text-gray-300 mb-2'>Verification</div>
                  <div className='flex items-center gap-1 px-3 py-1 bg-green-500/20 text-green-400 rounded text-sm font-medium w-fit'>
                    <CheckCircleIcon className='w-4 h-4' />
                    <span>Verified</span>
                  </div>
                </div>
              )}

              {contractDetails?.compilerVersion && (
                <div>
                  <div className='text-sm font-medium text-gray-300 mb-2'>Compiler</div>
                  <div className='text-gray-200'>Solidity {contractDetails.compilerVersion}</div>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className='bg-gray-800 rounded-lg border border-gray-700 overflow-hidden'>
            <div className='border-b border-gray-700'>
              <div className='flex flex-wrap'>
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as 'transactions' | 'mining' | 'source')}
                      className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'bg-gray-700/50 text-blue-400 border-b-2 border-blue-400'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                      }`}
                    >
                      <Icon className='w-5 h-5' />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='p-6'>
              {/* Transactions Tab */}
              {activeTab === 'transactions' && (
                <div className='space-y-4'>
                  {regularTransactions.length === 0 ? (
                    <p className='text-gray-400 text-center py-8'>No transactions found for this contract.</p>
                  ) : (
                    <>
                      <div className='overflow-x-auto'>
                        <table className='w-full'>
                          <thead>
                            <tr className='border-b border-gray-600'>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Tx Hash</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>From</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>To</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Value</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                            </tr>
                          </thead>
                          <tbody className='divide-y divide-gray-600'>
                            {regularTransactions.slice(0, 10).map((tx) => (
                              <tr key={tx.hash} className='hover:bg-gray-700/50 transition-colors'>
                                <td className='py-3 px-4'>
                                  <Link href={`/tx/${tx.hash}`} className='text-blue-400 hover:text-blue-300 font-mono text-sm'>
                                    {formatAddress(tx.hash)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4'>
                                  <Link href={`/address/${tx.from}`} className='text-green-400 hover:text-green-300 font-mono text-sm'>
                                    {formatAddress(tx.from)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4'>
                                  <Link href={`/address/${tx.to}`} className='text-red-400 hover:text-red-300 font-mono text-sm'>
                                    {formatAddress(tx.to)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4 text-yellow-400'>{formatValue(tx.value)}</td>
                                <td className='py-3 px-4'>
                                  <div className='flex items-center gap-2'>
                                    <ClockIcon className='w-4 h-4 text-gray-500' />
                                    <span className='text-gray-300 text-sm'>{getTimeAgo(tx.timestamp)}</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className='text-center'>
                        <Link
                          href={`/address/${resolvedParams.address}/transactions`}
                          className='text-blue-400 hover:text-blue-300 text-sm'
                        >
                          View all {regularCount} transactions →
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Mining Tab */}
              {activeTab === 'mining' && (
                <div className='space-y-4'>
                  {miningRewards.length === 0 ? (
                    <p className='text-gray-400 text-center py-8'>No mining rewards for this address.</p>
                  ) : (
                    <>
                      <div className='overflow-x-auto'>
                        <table className='w-full'>
                          <thead>
                            <tr className='border-b border-gray-600'>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Block Hash</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Reward</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                            </tr>
                          </thead>
                          <tbody className='divide-y divide-gray-600'>
                            {miningRewards.slice(0, 10).map((tx) => (
                              <tr key={tx.hash} className='hover:bg-gray-700/50 transition-colors'>
                                <td className='py-3 px-4'>
                                  <Link href={`/tx/${tx.hash}`} className='text-blue-400 hover:text-blue-300 font-mono text-sm'>
                                    {formatAddress(tx.hash)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4 text-yellow-400'>{formatValue(tx.value)}</td>
                                <td className='py-3 px-4'>
                                  <div className='flex items-center gap-2'>
                                    <ClockIcon className='w-4 h-4 text-gray-500' />
                                    <span className='text-gray-300 text-sm'>{getTimeAgo(tx.timestamp)}</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className='text-center'>
                        <Link
                          href={`/address/${resolvedParams.address}/mining`}
                          className='text-blue-400 hover:text-blue-300 text-sm'
                        >
                          View all {miningCount} mining rewards →
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Source Code Tab */}
              {activeTab === 'source' && (
                <div className='space-y-4'>
                  {contract?.verified && contractDetails?.sourceCode ? (
                    <div className='space-y-4'>
                      <div className='flex items-center gap-2 mb-4'>
                        <div className='w-2 h-2 bg-green-400 rounded-full'></div>
                        <span className='text-green-400 font-medium'>Contract Verified</span>
                      </div>

                      <div className='grid grid-cols-3 gap-4 mb-4'>
                        <div className='bg-gray-700/50 rounded p-3'>
                          <div className='text-gray-400 text-sm'>Contract Name</div>
                          <div className='text-gray-200 font-medium'>{contract.name}</div>
                        </div>
                        <div className='bg-gray-700/50 rounded p-3'>
                          <div className='text-gray-400 text-sm'>Compiler</div>
                          <div className='text-gray-200 font-medium'>Solidity {contractDetails.compilerVersion || 'Unknown'}</div>
                        </div>
                        <div className='bg-gray-700/50 rounded p-3'>
                          <div className='text-gray-400 text-sm'>Optimization</div>
                          <div className='text-gray-200 font-medium'>{contractDetails.optimization ? 'Enabled' : 'Disabled'}</div>
                        </div>
                      </div>

                      {/* Source Code */}
                      <div className='bg-gray-950 rounded border border-gray-700 overflow-hidden'>
                        <div className='bg-gray-800 px-4 py-2 border-b border-gray-700'>
                          <span className='text-sm font-medium text-gray-300'>Contract Source Code</span>
                        </div>
                        <pre className='p-4 overflow-x-auto text-sm text-gray-300 max-h-96 overflow-y-auto'>
                          <code className='whitespace-pre-wrap break-all'>
                            {contractDetails.sourceCode}
                          </code>
                        </pre>
                      </div>

                      {/* ABI */}
                      {contractDetails.abi && (
                        <div className='bg-gray-950 rounded border border-gray-700 overflow-hidden'>
                          <div className='bg-gray-800 px-4 py-2 border-b border-gray-700'>
                            <span className='text-sm font-medium text-gray-300'>Contract ABI</span>
                          </div>
                          <pre className='p-4 overflow-x-auto text-sm text-gray-300 max-h-48 overflow-y-auto'>
                            <code className='whitespace-pre-wrap break-all'>
                              {contractDetails.abi}
                            </code>
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className='space-y-4'>
                      <div className='flex items-center gap-2 mb-4'>
                        <div className='w-2 h-2 bg-red-400 rounded-full'></div>
                        <span className='text-red-400 font-medium'>Contract Not Verified</span>
                      </div>

                      {/* Bytecode */}
                      <div className='bg-gray-950 rounded border border-gray-700 overflow-hidden'>
                        <div className='bg-gray-800 px-4 py-2 border-b border-gray-700'>
                          <span className='text-sm font-medium text-gray-300'>Contract Bytecode</span>
                        </div>
                        <pre className='p-4 overflow-x-auto text-sm text-gray-300 max-h-48 overflow-y-auto'>
                          <code className='whitespace-pre-wrap break-all'>
                            {contractDetails?.byteCode || contract?.byteCode || '0x'}
                          </code>
                        </pre>
                      </div>

                      {/* Verify Button */}
                      <div className='bg-gray-700/50 rounded-lg p-6 border border-gray-600'>
                        <div className='text-center'>
                          <CodeBracketIcon className='w-12 h-12 text-gray-500 mx-auto mb-4' />
                          <h3 className='text-lg font-semibold text-gray-100 mb-2'>Verify Contract Source Code</h3>
                          <p className='text-gray-400 text-sm mb-6'>
                            Verify and publish the source code for this contract to make it readable and auditable.
                          </p>
                          
                          <div className='flex flex-col sm:flex-row gap-3 justify-center'>
                            <Link 
                              href={`/contract/verify?address=${resolvedParams.address}&contractName=${contract?.name?.replace(/\s+/g, '') || 'Contract'}`}
                              className='inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors'
                            >
                              <CodeBracketIcon className='w-5 h-5' />
                              Verify & Push
                            </Link>
                            
                            <Link 
                              href={`/contract/interact?address=${resolvedParams.address}`}
                              className='inline-flex items-center gap-2 px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors'
                            >
                              <PlayIcon className='w-5 h-5' />
                              Interact
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }
  
  // Summary cards
  console.log('Account data:', account);
  console.log('Currency symbol:', currencySymbol);
  
  const balanceValue = account ? (() => {
    try {
      const weiValue = BigInt(account.balanceRaw);
      const nativeValue = Number(weiValue) / 1e18;
      const symbol = currencySymbol || 'ETH';
      console.log('Balance formatting:', { weiValue: account.balanceRaw, nativeValue, symbol });
      if (nativeValue === 0) return `0 ${symbol}`;
      if (nativeValue < 0.000001) return `<0.000001 ${symbol}`;
      const result = `${nativeValue.toFixed(4)} ${symbol}`;
      console.log('Formatted balance:', result);
      return result;
    } catch (error) {
      console.error('Balance formatting error:', error);
      const symbol = currencySymbol || 'ETH';
      return `${account.balance} ${symbol}`;
    }
  })() : `0 ${currencySymbol || 'ETH'}`;
  
  console.log('Final balance value:', balanceValue);
  
  const summaryStats = [
    {
      title: 'Balance',
      value: balanceValue,
      sub: 'Current account balance',
      icon: <CurrencyDollarIcon className='w-5 h-5 text-green-400' />,
      colorClass: 'text-green-400'
    },
    {
      title: 'Transactions',
      value: account?.transactionCount?.toString() || '0',
      sub: 'Total transactions',
      icon: <ArrowPathIcon className='w-5 h-5 text-blue-400' />,
      colorClass: 'text-blue-400'
    },
    {
      title: 'Token Transfers',
      value: account?.tokenTransferCount?.toString() || '0',
      sub: 'Total token transfers',
      icon: <ArrowUpIcon className='w-5 h-5 text-purple-400' />,
      colorClass: 'text-purple-400'
    },
    {
      title: 'Blocks Mined',
      value: account?.blocksMined?.toString() || '0',
      sub: 'Blocks mined by this address',
      icon: <CubeIcon className='w-5 h-5 text-yellow-400' />,
      colorClass: 'text-yellow-400'
    }
  ];

  return (
    <div className='min-h-screen bg-gray-900 text-white'>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <UserIcon className='w-8 h-8 text-blue-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Address Details</h1>
          </div>
          <p className='text-gray-400'>
            Account information and transaction history for {formatAddress(resolvedParams.address)}
          </p>
        </div>
      </div>

      <main className='container mx-auto px-4 py-8'>
        {/* Summary Cards */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-8'>
          {summaryStats.map((stat, idx) => (
            <SummaryCard key={idx} {...stat} />
          ))}
            </div>

        {/* Account Information */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-semibold text-gray-100 mb-4'>Account Information</h2>
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Address</label>
                <div className='bg-gray-700 rounded p-3 flex items-center justify-between'>
                  <span className='text-white font-mono text-sm break-all'>{resolvedParams.address}</span>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => copyToClipboard(resolvedParams.address)}
                      className='p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-all duration-200'
                      title='Copy to clipboard'
                    >
                      <ClipboardDocumentIcon className='w-4 h-4' />
                    </button>
                    {copiedItem === resolvedParams.address && (
                      <span className='text-green-400 text-sm font-mono'>Copied!</span>
                    )}
                  </div>
                </div>
            </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Type</label>
                  <div className='text-blue-400 text-lg font-semibold'>
                    {getAddressType()}
                  </div>
                </div>
                {getAddressName() && (
                  <div>
                    <label className='block text-sm font-medium text-gray-400 mb-2'>Name</label>
                    <div className='text-green-400 text-lg font-semibold'>
                      {getAddressName()}
                    </div>
                  </div>
                )}
            </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Balance</label>
                  <div className='text-green-400 text-lg font-semibold'>
                    {account ? formatValue(account.balance) : '0 VBC'}
                  </div>
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Transaction Count</label>
                  <div className='text-blue-400 text-lg font-semibold'>
                    {account?.transactionCount?.toLocaleString() || '0'}
                  </div>
            </div>
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Token Transfers</label>
                  <div className='text-purple-400 text-lg font-semibold'>
                    {account?.tokenTransferCount?.toLocaleString() || '0'}
                  </div>
            </div>
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Blocks Mined</label>
                  <div className='text-yellow-400 text-lg font-semibold'>
                    {account?.blocksMined?.toLocaleString() || '0'}
                  </div>
                </div>
              </div>


            </div>

            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>First Seen</label>
                <div className='text-white'>
                  {(() => {
                    if (!account?.firstSeen) return 'Unknown';
                    
                    // APIから返される形式: "2025-06-14 7:46:26 AM GMT+9 (36 days ago)"
                    if (account.firstSeen.includes('(') && account.firstSeen.includes(')')) {
                      const [datePart, agoPart] = account.firstSeen.split(' (');
                      const ago = agoPart?.replace(')', '');
                      
                      // 日付部分をDateオブジェクトに変換
                      const dateMatch = datePart.match(/(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} [AP]M)/);
                      if (dateMatch) {
                        const dateStr = dateMatch[1];
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime())) {
                          return (
                            <div>
                              <div className='text-sm text-gray-300'>{ago}</div>
                              <div className='text-xs text-gray-500'>{date.toLocaleString(undefined, { timeZoneName: 'short' })}</div>
                            </div>
                          );
                        }
                      }
                      
                      // パースに失敗した場合は元の形式を表示
                      return (
                        <div>
                          <div className='text-sm text-gray-300'>{ago}</div>
                          <div className='text-xs text-gray-500'>{datePart}</div>
                        </div>
                      );
                    }
                    
                    // フォールバック: 古い形式の場合
                    const firstSeenDate = parseDate(account.firstSeen);
                    if (!firstSeenDate) return 'Unknown';
                    return firstSeenDate.toLocaleString(undefined, { timeZoneName: 'short' });
                  })()}
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>Last Activity</label>
                <div className='text-white'>
                  {(() => {
                    if (!account?.lastActivity) return 'Unknown';
                    // APIから返される形式: "2025-06-17 16:09:06 JST (29 days ago)"
                    if (account.lastActivity.includes('(') && account.lastActivity.includes(')')) {
                      const [datePart, agoPart] = account.lastActivity.split(' (');
                      const ago = agoPart?.replace(')', '');

                      // 日付部分をDateオブジェクトに変換
                      const dateMatch = datePart.match(/(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} [AP]M)/);
                      if (dateMatch) {
                        const dateStr = dateMatch[1];
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime())) {
                          return (
                            <div>
                              <div className='text-sm text-gray-300'>{ago}</div>
                              <div className='text-xs text-gray-500'>{date.toLocaleString(undefined, { timeZoneName: 'short' })}</div>
                            </div>
                          );
                        }
                      }
                      
                      // パースに失敗した場合は元の形式を表示

                      return (
                        <div>
                          <div className='text-sm text-gray-300'>{ago}</div>
                          <div className='text-xs text-gray-500'>{datePart}</div>
                        </div>
                      );
                    }
                    // フォールバック: 古い形式の場合
                    const lastActivityDate = parseDate(account.lastActivity);
                    if (!lastActivityDate) return 'Unknown';
                    const timestamp = Math.floor(lastActivityDate.getTime() / 1000);
                    return (
                <div>
                        <div className='text-sm text-gray-300'>{getTimeAgo(timestamp)}</div>
                        <div className='text-xs text-gray-500'>{formatTimestamp(timestamp)}</div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {account?.rank && (
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Rank</label>
                  <div className='text-purple-400 text-lg font-semibold'>
                    #{account.rank.toLocaleString()}
                  </div>
                </div>
              )}

              {account?.percentage && (
                <div>
                  <label className='block text-sm font-medium text-gray-400 mb-2'>Percentage</label>
                  <div className='text-gray-200'>
                    {parseFloat(account.percentage).toFixed(4)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Transactions */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
          <div className='flex items-center justify-between mb-6'>
            <h2 className='text-xl font-semibold text-gray-100'>Transactions</h2>
          </div>
          
          {/* Tab Navigation */}
          <div className='flex flex-wrap gap-2 mb-6 border-b border-gray-700'>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`group relative px-4 py-2 rounded-t-lg font-medium transition-all duration-300 ${
                activeTab === 'transactions'
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
              }`}
            >
              <span className='relative z-10'>Regular Transactions ({regularCount})</span>
              {activeTab === 'transactions' && (
                <div className='absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-600/20 rounded-t-lg'></div>
              )}
            </button>
            <button
              onClick={() => setActiveTab('mining')}
              className={`group relative px-4 py-2 rounded-t-lg font-medium transition-all duration-300 ${
                activeTab === 'mining'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
              }`}
            >
              <span className='relative z-10'>Mining Rewards ({miningCount})</span>
              {activeTab === 'mining' && (
                <div className='absolute inset-0 bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 rounded-t-lg'></div>
              )}
            </button>
          </div>
          
          {/* Tab Content */}
          <div className='min-h-[400px] relative overflow-hidden'>
            <div 
              key={activeTab}
              className='animate-tabSlideIn'
              style={{
                animation: 'tabSlideIn 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              {activeTab === 'transactions' ? (
                <>
                  {regularTransactions.length === 0 ? (
                    <>
                      <p className='text-gray-400'>No transactions for this address.</p>
                      <div className='mt-4 text-center'>
                        <Link
                          href={`/address/${resolvedParams.address}/transactions`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View all {regularCount} transactions →
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className='overflow-x-auto'>
                        <table className='w-full'>
                          <thead>
                            <tr className='border-b border-gray-600'>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Tx Hash</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Type</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>From</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>To</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Value</th>
                              <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                            </tr>
                          </thead>
                          <tbody className='divide-y divide-gray-600'>
                            {regularTransactions.slice(0, 10).map((tx) => (
                              <tr key={tx.hash} className='hover:bg-gray-700/50 transition-colors'>
                                <td className='py-3 px-4'>
                                  <Link
                                    href={`/tx/${tx.hash}`}
                                    className='text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors'
                                    title={tx.hash}
                                  >
                                    {formatAddress(tx.hash)}
                                  </Link>
                                </td>
                                <td className='py-3 px-4'>
                                  {getTransactionTypeBadge(tx)}
                                </td>
                                <td className='py-3 px-4'>
                                  {tx.from === '0x0000000000000000000000000000000000000000' ? (
                                    <span className='text-yellow-400 text-sm'>System</span>
                                  ) : tx.from.toLowerCase() === resolvedParams.address.toLowerCase() ? (
                                    <span className='text-gray-400 font-mono text-sm'>You</span>
                                  ) : (
                                    <Link
                                      href={`/address/${tx.from}`}
                                      className='text-green-400 hover:text-green-300 font-mono text-sm transition-colors'
                                      title={tx.from}
                                    >
                                      {formatAddress(tx.from)}
                                    </Link>
                                  )}
                                </td>
                                <td className='py-3 px-4'>
                                  {!tx.to || tx.to === '0x0000000000000000000000000000000000000000' ? (
                                    <span className='text-indigo-400 text-sm'>Contract Created</span>
                                  ) : tx.to.toLowerCase() === resolvedParams.address.toLowerCase() ? (
                                    <span className='text-gray-400 font-mono text-sm'>You</span>
                                  ) : (
                                    <Link
                                      href={`/address/${tx.to}`}
                                      className='text-red-400 hover:text-red-300 font-mono text-sm transition-colors'
                                      title={tx.to}
                                    >
                                      {formatAddress(tx.to)}
                                    </Link>
                                  )}
                                </td>
                                <td className='py-3 px-4'>
                                  <div className='flex flex-col'>
                                    {/* ネイティブ通貨 */}
                                    {parseFloat(tx.value) > 0 && (
                                      <span className={tx.direction === 'in' ? 'text-green-400' : 'text-red-400'}>
                                        {tx.direction === 'in' ? '+' : '-'}{formatValue(tx.value)}
                                      </span>
                                    )}
                                    {/* トークン転送 */}
                                    {tx.tokenInfo && (
                                      <div className='text-sm'>
                                        {formatTokenValue(tx)}
                                      </div>
                                    )}
                                    {/* 値がない場合 */}
                                    {parseFloat(tx.value) === 0 && !tx.tokenInfo && (
                                      <span className='text-gray-500'>-</span>
                                    )}
                                  </div>
                                </td>
                                <td className='py-3 px-4'>
                                  <div className='flex items-center gap-2'>
                                    <ClockIcon className='w-4 h-4 text-gray-500 flex-shrink-0' />
                                    <div className='text-sm'>
                                      <div className='text-gray-300'>{getTimeAgo(tx.timestamp)}</div>
                                      <div className='text-gray-500 text-xs'>{formatTimestamp(tx.timestamp)}</div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className='mt-4 text-center'>
                        <Link
                          href={`/address/${resolvedParams.address}/transactions`}
                          className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                        >
                          View all {regularCount} transactions →
                        </Link>
            </div>
                    </>
                  )}
                </>
          ) : (
            <>
              {miningRewards.length === 0 ? (
                <>
                  <p className='text-gray-400'>No mining rewards for this address.</p>
                  <div className='mt-4 text-center'>
                    <Link
                      href={`/address/${resolvedParams.address}/mining`}
                      className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                    >
                      View all {miningCount} mining rewards →
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className='overflow-x-auto'>
                    <table className='w-full'>
                      <thead>
                        <tr className='border-b border-gray-600'>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Transaction Hash</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>From</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>To</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Value</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Status</th>
                          <th className='text-left py-3 px-4 text-sm font-medium text-gray-400'>Age</th>
                        </tr>
                      </thead>
                      <tbody className='divide-y divide-gray-600'>
                        {miningRewards.slice(0, 10).map((tx) => (
                          <tr key={tx.hash} className='hover:bg-gray-700/50 transition-colors'>
                            <td className='py-3 px-4'>
                              <Link
                                href={`/tx/${tx.hash}`}
                                className='text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors'
                                title={tx.hash}
                              >
                                {formatAddress(tx.hash)}
                              </Link>
                            </td>
                            <td className='py-3 px-4'>
                              <span className='text-gray-400 font-mono text-sm'>System</span>
                            </td>
                            <td className='py-3 px-4'>
                              <Link
                                href={`/address/${tx.to}`}
                                className='text-red-400 hover:text-red-300 font-mono text-sm transition-colors'
                                title={tx.to}
                              >
                                {formatAddress(tx.to)}
                              </Link>
                            </td>
                            <td className='py-3 px-4'>
                              <span className='text-yellow-400'>{formatValue(tx.value)}</span>
                            </td>
                            <td className='py-3 px-4'>
                              <span className='text-green-400'>Success</span>
                            </td>
                            <td className='py-3 px-4'>
                              <div className='flex items-center gap-2'>
                                <ClockIcon className='w-4 h-4 text-gray-500 flex-shrink-0' />
                                <div className='text-sm'>
                                  <div className='text-gray-300'>{getTimeAgo(tx.timestamp)}</div>
                                  <div className='text-gray-500 text-xs'>{formatTimestamp(tx.timestamp)}</div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className='mt-4 text-center'>
                    <Link
                      href={`/address/${resolvedParams.address}/mining`}
                      className='text-blue-400 hover:text-blue-300 text-sm transition-colors'
                    >
                      View all {miningCount} mining rewards →
                    </Link>
                  </div>
                </>
              )}
            </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 