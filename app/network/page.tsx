'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  GlobeAltIcon,
  ServerIcon,
  CubeIcon,
  ClockIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  SignalIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';

interface NetworkStats {
  latestBlock: number;
  avgBlockTime: string;
  networkHashrate: string;
  networkDifficulty: string;
  isConnected: boolean;
  totalTransactions: number;
  avgGasPrice?: string;
  activeMiners?: number;
  totalSupply?: string;
  chainId?: number;
  networkName?: string;
  rpcUrl?: string;
}

interface NodeInfo {
  name: string;
  url: string;
  status: 'online' | 'offline' | 'syncing';
  latency: number;
  blockHeight: number;
  version: string;
  networkId?: number;
  chainId?: number;
  peerCount?: number;
  isSyncing?: boolean;
}

export default function NetworkPage() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);

  useEffect(() => {
    const fetchNetworkStats = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch stats
        const response = await fetch('/api/stats?enhanced=true');
        if (!response.ok) {
          throw new Error('Failed to fetch network stats');
        }
        const data = await response.json();
        setStats(data);
        setLastUpdate(new Date());

        // Fetch config first to get network info
        const configResponse = await fetch('/api/config/client');
        let networkConfig = {
          chainId: 0,
          networkName: '',
          rpcUrl: '',
        };

        if (configResponse.ok) {
          const configData = await configResponse.json();
          networkConfig = {
            chainId: configData.network?.chainId || 0,
            networkName: configData.network?.name || configData.currency?.name || '',
            rpcUrl: configData.network?.rpcUrl || '',
          };
        }

        // Fetch node info from API
        const nodeResponse = await fetch('/api/network/node');
        if (nodeResponse.ok) {
          const nodeData = await nodeResponse.json();
          setNodes([nodeData]);

          // Update stats with node info (prefer config values for display)
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  chainId: networkConfig.chainId,
                  networkName: networkConfig.networkName,
                  rpcUrl: networkConfig.rpcUrl || nodeData.url,
                }
              : null
          );
        } else {
          // Fallback when node API fails
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  chainId: networkConfig.chainId,
                  networkName: networkConfig.networkName,
                  rpcUrl: networkConfig.rpcUrl,
                }
              : null
          );
          setNodes([
            {
              name: 'Primary RPC',
              url: networkConfig.rpcUrl,
              status: 'offline',
              latency: 0,
              blockHeight: 0,
              version: 'Unknown',
            },
          ]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch network stats');
      } finally {
        setLoading(false);
      }
    };

    fetchNetworkStats();
    const interval = setInterval(fetchNetworkStats, 15000); // Update every 15 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'text-green-400';
      case 'offline':
        return 'text-red-400';
      case 'syncing':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <CheckCircleIcon className="w-5 h-5 text-green-400" />;
      case 'offline':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />;
      case 'syncing':
        return <ArrowPathIcon className="w-5 h-5 text-yellow-400 animate-spin" />;
      default:
        return <SignalIcon className="w-5 h-5 text-gray-400" />;
    }
  };

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <ArrowPathIcon className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <GlobeAltIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl font-bold text-gray-100">Network Status</h1>
          </div>
          <p className="text-gray-400">Real-time network health and node status information.</p>
          {lastUpdate && (
            <p className="text-gray-500 text-sm mt-2">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Network Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <CheckCircleIcon className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Network Status</div>
                <div className="text-xl font-bold text-green-400">
                  {stats?.isConnected ? 'Online' : 'Offline'}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <CubeIcon className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Latest Block</div>
                <div className="text-xl font-bold text-blue-400">
                  #{stats?.latestBlock?.toLocaleString() || 'N/A'}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <ClockIcon className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Avg Block Time</div>
                <div className="text-xl font-bold text-yellow-400">
                  {stats?.avgBlockTime || 'N/A'}s
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <CpuChipIcon className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <div className="text-gray-400 text-sm">Active Miners</div>
                <div className="text-xl font-bold text-purple-400">
                  {stats?.activeMiners || 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Network Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Chain Info */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <ServerIcon className="w-6 h-6 text-blue-400" />
              Chain Information
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">Network Name</span>
                <span className="text-white font-medium">{stats?.networkName || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">Chain ID</span>
                <span className="text-white font-medium">{stats?.chainId || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">RPC URL</span>
                <span className="text-blue-400 font-mono text-sm">{stats?.rpcUrl || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">Total Transactions</span>
                <span className="text-white font-medium">
                  {stats?.totalTransactions?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-400">Total Supply</span>
                <span className="text-white font-medium">Unlimited (∞)</span>
              </div>
            </div>
          </div>

          {/* Mining Stats */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <ChartBarIcon className="w-6 h-6 text-orange-400" />
              Mining Statistics
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">Network Hashrate</span>
                <span className="text-white font-medium">{stats?.networkHashrate || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">Network Difficulty</span>
                <span className="text-white font-medium">{stats?.networkDifficulty || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-700">
                <span className="text-gray-400">Average Gas Price</span>
                <span className="text-white font-medium">{stats?.avgGasPrice || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-400">Active Miners (24h)</span>
                <span className="text-white font-medium">{stats?.activeMiners || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Node Status */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <SignalIcon className="w-6 h-6 text-green-400" />
            Node Status
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Node</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">URL</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Latency</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                    Block Height
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {nodes.map((node, index) => (
                  <tr key={index} className="hover:bg-gray-700/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="text-white font-medium">{node.name}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-blue-400 font-mono text-sm">{node.url}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(node.status)}
                        <span className={`capitalize ${getStatusColor(node.status)}`}>
                          {node.status}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-300">
                        {node.latency ? `${node.latency}ms` : '-'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-300">
                        {node.blockHeight?.toLocaleString() || '-'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-400 text-sm">{node.version || '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/stats"
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <ChartBarIcon className="w-8 h-8 text-blue-400" />
              <div>
                <div className="font-semibold text-gray-100">Statistics</div>
                <div className="text-sm text-gray-400">View detailed network statistics</div>
              </div>
            </div>
          </Link>

          <Link
            href="/blocks"
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <CubeIcon className="w-8 h-8 text-green-400" />
              <div>
                <div className="font-semibold text-gray-100">Blocks</div>
                <div className="text-sm text-gray-400">Browse recent blocks</div>
              </div>
            </div>
          </Link>

          <Link
            href="/api-docs"
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <ServerIcon className="w-8 h-8 text-purple-400" />
              <div>
                <div className="font-semibold text-gray-100">API</div>
                <div className="text-sm text-gray-400">Access network data via API</div>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
