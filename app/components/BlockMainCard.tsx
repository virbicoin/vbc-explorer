import React from 'react';
import { CubeIcon, ClockIcon, UserIcon, FireIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

interface BlockMainCardProps {
  number: string | number;
  timestamp: string | number;
  miner: string;
  minerName?: string;
  txCount: string | number;
  gasUsed: string | number;
  gasLimit: string | number;
  isGenesis?: boolean;
  getTimeAgo: (timestamp: number | string) => string;
  formatTimestamp: (timestamp: number | string) => string;
}

const BlockMainCard: React.FC<BlockMainCardProps> = ({
  number,
  timestamp,
  miner,
  minerName,
  txCount,
  gasUsed,
  gasLimit,
  isGenesis,
  getTimeAgo,
  formatTimestamp,
}) => (
  <div className="bg-gray-900 rounded-xl border border-blue-700 p-6 mb-8 shadow-lg flex flex-col md:flex-row md:items-center md:justify-between gap-6">
    <div className="flex items-center gap-4">
      <CubeIcon className="w-12 h-12 text-blue-400" />
      <div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-blue-200">Block #{number}</span>
          {isGenesis && (
            <span className="bg-yellow-600/20 text-yellow-400 text-xs font-bold px-2 py-1 rounded border border-yellow-600/50 ml-2">
              GENESIS
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-gray-400 text-sm">
          <ClockIcon className="w-4 h-4" />
          <span>
            {formatTimestamp(timestamp)}（{getTimeAgo(timestamp)}）
          </span>
        </div>
      </div>
    </div>
    <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1 justify-end">
      <div className="flex items-center gap-2">
        <UserIcon className="w-5 h-5 text-green-400" />
        <span className="text-sm text-gray-300">Mined by</span>
        <Link
          href={`/address/${miner}`}
          className="text-green-400 hover:text-green-300 font-mono text-sm transition-colors hover:underline"
        >
          {minerName || miner.slice(0, 8) + '...' + miner.slice(-6)}
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300">Tx</span>
        <span className="text-lg font-bold text-blue-400">{txCount}</span>
      </div>
      <div className="flex items-center gap-2">
        <FireIcon className="w-5 h-5 text-orange-400" />
        <span className="text-sm text-gray-300">Gas</span>
        <span className="text-lg font-bold text-orange-400">
          {gasUsed.toLocaleString()} / {gasLimit.toLocaleString()}
        </span>
      </div>
    </div>
  </div>
);

export default BlockMainCard;
