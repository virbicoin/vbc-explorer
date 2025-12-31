'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { UserIcon, ClockIcon, ArrowUpIcon, CubeIcon } from '@heroicons/react/24/outline';

interface Config {
  miners: Record<string, string>;
  explorer: {
    name: string;
    description: string;
    version: string;
    url: string;
  };
}

interface AccountData {
  account: {
    address: string;
    balance: string;
    balanceRaw: string;
    percentage: string;
    rank: number | null;
    transactionCount: number;
    blocksMined: number;
    firstSeen: string;
    lastActivity: string;
  };
  contract?: {
    address: string;
    name: string;
    symbol: string;
    type: string;
    decimals: number;
    totalSupply: string;
    verified: boolean;
    creationTransaction: string;
    blockNumber: number;
  };
  transactions: Array<{
    hash: string;
    from: string;
    to: string;
    value: string;
    timestamp: number;
    blockNumber: number;
    gasUsed?: number;
    status?: number;
  }>;
}

interface AccountDetailsProps {
  address: string;
}

export default function AccountDetails({ address }: AccountDetailsProps) {
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);

  // プール名を取得する関数
  const getPoolName = (address: string) => {
    if (!address || !config?.miners) return null;

    const minerKey = Object.keys(config.miners).find(
      (key) => key.toLowerCase() === address.toLowerCase()
    );

    return minerKey ? config.miners[minerKey] : null;
  };

  useEffect(() => {
    // 設定を取得
    const fetchConfig = async () => {
      try {
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
    async function fetchAccountData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/address/${address}`);

        if (!response.ok) {
          throw new Error('Failed to fetch account data');
        }

        const data = await response.json();
        setAccountData(data);
      } catch (err) {
        console.error('Error fetching account data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchAccountData();
  }, [address]);

  const copyAddressToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const formatValue = (value: string) => {
    try {
      const numValue = parseFloat(value);
      if (numValue === 0) return '0 VBC';
      if (numValue < 0.000001) return '<0.000001 VBC';
      if (numValue < 1) return `${numValue.toFixed(6)} VBC`;
      if (numValue < 1000) return `${numValue.toFixed(4)} VBC`;
      return `${numValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} VBC`;
    } catch {
      return `${value} VBC`;
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const getTimeAgo = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-400">Loading account details...</p>
      </div>
    );
  }

  if (error || !accountData) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
        <p className="text-red-400 mb-4">{error || 'Account not found'}</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
        >
          <ArrowUpIcon className="w-4 h-4" />
          Back to Explorer
        </Link>
      </div>
    );
  }

  const { account, contract, transactions } = accountData;
  const poolName = getPoolName(account.address);

  return (
    <div className="space-y-8">
      {/* Account Overview */}
      <section className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <UserIcon className="w-6 h-6 text-blue-400" />
            Account Information
          </h2>
          <button
            onClick={copyAddressToClipboard}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              copiedAddress
                ? 'bg-green-600 text-white'
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
          >
            {copiedAddress ? 'Copied!' : 'Copy Address'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <p className="text-sm text-gray-400">Address</p>
            <p className="font-mono text-sm text-blue-400 break-all">{account.address}</p>
            {poolName && <p className="text-xs text-green-400">Pool: {poolName}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">Balance</p>
            <p className="text-lg font-mono text-green-400">{formatValue(account.balance)}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">Percent</p>
            <p className="text-lg font-mono text-yellow-400">{account.percentage}%</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">Transaction Count</p>
            <p className="text-lg font-mono text-orange-400">
              {account.transactionCount.toLocaleString()}
            </p>
          </div>

          {account.rank && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">Rank</p>
              <p className="text-lg font-mono text-purple-400">#{account.rank.toLocaleString()}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-gray-400">Blocks Mined</p>
            <p className="text-lg font-mono text-green-400">
              {account.blocksMined.toLocaleString()}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">First Seen</p>
            <div className="flex items-center gap-2">
              <ClockIcon className="w-4 h-4 text-gray-400" />
              <div>
                <div className="text-sm text-gray-300">{getTimeAgo(account.firstSeen)}</div>
                <div className="text-xs text-gray-500">
                  {new Date(account.firstSeen).toLocaleString(undefined, { timeZoneName: 'short' })}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">Last Activity</p>
            <div className="flex items-center gap-2">
              <ClockIcon className="w-4 h-4 text-gray-400" />
              <div>
                <div className="text-sm text-gray-300">{getTimeAgo(account.lastActivity)}</div>
                <div className="text-xs text-gray-500">
                  {new Date(account.lastActivity).toLocaleString(undefined, {
                    timeZoneName: 'short',
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contract Information */}
      {contract && (
        <section className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-xl font-bold text-gray-100 mb-6 flex items-center gap-2">
            <CubeIcon className="w-6 h-6 text-green-400" />
            Contract Information
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <p className="text-sm text-gray-400">Contract Address</p>
              <p className="font-mono text-sm text-blue-400 break-all">{contract.address}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-400">Name</p>
              <p className="text-lg font-mono text-green-400">{contract.name}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-400">Symbol</p>
              <p className="text-lg font-mono text-orange-400">{contract.symbol}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-400">Type</p>
              <p className="text-sm text-gray-300">{contract.type}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-400">Decimals</p>
              <p className="text-lg font-mono text-purple-400">{contract.decimals}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-400">Total Supply</p>
              <p className="text-lg font-mono text-green-400">{contract.totalSupply}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-400">Verified</p>
              <span
                className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                  contract.verified
                    ? 'bg-green-600/20 text-green-400 border border-green-600/50'
                    : 'bg-red-600/20 text-red-400 border border-red-600/50'
                }`}
              >
                {contract.verified ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Transactions */}
      <section className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 className="text-xl font-bold text-gray-100 mb-6">
          Recent Transactions ({transactions.length})
        </h2>

        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400">No transactions found for this account.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx, index) => (
              <div
                key={tx.hash || index}
                className="flex justify-between items-center p-3 bg-gray-700/50 rounded border border-gray-600/50 hover:bg-gray-700 transition-colors"
              >
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/tx/${tx.hash}`}
                    className="text-blue-400 hover:text-blue-300 font-mono text-sm transition-colors break-all"
                    title={tx.hash}
                  >
                    {tx.hash.slice(0, 16)}...{tx.hash.slice(-16)}
                  </Link>
                  <div className="text-xs text-gray-400">
                    From: {tx.from ? formatAddress(tx.from) : 'Unknown'} → To:{' '}
                    {tx.to ? formatAddress(tx.to) : 'Unknown'}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-green-400 font-bold">
                    {tx.value ? formatValue(tx.value) : '0 VBC'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
