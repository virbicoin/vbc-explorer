'use client';

import { useBalance, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import {
  LockClosedIcon,
  CircleStackIcon,
  ShieldCheckIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType } from 'react';
import { WRAPPED_ABI } from '../lib/config';
import { useBridgeConfig } from './BridgeProvider';

function formatAmount(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}

interface StatCard {
  label: string;
  value: string;
  sub: string;
  Icon: ComponentType<{ className?: string }>;
  color: string;
}

export function BridgeStats() {
  const { source, remote, relayEtaSeconds } = useBridgeConfig();

  // TVL = native coin locked in the vault on the source chain.
  const { data: locked } = useBalance({
    address: source.vault,
    chainId: source.chainId,
    query: { refetchInterval: 15000 },
  });

  // Circulating wrapped supply on the remote chain (should match the locked amount).
  const { data: supply } = useReadContract({
    address: remote.wrappedToken,
    abi: WRAPPED_ABI,
    functionName: 'totalSupply',
    chainId: remote.chainId,
    query: { refetchInterval: 15000 },
  });

  const lockedNum = locked ? Number(formatUnits(locked.value, 18)) : null;
  const supplyNum = supply != null ? Number(formatUnits(supply as bigint, 18)) : null;

  // Collateralization: locked native vs. minted wrapped. >= 100% means fully backed.
  let backing: string = '—';
  if (lockedNum !== null && supplyNum !== null) {
    backing = supplyNum > 0 ? `${Math.round((lockedNum / supplyNum) * 100)}%` : '100%';
  }

  const cards: StatCard[] = [
    {
      label: `${source.nativeSymbol} Locked`,
      value: formatAmount(lockedNum),
      sub: `Total value locked on ${source.name}`,
      Icon: LockClosedIcon,
      color: 'text-purple-400',
    },
    {
      label: `${remote.wrappedSymbol} Supply`,
      value: formatAmount(supplyNum),
      sub: `Minted on ${remote.name}`,
      Icon: CircleStackIcon,
      color: 'text-blue-400',
    },
    {
      label: 'Backing',
      value: backing,
      sub: 'Locked vs. minted (1:1)',
      Icon: ShieldCheckIcon,
      color: 'text-green-400',
    },
    {
      label: 'Relay Time',
      value: `~${relayEtaSeconds}s`,
      sub: 'Typical arrival on the other side',
      Icon: BoltIcon,
      color: 'text-orange-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-gray-800/70 rounded-2xl border border-gray-700/50 p-5 backdrop-blur-sm"
        >
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
            <c.Icon className={`w-5 h-5 ${c.color}`} />
            <span>{c.label}</span>
          </div>
          <div className={`text-2xl font-bold ${c.color} truncate`} title={c.value}>
            {c.value}
          </div>
          <div className="text-xs text-gray-500 mt-1">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
