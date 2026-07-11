'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useBalance,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { formatUnits, isAddress, parseUnits, zeroAddress, type Address } from 'viem';
import { BRIDGE_ABI, ERC20_ABI, VAULT_ABI } from '../lib/config';
import { useBridge } from './BridgeProvider';

type Direction = 'deposit' | 'withdraw'; // deposit: source->remote, withdraw: remote->source

export function BridgeContent() {
  const { source, route, relayEtaSeconds, routes, routeId, setRouteId } = useBridge();
  const { asset, vault, remote } = route;
  const decimals = asset.decimals; // wrapped mints 1:1, so both sides share the asset's decimals

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContract, data: hash, isPending: isSigning, reset } = useWriteContract();

  const [direction, setDirection] = useState<Direction>('deposit');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [action, setAction] = useState<'lock' | 'approve' | 'burn' | null>(null);
  const [relaying, setRelaying] = useState<{
    txHash: string;
    destName: string;
    toRemote: boolean;
  } | null>(null);

  // Chain the user must be on to send the source-side transaction of this direction.
  const activeChainId = direction === 'deposit' ? source.chainId : remote.chainId;
  const activeChainName = direction === 'deposit' ? source.name : remote.name;
  const activeExplorer = direction === 'deposit' ? source.explorer : remote.explorer;
  const destChainName = direction === 'deposit' ? remote.name : source.name;
  const onCorrectChain = chainId === activeChainId;
  const effectiveRecipient = (recipient.trim() || address || '') as string;
  const recipientValid = isAddress(effectiveRecipient);
  const isErc20Deposit = direction === 'deposit' && asset.kind === 'erc20';

  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
    chainId: activeChainId,
  });

  // ---- Balances -----------------------------------------------------------
  const { data: nativeBal } = useBalance({
    address,
    chainId: source.chainId,
    query: { enabled: !!address && asset.kind === 'native', refetchInterval: 8000 },
  });
  const { data: srcTokenBal } = useReadContract({
    address: asset.token ?? zeroAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: source.chainId,
    query: { enabled: !!address && asset.kind === 'erc20', refetchInterval: 8000 },
  });
  const { data: wrappedBal } = useReadContract({
    address: remote.wrappedToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: remote.chainId,
    query: { enabled: !!address, refetchInterval: 8000 },
  });

  // ---- Allowances (source ERC-20 -> vault; wrapped -> remote bridge) -------
  const { data: srcAllowance, refetch: refetchSrcAllowance } = useReadContract({
    address: asset.token ?? zeroAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, vault] : undefined,
    chainId: source.chainId,
    query: { enabled: !!address && isErc20Deposit },
  });
  const { data: wrappedAllowance, refetch: refetchWrappedAllowance } = useReadContract({
    address: remote.wrappedToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, remote.bridge] : undefined,
    chainId: remote.chainId,
    query: { enabled: !!address && direction === 'withdraw' },
  });

  const amountWei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount, decimals]);

  const balance =
    direction === 'deposit'
      ? asset.kind === 'native'
        ? (nativeBal?.value ?? 0n)
        : ((srcTokenBal as bigint | undefined) ?? 0n)
      : ((wrappedBal as bigint | undefined) ?? 0n);

  const insufficient = amountWei > 0n && amountWei > balance;
  const relevantAllowance =
    (isErc20Deposit
      ? (srcAllowance as bigint | undefined)
      : (wrappedAllowance as bigint | undefined)) ?? 0n;
  const needsApproval =
    (isErc20Deposit || direction === 'withdraw') && amountWei > 0n && relevantAllowance < amountWei;

  useEffect(() => {
    if (!isSuccess || !hash) return;
    if (action === 'approve') {
      if (direction === 'withdraw') refetchWrappedAllowance();
      else refetchSrcAllowance();
      reset();
      setAction(null);
    } else if (action === 'lock' || action === 'burn') {
      setRelaying({ txHash: hash, destName: destChainName, toRemote: action === 'lock' });
      setAmount('');
      reset();
      setAction(null);
    }
    // run once per successful tx; deps intentionally limited to [isSuccess, hash]
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, [isSuccess, hash]);

  const fromSymbol = direction === 'deposit' ? asset.symbol : remote.wrappedSymbol;
  const toSymbol = direction === 'deposit' ? remote.wrappedSymbol : asset.symbol;
  const balanceText = `${Number(formatUnits(balance, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} ${fromSymbol}`;
  const busy = isSigning || isMining || isSwitching;

  const resetForm = () => {
    setAmount('');
    setRelaying(null);
    setAction(null);
  };

  const doApprove = () => {
    setAction('approve');
    if (isErc20Deposit) {
      writeContract({
        address: asset.token as Address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vault, amountWei],
        chainId: source.chainId,
      });
    } else {
      writeContract({
        address: remote.wrappedToken,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [remote.bridge, amountWei],
        chainId: remote.chainId,
      });
    }
  };

  const doDeposit = () => {
    if (!recipientValid) return;
    setRelaying(null);
    setAction('lock');
    if (asset.kind === 'native') {
      writeContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'lock',
        args: [effectiveRecipient as Address],
        value: amountWei,
        chainId: source.chainId,
      });
    } else {
      writeContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'lockToken',
        args: [asset.token as Address, amountWei, effectiveRecipient as Address],
        chainId: source.chainId,
      });
    }
  };

  const doWithdraw = () => {
    if (!recipientValid) return;
    setRelaying(null);
    setAction('burn');
    writeContract({
      address: remote.bridge,
      abi: BRIDGE_ABI,
      functionName: 'burnForBridge',
      args: [amountWei, effectiveRecipient as Address],
      chainId: remote.chainId,
    });
  };

  return (
    <div className="w-full max-w-lg mx-auto lg:mx-0">
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50 shadow-xl">
        {/* Route selector (only when more than one route is configured) */}
        {routes.length > 1 && (
          <div className="mb-5">
            <label className="block text-xs text-gray-400 mb-2">Asset / route</label>
            <select
              value={routeId}
              onChange={(e) => {
                setRouteId(e.target.value);
                setDirection('deposit');
                resetForm();
                reset();
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-gray-600"
            >
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Direction toggle */}
        <div className="mb-6 flex gap-3">
          {(['deposit', 'withdraw'] as Direction[]).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDirection(d);
                setRelaying(null);
              }}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                direction === d
                  ? 'bg-gradient-to-r from-purple-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                  : 'bg-gray-700/50 text-gray-400 hover:text-white'
              }`}
            >
              {d === 'deposit'
                ? `${asset.symbol} → ${remote.wrappedSymbol}`
                : `${remote.wrappedSymbol} → ${asset.symbol}`}
            </button>
          ))}
        </div>

        {/* From */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-850 rounded-2xl p-5 border border-gray-700">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>From: {fromSymbol}</span>
            {isConnected && <span>Balance: {balanceText}</span>}
          </div>
          <div className="flex items-center gap-3">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="flex-1 bg-transparent text-3xl font-bold text-white outline-none min-w-0"
            />
            <button
              onClick={() => setAmount(formatUnits(balance, decimals))}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 rounded-lg text-blue-300"
            >
              MAX
            </button>
          </div>
        </div>

        <div className="flex justify-center my-2">
          <div className="p-2 bg-gray-800 rounded-xl border border-gray-700 text-purple-300">↓</div>
        </div>

        {/* To */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-850 rounded-2xl p-5 border border-gray-700">
          <div className="text-sm text-gray-400 mb-2">
            To: {toSymbol} on {destChainName}
          </div>
          <div className="text-3xl font-bold text-gray-300">{amount || '0.0'}</div>
          <div className="text-xs text-gray-500 mt-1">1:1 (gas only)</div>
        </div>

        {/* Recipient (optional) */}
        <div className="mt-4">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-gray-400 hover:text-white"
          >
            {showAdvanced ? '▾' : '▸'} Recipient address (defaults to connected wallet)
          </button>
          {showAdvanced && (
            <input
              placeholder={address || '0x...'}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono outline-none focus:border-gray-600"
            />
          )}
          {showAdvanced && recipient && !recipientValid && (
            <p className="mt-1 text-xs text-red-400">Invalid address</p>
          )}
        </div>

        {/* Action button */}
        <div className="mt-6">
          {!isConnected ? (
            <button
              onClick={() =>
                connect({ connector: connectors.find((c) => c.id === 'injected') ?? connectors[0] })
              }
              className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 text-white font-bold rounded-2xl"
            >
              Connect Wallet
            </button>
          ) : !onCorrectChain ? (
            <button
              onClick={() => {
                setRelaying(null);
                switchChain({ chainId: activeChainId });
              }}
              disabled={isSwitching}
              className="w-full py-4 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white font-bold rounded-2xl disabled:opacity-50"
            >
              {isSwitching ? 'Switching…' : `Switch to ${activeChainName}`}
            </button>
          ) : needsApproval ? (
            <button
              onClick={doApprove}
              disabled={busy || amountWei === 0n || insufficient}
              className="w-full py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-2xl disabled:bg-gray-700 disabled:opacity-60"
            >
              {busy ? 'Processing…' : `Approve ${fromSymbol}`}
            </button>
          ) : (
            <button
              onClick={direction === 'deposit' ? doDeposit : doWithdraw}
              disabled={busy || amountWei === 0n || insufficient || !recipientValid}
              className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 text-white font-bold rounded-2xl disabled:bg-gray-700 disabled:opacity-60"
            >
              {insufficient
                ? 'Insufficient balance'
                : busy
                  ? isSigning
                    ? 'Confirm in wallet…'
                    : 'Processing…'
                  : `Bridge to ${destChainName}`}
            </button>
          )}
        </div>

        {/* Relaying notice */}
        {relaying && (
          <div className="mt-4 bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-sm">
            <p className="text-green-300 font-semibold">✅ Submitted. Bridging in progress.</p>
            <p className="text-gray-300 mt-1">
              Your tokens will arrive on {relaying.destName} in ~{relayEtaSeconds}s (handled
              automatically by the relayer).
            </p>
            <a
              href={`${activeExplorer}/tx/${relaying.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 hover:underline break-all"
            >
              View transaction ↗
            </a>
            {relaying.toRemote && remote.swapUrl && (
              <a
                href={remote.swapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-amber-300 hover:underline"
              >
                Trade {remote.wrappedSymbol} on {remote.dexName || 'a DEX'} ↗
              </a>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-500 leading-relaxed">
        Arrival on {destChainName} typically takes ~{relayEtaSeconds}s via the relayer. Try a small
        amount first.
      </p>
    </div>
  );
}
