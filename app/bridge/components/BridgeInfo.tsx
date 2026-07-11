'use client';

import {
  LockClosedIcon,
  CheckBadgeIcon,
  SparklesIcon,
  FireIcon,
  ArrowUpRightIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType } from 'react';
import { useBridge } from './BridgeProvider';

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function AddressRow({
  label,
  address,
  explorer,
}: {
  label: string;
  address: string;
  explorer: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-700/50 last:border-0">
      <span className="text-gray-400 text-sm shrink-0">{label}</span>
      <a
        href={`${explorer}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-300 hover:text-blue-200 font-mono text-sm flex items-center gap-1 min-w-0"
        title={address}
      >
        <span className="truncate">{shortenAddress(address)}</span>
        <ArrowUpRightIcon className="w-3.5 h-3.5 shrink-0" />
      </a>
    </div>
  );
}

interface Step {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

export function BridgeInfo() {
  const { source, route } = useBridge();
  const { asset, vault, remote } = route;

  const depositSteps: Step[] = [
    {
      Icon: LockClosedIcon,
      title: `Lock ${asset.symbol}`,
      body: `Your ${asset.symbol} is locked in the vault contract on ${source.name}.`,
    },
    {
      Icon: CheckBadgeIcon,
      title: 'Validators sign',
      body: `Independent validators verify the lock and co-sign the transfer (M-of-N EIP-712 signatures).`,
    },
    {
      Icon: SparklesIcon,
      title: `Mint ${remote.wrappedSymbol}`,
      body: `An equal amount of ${remote.wrappedSymbol} is minted to you on ${remote.name}, 1:1.`,
    },
  ];

  const withdrawSteps: Step[] = [
    {
      Icon: FireIcon,
      title: `Burn ${remote.wrappedSymbol}`,
      body: `You burn ${remote.wrappedSymbol} through the bridge contract on ${remote.name}.`,
    },
    {
      Icon: CheckBadgeIcon,
      title: 'Validators sign',
      body: `Validators verify the burn and co-sign the release.`,
    },
    {
      Icon: SparklesIcon,
      title: `Release ${asset.symbol}`,
      body: `The vault releases your ${asset.symbol} back on ${source.name}.`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* How it works */}
      <div className="bg-gray-800/70 rounded-3xl border border-gray-700/50 p-6">
        <h2 className="text-lg font-bold text-white mb-1">How it works</h2>
        <p className="text-sm text-gray-400 mb-5">
          A lock-and-mint bridge. {remote.wrappedSymbol} is always backed 1:1 by {asset.symbol}{' '}
          locked in the vault.
        </p>

        <div className="space-y-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-purple-300 mb-3">
              {asset.symbol} → {remote.wrappedSymbol}
            </div>
            <ol className="space-y-3">
              {depositSteps.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/15 text-purple-300 shrink-0">
                      <s.Icon className="w-4 h-4" />
                    </div>
                    {i < depositSteps.length - 1 && (
                      <div className="w-px flex-1 bg-gray-700 my-1" />
                    )}
                  </div>
                  <div className="pb-1">
                    <div className="text-sm font-semibold text-gray-100">
                      {i + 1}. {s.title}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-300 mb-3">
              {remote.wrappedSymbol} → {asset.symbol}
            </div>
            <ol className="space-y-3">
              {withdrawSteps.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/15 text-blue-300 shrink-0">
                      <s.Icon className="w-4 h-4" />
                    </div>
                    {i < withdrawSteps.length - 1 && (
                      <div className="w-px flex-1 bg-gray-700 my-1" />
                    )}
                  </div>
                  <div className="pb-1">
                    <div className="text-sm font-semibold text-gray-100">
                      {i + 1}. {s.title}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Contracts & networks */}
      <div className="bg-gray-800/70 rounded-3xl border border-gray-700/50 p-6">
        <h2 className="text-lg font-bold text-white mb-4">Contracts &amp; networks</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-100">{source.name}</span>
              <span className="text-xs text-gray-500">chain {source.chainId}</span>
            </div>
            {asset.kind === 'erc20' && asset.token && (
              <AddressRow label={asset.symbol} address={asset.token} explorer={source.explorer} />
            )}
            <AddressRow label="Vault" address={vault} explorer={source.explorer} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-100">{remote.name}</span>
              <span className="text-xs text-gray-500">chain {remote.chainId}</span>
            </div>
            <AddressRow
              label={remote.wrappedSymbol}
              address={remote.wrappedToken}
              explorer={remote.explorer}
            />
            <AddressRow label="Bridge" address={remote.bridge} explorer={remote.explorer} />
          </div>
        </div>
      </div>
    </div>
  );
}
