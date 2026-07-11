'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { ShieldCheckIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { formatUnitsExact } from '@/lib/utils/csv';

interface ApprovalEntry {
  token: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  spender: string;
  spenderTag: string | null;
  allowance: string;
  isUnlimited: boolean;
  lastUpdatedBlock: number;
}

interface ApprovalsResponse {
  approvals: ApprovalEntry[];
  scannedEvents: number;
  address: string;
  error?: string;
}

const shorten = (addr: string) => `${addr.slice(0, 10)}...${addr.slice(-8)}`;

export function ApprovalsClient() {
  const searchParams = useSearchParams();
  const { address: connectedAddress, isConnected } = useAccount();

  const [inputValue, setInputValue] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [data, setData] = useState<ApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);

  const { writeContract, data: revokeTxHash, reset: resetRevoke } = useWriteContract();
  const { isSuccess: isRevokeConfirmed } = useWaitForTransactionReceipt({ hash: revokeTxHash });

  const fetchApprovals = useCallback(async (addr: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/address/${addr}/approvals${refresh ? '?refresh=1' : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load approvals');
      setData(json);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial address: ?address= query, else the connected wallet
  useEffect(() => {
    const fromQuery = searchParams.get('address');
    const initial = fromQuery || connectedAddress;
    if (initial && /^0x[0-9a-fA-F]{40}$/.test(initial) && !owner) {
      setInputValue(initial);
      setOwner(initial.toLowerCase());
      fetchApprovals(initial.toLowerCase());
    }
  }, [searchParams, connectedAddress, owner, fetchApprovals]);

  // After a revoke confirms, rescan with the server cache bypassed
  useEffect(() => {
    if (isRevokeConfirmed && owner) {
      setRevokingKey(null);
      resetRevoke();
      fetchApprovals(owner, true);
    }
  }, [isRevokeConfirmed, owner, fetchApprovals, resetRevoke]);

  const handleCheck = () => {
    const addr = inputValue.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setError('Invalid address format');
      return;
    }
    setOwner(addr.toLowerCase());
    fetchApprovals(addr.toLowerCase());
  };

  const canRevoke = isConnected && owner && connectedAddress?.toLowerCase() === owner;

  const handleRevoke = (approval: ApprovalEntry) => {
    if (!canRevoke) return;
    setRevokingKey(`${approval.token}:${approval.spender}`);
    writeContract(
      {
        address: approval.token as Address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [approval.spender as Address, 0n],
      },
      { onError: () => setRevokingKey(null) }
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheckIcon className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-gray-100">Token Approvals</h1>
          </div>
          <p className="text-gray-400">
            Review the ERC-20 allowances an address has granted, and revoke the ones you no longer
            need. Connect the wallet that owns the address to enable revoking.
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Address input */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="0x… address to check"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              className="flex-1 px-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={handleCheck}
              disabled={loading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
            >
              {loading ? 'Scanning…' : 'Check Approvals'}
            </button>
          </div>
          {connectedAddress && inputValue.toLowerCase() !== connectedAddress.toLowerCase() && (
            <button
              onClick={() => {
                setInputValue(connectedAddress);
                setOwner(connectedAddress.toLowerCase());
                fetchApprovals(connectedAddress.toLowerCase());
              }}
              className="mt-2 text-xs text-emerald-400 hover:underline"
            >
              Use connected wallet ({shorten(connectedAddress)})
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-3 py-16 text-gray-400">
            <ArrowPathIcon className="w-6 h-6 animate-spin" />
            Scanning approval events… (first scan for an address can take a while)
          </div>
        )}

        {!loading && data && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-400">
                {data.approvals.length} active approval{data.approvals.length !== 1 ? 's' : ''} for{' '}
                <span className="font-mono">{shorten(data.address)}</span>
              </span>
              <button
                onClick={() => owner && fetchApprovals(owner, true)}
                className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
                title="Rescan (bypasses the 10 min cache)"
              >
                <ArrowPathIcon className="w-4 h-4" /> Refresh
              </button>
            </div>

            {data.approvals.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                No active token approvals found. 🎉
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700 text-sm text-gray-400">
                      <th className="text-left py-3 px-4 font-medium">Token</th>
                      <th className="text-left py-3 px-4 font-medium">Approved Spender</th>
                      <th className="text-left py-3 px-4 font-medium">Allowance</th>
                      <th className="text-right py-3 px-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {data.approvals.map((approval) => {
                      const key = `${approval.token}:${approval.spender}`;
                      const isRevoking = revokingKey === key;
                      return (
                        <tr key={key} className="hover:bg-gray-700/30 transition-colors">
                          <td className="py-3 px-4">
                            <Link
                              href={`/token/${approval.token}`}
                              className="text-blue-400 hover:underline"
                            >
                              {approval.tokenName}{' '}
                              <span className="text-gray-400">({approval.tokenSymbol})</span>
                            </Link>
                          </td>
                          <td className="py-3 px-4">
                            <Link
                              href={`/address/${approval.spender}`}
                              className="text-blue-400 hover:underline font-mono text-sm"
                            >
                              {shorten(approval.spender)}
                            </Link>
                            {approval.spenderTag && (
                              <span className="ml-2 px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs font-semibold rounded">
                                {approval.spenderTag}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {approval.isUnlimited ? (
                              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-semibold rounded-lg">
                                Unlimited
                              </span>
                            ) : (
                              <span className="text-gray-200 font-mono text-sm">
                                {Number(
                                  formatUnitsExact(approval.allowance, approval.decimals)
                                ).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleRevoke(approval)}
                              disabled={!canRevoke || isRevoking}
                              title={
                                canRevoke
                                  ? 'Set allowance to 0'
                                  : 'Connect the owner wallet to revoke'
                              }
                              className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              {isRevoking ? 'Revoking…' : 'Revoke'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
