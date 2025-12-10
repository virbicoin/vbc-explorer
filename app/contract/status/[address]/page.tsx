'use client';

import { useState, useEffect } from 'react';
import { CheckCircleIcon, XCircleIcon, CodeBracketIcon, ClockIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

interface ContractStatus {
  verified: boolean;
  contractName?: string;
  compilerVersion?: string;
  optimization?: boolean;
  verifiedAt?: string;
  hasSourceCode: boolean;
  hasABI: boolean;
  address: string;
  message: string;
}

export default function ContractStatusPage({ params }: { params: Promise<{ address: string }> }) {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<ContractStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function getAddress() {
      const resolvedParams = await params;
      setAddress(resolvedParams.address);
      await fetchStatus(resolvedParams.address);
    }
    getAddress();
  }, [params]);

  const fetchStatus = async (contractAddress: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/contract/status/${contractAddress}`);
      const data = await response.json();
      
      if (response.ok) {
        setStatus(data);
      } else {
        setError(data.error || 'Failed to fetch contract status');
      }
    } catch {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = () => {
    if (address) {
      fetchStatus(address);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Checking contract verification status...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-red-900/20 border border-red-600 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <XCircleIcon className="w-6 h-6 text-red-400" />
              <h1 className="text-xl font-semibold text-red-400">Error</h1>
            </div>
            <p className="text-red-300 mb-4">{error}</p>
            <button
              onClick={refreshStatus}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* トップの帯は全幅 */}
      <div className="bg-gray-800 border-b border-gray-700 w-full">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <CodeBracketIcon className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold text-gray-100">Contract Verification Status</h1>
          </div>
          <p className="text-gray-400">Verification status for contract {address}</p>
        </div>
      </div>
      {/* カード部分は中央寄せ */}
      <main className="container mx-auto px-4 py-8">
        <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-xl">
          <div className="p-8 space-y-8">
            {/* Status Overview */}
            <div className={`p-6 rounded-lg border shadow-lg ${
              status?.verified 
                ? 'bg-green-900/20 border-green-600 text-green-400' 
                : 'bg-red-900/20 border-red-600 text-red-400'
            }`}>
              <div className="flex items-center gap-3 mb-2">
                {status?.verified ? (
                  <CheckCircleIcon className="w-6 h-6 text-green-400" />
                ) : (
                  <XCircleIcon className="w-6 h-6 text-red-400" />
                )}
                <span className="text-lg font-semibold">
                  {status?.verified ? 'Contract Verified' : 'Contract Not Verified'}
                </span>
              </div>
              <p className="text-base">{status?.message}</p>
            </div>
            {/* Contract Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-gray-700/50 rounded-lg p-6 border border-gray-600/50">
                <h3 className="text-lg font-semibold text-gray-100 mb-4">Contract Information</h3>
                <div className="space-y-3">
                  <div>
                    <span className="text-gray-400 text-sm">Address:</span>
                    <div className="font-mono text-blue-400 break-all">{status?.address}</div>
                  </div>
                  {status?.contractName && (
                    <div>
                      <span className="text-gray-400 text-sm">Contract Name:</span>
                      <div className="text-gray-200">{status.contractName}</div>
                    </div>
                  )}
                  {status?.compilerVersion && (
                    <div>
                      <span className="text-gray-400 text-sm">Compiler Version:</span>
                      <div className="text-gray-200">{status.compilerVersion}</div>
                    </div>
                  )}
                  {status?.optimization !== undefined && (
                    <div>
                      <span className="text-gray-400 text-sm">Optimization:</span>
                      <div className="text-gray-200">{status.optimization ? 'Enabled' : 'Disabled'}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-6 border border-gray-600/50">
                <h3 className="text-lg font-semibold text-gray-100 mb-4">Verification Details</h3>
                <div className="space-y-3">
                  <div>
                    <span className="text-gray-400 text-sm">Verification Status:</span>
                    <div className={`font-medium ${status?.verified ? 'text-green-400' : 'text-red-400'}`}>{status?.verified ? 'Verified' : 'Not Verified'}</div>
                  </div>
                  {status?.verifiedAt && (
                    <div>
                      <span className="text-gray-400 text-sm">Verified At:</span>
                      <div className="text-gray-200 flex items-center gap-2">
                        <ClockIcon className="w-4 h-4" />
                        {new Date(status.verifiedAt).toLocaleString()}
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-400 text-sm">Source Code:</span>
                    <div className={`font-medium ${status?.hasSourceCode ? 'text-green-400' : 'text-red-400'}`}>{status?.hasSourceCode ? 'Available' : 'Not Available'}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-sm">ABI:</span>
                    <div className={`font-medium ${status?.hasABI ? 'text-green-400' : 'text-red-400'}`}>{status?.hasABI ? 'Available' : 'Not Available'}</div>
                  </div>
                </div>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href={`/contract/verify?address=${address}&contractName=${status?.contractName || 'Contract'}`}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-base font-bold shadow"
              >
                <CodeBracketIcon className="w-5 h-5" />
                {status?.verified ? 'Re-verify Contract' : 'Verify Contract'}
              </Link>
              <Link
                href={`/contract/interact?address=${address}`}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors text-base font-bold shadow"
              >
                <CodeBracketIcon className="w-5 h-5" />
                Interact with Contract
              </Link>
              <button
                onClick={refreshStatus}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors text-base font-bold shadow"
              >
                <ClockIcon className="w-5 h-5" />
                Refresh Status
              </button>
            </div>
            {/* Additional Links */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link
                href={`/address/${address}`}
                className="p-4 bg-gray-700/50 rounded-lg border border-gray-600 hover:border-gray-500 transition-colors text-center"
              >
                <div className="text-gray-400 text-sm mb-1">View Address</div>
                <div className="text-gray-200 font-medium">Address Details</div>
              </Link>
              <Link
                href={`/nft/${address}`}
                className="p-4 bg-gray-700/50 rounded-lg border border-gray-600 hover:border-gray-500 transition-colors text-center"
              >
                <div className="text-gray-400 text-sm mb-1">View NFT</div>
                <div className="text-gray-200 font-medium">NFT Details</div>
              </Link>
              <Link
                href={`/tx?address=${address}`}
                className="p-4 bg-gray-700/50 rounded-lg border border-gray-600 hover:border-gray-500 transition-colors text-center"
              >
                <div className="text-gray-400 text-sm mb-1">View Transactions</div>
                <div className="text-gray-200 font-medium">Transaction History</div>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 