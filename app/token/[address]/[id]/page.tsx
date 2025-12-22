"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ClipboardDocumentIcon, CubeIcon, UsersIcon, ClockIcon, CodeBracketIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  tokenURI?: string;
  createdAt?: string;
  symbol?: string;
  type?: string;
  totalSupply?: string;
  floorPrice?: string;
  volume24h?: string;
  collection?: string; // Added for collection name
  verified?: boolean;
}

// TokenData interface removed (unused)

interface BlockInfo {
  number: number;
  hash: string;
  timestamp?: string;
  miner?: string;
  size?: number;
  difficulty?: number;
}

interface ContractInfo {
  verified: boolean;
  compiler: string | null;
  language: string | null;
  name: string;
  sourceCode: string | null;
  bytecode: string | null;
}

interface TokenTransfer {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: string;
  tokenId?: string;
  blockNumber?: string; // Added for block number
  status?: number | string | boolean;
  gasUsed?: string | number;
  blockHash?: string;
  contractAddress?: string;
  input?: string;
  logs?: unknown[];
  block?: BlockInfo;
}
interface TokenDetail {
  metadata: TokenMetadata;
  owner?: string;
  creator?: string;
  createdAt?: string;
  transfers?: TokenTransfer[];
  address?: string;
  contract?: ContractInfo;
}

export default function TokenIdDetailPage() {
  const params = useParams();
  const address = params?.address as string;
  const id = params?.id as string;
  // metadata and tokenData state removed (unused)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 1. API取得時にmetadataだけでなく全体をtokenDetailとして保持
  const [tokenDetail, setTokenDetail] = useState<TokenDetail | null>(null);

  // Add NFT to MetaMask
  const addNFTToMetaMask = async () => {
    // Wait for ethereum to be injected
    let ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown }) => Promise<boolean> } }).ethereum;
    if (!ethereum) {
      await new Promise(resolve => setTimeout(resolve, 100));
      ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown }) => Promise<boolean> } }).ethereum;
    }
    
    if (!ethereum) {
      const confirmed = confirm('No Web3 wallet detected. Would you like to install MetaMask?');
      if (confirmed) {
        window.open('https://metamask.io/download/', '_blank');
      }
      return;
    }
    
    try {
      await ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC721',
          options: {
            address: address,
            tokenId: id,
          },
        },
      });
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error.code !== 4001) {
        console.error('Failed to add NFT to MetaMask:', err);
        alert('Failed to add NFT to MetaMask. Your wallet may not support this feature.');
      }
    }
  };

  useEffect(() => {
    if (!address || !id) return;
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/tokens/${address}?tokenId=${id}`);
        const data = await res.json();
        if (!cancelled) {
          setTokenDetail(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to fetch data");
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [address, id]);

  if (loading) {
    return <div className="min-h-screen bg-gray-900 text-white"><div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div></div></div>;
  }
  if (error) {
    return <div className="min-h-screen bg-gray-900 text-white"><div className="container mx-auto px-4 py-8"><div className="bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded mb-4"><strong className="font-bold">Error:</strong><span className="block sm:inline"> {error}</span></div><Link href='/' className='inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors'><CubeIcon className='w-4 h-4' />Back to Explorer</Link></div></div>;
  }
  if (!tokenDetail) {
    return <div className="min-h-screen bg-gray-900 text-white"><div className="container mx-auto px-4 py-8"><div className="bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded mb-4">Error: No metadata found</div></div></div>;
  }

  // owner calculation removed (unused)

  // summaryStats constant removed (unused)

  // Transfer履歴をtokenId降順でソート
  const sortedTransfers = tokenDetail?.transfers ? [...tokenDetail.transfers].sort((a, b) => Number(b.tokenId) - Number(a.tokenId)) : [];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <CubeIcon className="w-8 h-8 text-green-400" />
              <h1 className="text-3xl font-bold text-gray-100">NFT Token Details</h1>
            </div>
            <button
              onClick={addNFTToMetaMask}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg transition-colors text-sm font-medium"
              title="Add NFT to MetaMask"
            >
              🦊 Add to MetaMask
            </button>
          </div>
          <p className="text-gray-400">Token ID: <span className="text-white font-mono">{id}</span> details</p>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">
        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50 flex flex-col items-start">
            <div className="flex items-center gap-2 mb-2"><CubeIcon className='w-5 h-5 text-green-400' /><span className='font-semibold text-green-400'>Token ID</span></div>
            <span className="text-green-400 text-3xl font-bold break-all">#{id}</span>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50 flex flex-col items-start">
            <div className="flex items-center gap-2 mb-2"><UsersIcon className='w-5 h-5 text-blue-400' /><span className='font-semibold text-blue-400'>Holder</span></div>
            {tokenDetail?.owner ? <Link href={`/address/${tokenDetail.owner}`} className="text-blue-400 hover:underline font-mono break-all">{tokenDetail.owner}</Link> : <span className="text-white font-mono break-all">-</span>}
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50 flex flex-col items-start">
            <div className="flex items-center gap-2 mb-2"><CubeIcon className='w-5 h-5 text-orange-400' /><span className='font-semibold text-orange-400'>Collection</span></div>
            {tokenDetail?.metadata?.collection || tokenDetail?.metadata?.name ? <span className="text-orange-400 font-mono">{tokenDetail?.metadata?.collection || tokenDetail?.metadata?.name}</span> : <span className="text-white font-mono break-all">-</span>}
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50 flex flex-col items-start">
            <div className="flex items-center gap-2 mb-2"><ClockIcon className='w-5 h-5 text-yellow-400' /><span className='font-semibold text-yellow-400'>Created</span></div>
            {tokenDetail?.createdAt ? <span className="text-yellow-400 font-mono">{new Date(tokenDetail.createdAt).toLocaleString(undefined, { timeZoneName: 'short' })}</span> : <span className="text-white font-mono break-all">-</span>}
          </div>
        </div>
        {/* Image and metadata */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8 flex flex-col md:flex-row gap-8">
          {/* 画像 */}
          {tokenDetail?.metadata?.image ? (
            <div className="w-48 h-48 relative bg-gray-900 rounded-lg overflow-hidden flex-shrink-0">
              <Image
                src={tokenDetail.metadata.image}
                alt={tokenDetail.metadata.name || `Token #${id}`}
                width={160}
                height={160}
                style={{ objectFit: "cover", width: '100%', height: '100%' }}
                className="w-48 h-48 object-cover rounded-lg"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-48 h-48 flex items-center justify-center bg-gray-900 text-gray-500 rounded-lg flex-shrink-0">No image</div>
          )}
          <div className="flex-1 flex flex-col gap-4">
            {/* name/description */}
            <div>
              <h2 className="text-3xl font-bold text-green-400 mb-2">{tokenDetail?.metadata?.name || `Token #${id}`}</h2>
              <p className="text-gray-300 mb-4">{tokenDetail?.metadata?.description || '-'}</p>
              {/* 追加情報 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                <div className="text-sm text-gray-400 flex items-center gap-2">
                  <span className="font-bold">Token Type:</span>
                  {tokenDetail?.metadata?.type ? (
                    <span className="px-3 py-1 rounded text-sm font-medium bg-purple-500/20 text-purple-400">{tokenDetail.metadata.type}</span>
                  ) : (
                    <span className="text-white">-</span>
                  )}
                </div>
                <div className="text-sm text-gray-400 flex items-center gap-2">
                  <span className="font-bold">Symbol:</span> <span className="text-white">{tokenDetail?.metadata?.symbol || '-'}</span>
                </div>
                <div className="text-sm text-gray-400 flex items-center gap-2">
                  <span className="font-bold">Total Supply:</span> <span className="text-yellow-400 font-bold">{tokenDetail?.metadata?.totalSupply || '-'}</span>
                </div>
                <div className="text-sm text-gray-400 flex items-center gap-2">
                  <span className="font-bold">Contract Verified:</span> <span className={tokenDetail?.metadata?.verified ? 'text-green-400' : 'text-red-400'}>{tokenDetail?.metadata?.verified ? 'Yes' : 'No'}</span>
                </div>
              </div>
              {tokenDetail?.metadata?.tokenURI && (
                <div className="text-sm text-gray-400 mb-2">
                  tokenURI: <a href={tokenDetail.metadata.tokenURI} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline break-all">{tokenDetail.metadata.tokenURI}</a>
                </div>
              )}
              {tokenDetail?.metadata?.attributes && tokenDetail.metadata.attributes.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs text-gray-500 font-medium mb-1">Attributes:</div>
                  <div className="flex flex-wrap gap-2">
                    {tokenDetail.metadata.attributes.map((attr, idx) => (
                      <span key={idx} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">{attr.trait_type}: {attr.value}</span>
                    ))}
                  </div>
                </div>
              )}
              {Object.entries(tokenDetail.metadata ?? {}).map(([key, value]) => (
                !['name','description','image','createdAt','attributes','tokenURI','collection','type','symbol','totalSupply','contractAddress'].includes(key) && value ? (
                  <div key={key} className="text-sm text-gray-400"><span className="font-bold">{key}:</span> <span className="text-white break-all">{String(value)}</span></div>
                ) : null
              ))}
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <div className="text-sm text-gray-400">
                Contract: <Link href={`/address/${tokenDetail?.address}`} className="text-blue-400 hover:underline font-mono">{tokenDetail?.address}</Link>
                <button
                  onClick={() => {navigator.clipboard.writeText(tokenDetail?.address || ''); setCopied(true); setTimeout(()=>setCopied(false), 1500);}}
                  className="ml-2 p-1 text-gray-400 hover:text-blue-400 transition-colors"
                  title="Copy address"
                >
                  <ClipboardDocumentIcon className="w-4 h-4 inline" />
                </button>
                {copied && <span className="text-green-400 text-xs ml-2">Copied!</span>}
              </div>
              {tokenDetail?.creator && (
                <div className="text-sm text-gray-400">Creator: <Link href={`/address/${tokenDetail.creator}`} className="text-blue-400 hover:underline font-mono">{tokenDetail.creator}</Link></div>
              )}
              {tokenDetail?.owner && (
                <div className="text-sm text-gray-400">Holder: <Link href={`/address/${tokenDetail.owner}`} className="text-blue-400 hover:underline font-mono">{tokenDetail.owner}</Link></div>
              )}
              {tokenDetail?.createdAt && (
                <div className="text-sm text-gray-400">Created: {new Date(tokenDetail.createdAt).toLocaleString(undefined, { timeZoneName: 'short' })}</div>
              )}
            </div>
          </div>
        </div>
        {/* Transfer history */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">Transfer History</h2>
          {sortedTransfers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-600">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Tx Hash</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Block</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">From</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">To</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Value</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Gas Used</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Block Hash</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Contract</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Input</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Logs</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {sortedTransfers.map((tx: TokenTransfer, idx: number) => (
                    <tr key={tx.hash + idx} className="hover:bg-gray-700/50 transition-colors">
                      <td className="py-3 px-4">
                        <Link href={`/tx/${tx.hash}`} className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors" title={tx.hash}>{tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}</Link>
                      </td>
                      <td className="py-3 px-4">
                        {tx.blockNumber ? (
                          <Link href={`/block/${tx.blockNumber}`} className="text-green-400 hover:text-green-300 font-mono text-sm transition-colors" title={tx.blockNumber}>{tx.blockNumber}</Link>
                        ) : '-' }
                      </td>
                      <td className="py-3 px-4">
                        {tx.status !== undefined ? (
                          <span className={tx.status === 1 || tx.status === '1' || tx.status === true || tx.status === 'success' ? 'text-green-400' : 'text-red-400'}>
                            {tx.status === 1 || tx.status === '1' || tx.status === true || tx.status === 'success' ? 'Success' : 'Failed'}
                          </span>
                        ) : '-' }
                      </td>
                      <td className="py-3 px-4">
                        <Link href={`/address/${tx.from}`} className="text-purple-400 hover:text-purple-300 font-mono text-sm transition-colors" title={tx.from}>{tx.from.slice(0, 8)}...{tx.from.slice(-6)}</Link>
                      </td>
                      <td className="py-3 px-4">
                        <Link href={`/address/${tx.to}`} className="text-orange-400 hover:text-orange-300 font-mono text-sm transition-colors" title={tx.to}>{tx.to.slice(0, 8)}...{tx.to.slice(-6)}</Link>
                      </td>
                      <td className="py-3 px-4 text-green-400 font-bold">{tx.value}</td>
                      <td className="py-3 px-4">{tx.gasUsed !== undefined ? tx.gasUsed : '-'}</td>
                      <td className="py-3 px-4">
                        {tx.block?.hash ? (
                          <Link href={`/block/${tx.block.number}`} className="text-blue-400 hover:underline font-mono text-xs break-all">
                            {tx.block.hash.slice(0, 10)}...{tx.block.hash.slice(-8)}
                          </Link>
                        ) : '-' }
                      </td>
                      <td className="py-3 px-4">
                        {tx.contractAddress ? (
                          <Link href={`/address/${tx.contractAddress}`} className="text-blue-400 hover:underline font-mono text-xs break-all">{tx.contractAddress}</Link>
                        ) : '-' }
                      </td>
                      <td className="py-3 px-4 text-xs break-all">{tx.input ? tx.input.slice(0, 24) + (tx.input.length > 24 ? '...' : '') : '-'}</td>
                      <td className="py-3 px-4 text-xs break-all">{tx.logs ? (Array.isArray(tx.logs) ? tx.logs.length + ' logs' : '-') : '-'}</td>
                      <td className="py-3 px-4 text-gray-400 text-sm">{tx.timestamp ? new Date(tx.timestamp).toLocaleString(undefined, { timeZoneName: 'short' }) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400">No transfer history for this token.</p>
          )}
        </div>
        {/* Contract information */}
        {tokenDetail?.contract && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2"><CodeBracketIcon className="w-6 h-6 text-blue-400" />Contract Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-gray-400 mb-1">Contract Name</div>
                <div className="text-white font-mono mb-2">{tokenDetail.contract.name}</div>
                <div className="text-sm text-gray-400 mb-1">Compiler</div>
                <div className="text-white font-mono mb-2">{tokenDetail.contract.compiler || '-'}</div>
                <div className="text-sm text-gray-400 mb-1">Language</div>
                <div className="text-white font-mono mb-2">{tokenDetail.contract.language || '-'}</div>
                <div className="text-sm text-gray-400 mb-1">Verified</div>
                {tokenDetail.contract.verified ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-medium w-fit"><CheckCircleIcon className="w-4 h-4" />Verified</span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-500/20 text-gray-400 rounded text-xs font-medium w-fit">Unverified</span>
                )}
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Source Code</div>
                <div className="text-white font-mono mb-2 break-all">{tokenDetail.contract.sourceCode ? <span className="text-green-400">Available</span> : <span className="text-red-400">Not Available</span>}</div>
                <div className="text-sm text-gray-400 mb-1">Bytecode</div>
                <div className="text-white font-mono mb-2 break-all">{tokenDetail.contract.bytecode ? <span className="text-green-400">Available</span> : <span className="text-red-400">Not Available</span>}</div>
                <div className="text-sm text-gray-400 mb-1">Contract Address</div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-white font-mono">{address}</span>
                  <button onClick={() => {navigator.clipboard.writeText(address); setCopied(true); setTimeout(()=>setCopied(false), 1500);}} className="p-1 text-gray-400 hover:text-blue-400 transition-colors" title="Copy address"><ClipboardDocumentIcon className="w-4 h-4 inline" /></button>
                  {copied && <span className="text-green-400 text-xs ml-2">Copied!</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
} 