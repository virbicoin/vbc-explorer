'use client';

import { useBalance, useReadContract } from 'wagmi';
import { formatUnits, zeroAddress } from 'viem';
import {
  LockClosedIcon,
  CircleStackIcon,
  ShieldCheckIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType } from 'react';
import { ERC20_ABI } from '../lib/config';
import { useBridge } from './BridgeProvider';

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
  const { source, route, relayEtaSeconds } = useBridge();
  const { asset, vault, remote } = route;
  const decimals = asset.decimals;

  // TVL = native coin (or token) locked in the vault on the source chain.
  const { data: nativeLocked } = useBalance({
    address: vault,
    chainId: source.chainId,
    query: { enabled: asset.kind === 'native', refetchInterval: 15000 },
  });
  const { data: tokenLocked } = useReadContract({
    address: asset.token ?? zeroAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [vault],
    chainId: source.chainId,
    query: { enabled: asset.kind === 'erc20', refetchInterval: 15000 },
  });

  // Circulating wrapped supply on the remote chain (should match the locked amount).
  const { data: supply } = useReadContract({
    address: remote.wrappedToken,
    abi: ERC20_ABI,
    functionName: 'totalSupply',
    chainId: remote.chainId,
    query: { refetchInterval: 15000 },
  });

  const lockedRaw =
    asset.kind === 'native' ? nativeLocked?.value : (tokenLocked as bigint | undefined);
  const lockedNum = lockedRaw != null ? Number(formatUnits(lockedRaw, decimals)) : null;
  const supplyNum = supply != null ? Number(formatUnits(supply as bigint, decimals)) : null;

  // Collateralization: locked vs. minted. >= 100% means fully backed.
  let backing = '—';
  if (lockedNum !== null && supplyNum !== null) {
    backing = supplyNum > 0 ? `${Math.round((lockedNum / supplyNum) * 100)}%` : '100%';
  }

  const cards: StatCard[] = [
    {
      label: `${asset.symbol} Locked`,
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
