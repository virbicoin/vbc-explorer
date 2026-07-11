'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { formatUnits, parseUnits, type Address } from 'viem';
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import { ERC20_ABI, ROUTER_ABI, type RemoteSwap } from '../lib/config';
import { useBridge } from './BridgeProvider';

const SLIPPAGE_OPTIONS = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
];

// Convert the wrapped token into other remote-chain assets (e.g. wVBC -> BNB
// or USDT) through a V2 router, without leaving the bridge page. Rendered only
// when the route configures remote.swap.
export function BridgeSwap() {
  const { route } = useBridge();
  const swap = route.remote.swap;
  if (!swap) return null;
  // key resets all inner state when the selected route changes.
  return <BridgeSwapInner key={route.id} swap={swap} />;
}

function BridgeSwapInner({ swap }: { swap: RemoteSwap }) {
  const { route } = useBridge();
  const { asset, remote } = route;
  const decimals = asset.decimals; // wrapped token mints 1:1 with the source asset

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContract, data: hash, isPending: isSigning, reset } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [outIdx, setOutIdx] = useState(0);
  const [slippageBps, setSlippageBps] = useState(100);
  const [action, setAction] = useState<'approve' | 'swap' | null>(null);
  const [swapped, setSwapped] = useState<{ txHash: string; symbol: string } | null>(null);

  const output = swap.outputs[Math.min(outIdx, swap.outputs.length - 1)];
  const onCorrectChain = chainId === remote.chainId;

  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
    chainId: remote.chainId,
  });

  // Wrapped-token balance and router allowance.
  const { data: wrappedBal, refetch: refetchBalance } = useReadContract({
    address: remote.wrappedToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: remote.chainId,
    query: { enabled: !!address, refetchInterval: 8000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: remote.wrappedToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, swap.router] : undefined,
    chainId: remote.chainId,
    query: { enabled: !!address },
  });

  const amountWei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount, decimals]);

  // Routing path: wrapped -> wrappedNative (native out), or hop through
  // wrappedNative for token outputs.
  const path = useMemo<Address[]>(() => {
    if (output.kind === 'native' || !output.address || output.address === swap.wrappedNative) {
      return [remote.wrappedToken, swap.wrappedNative];
    }
    return [remote.wrappedToken, swap.wrappedNative, output.address];
  }, [output, remote.wrappedToken, swap.wrappedNative]);

  // Live quote from the router.
  const { data: amountsOut, isError: quoteError } = useReadContract({
    address: swap.router,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountWei, path],
    chainId: remote.chainId,
    query: { enabled: amountWei > 0n, refetchInterval: 10000 },
  });
  const quote = amountsOut ? (amountsOut as bigint[])[(amountsOut as bigint[]).length - 1] : null;
  const minOut = quote !== null ? (quote * BigInt(10000 - slippageBps)) / 10000n : null;

  const balance = (wrappedBal as bigint | undefined) ?? 0n;
  const insufficient = amountWei > 0n && amountWei > balance;
  const needsApproval = amountWei > 0n && ((allowance as bigint | undefined) ?? 0n) < amountWei;

  useEffect(() => {
    if (!isSuccess || !hash) return;
    if (action === 'approve') {
      refetchAllowance();
      reset();
      setAction(null);
    } else if (action === 'swap') {
      setSwapped({ txHash: hash, symbol: output.symbol });
      setAmount('');
      refetchBalance();
      reset();
      setAction(null);
    }
    // run once per successful tx; deps intentionally limited to [isSuccess, hash]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, hash]);

  const busy = isSigning || isMining || isSwitching;

  const doApprove = () => {
    setSwapped(null);
    setAction('approve');
    writeContract({
      address: remote.wrappedToken,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [swap.router, amountWei],
      chainId: remote.chainId,
    });
  };

  const doSwap = () => {
    if (!address || minOut === null) return;
    setSwapped(null);
    setAction('swap');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
    if (output.kind === 'native') {
      writeContract({
        address: swap.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [amountWei, minOut, path, address, deadline],
        chainId: remote.chainId,
      });
    } else {
      writeContract({
        address: swap.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [amountWei, minOut, path, address, deadline],
        chainId: remote.chainId,
      });
    }
  };

  const quoteText =
    quote !== null
      ? `≈ ${Number(formatUnits(quote, output.decimals)).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })} ${output.symbol}`
      : '—';
  const minText =
    minOut !== null
      ? `${Number(formatUnits(minOut, output.decimals)).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })} ${output.symbol}`
      : null;

  return (
    <div className="w-full max-w-lg mx-auto lg:mx-0">
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50 shadow-xl">
        <div className="flex items-center gap-2 mb-1">
          <ArrowsUpDownIcon className="w-5 h-5 text-amber-300" />
          <h2 className="text-lg font-bold text-white">Convert {remote.wrappedSymbol}</h2>
        </div>
        <p className="text-xs text-gray-400 mb-5">
          Swap bridged {remote.wrappedSymbol} into other {remote.name} assets
          {remote.dexName ? ` via ${remote.dexName}` : ''}.
        </p>

        {/* Amount in */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-850 rounded-2xl p-5 border border-gray-700">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Sell: {remote.wrappedSymbol}</span>
            {isConnected && (
              <span>
                Balance:{' '}
                {Number(formatUnits(balance, decimals)).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}
              </span>
            )}
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
          <div className="p-2 bg-gray-800 rounded-xl border border-gray-700 text-amber-300">↓</div>
        </div>

        {/* Amount out + output selector */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-850 rounded-2xl p-5 border border-gray-700">
          <div className="flex justify-between items-center text-sm text-gray-400 mb-2">
            <span>Receive</span>
            <select
              value={output.symbol}
              onChange={(e) => {
                setOutIdx(swap.outputs.findIndex((o) => o.symbol === e.target.value));
                setSwapped(null);
              }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-gray-600"
            >
              {swap.outputs.map((o) => (
                <option key={o.symbol} value={o.symbol}>
                  {o.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="text-3xl font-bold text-gray-300 truncate" title={quoteText}>
            {amountWei > 0n ? quoteText : '0.0'}
          </div>
          {minText && <div className="text-xs text-gray-500 mt-1">Min. received: {minText}</div>}
          {quoteError && amountWei > 0n && (
            <div className="text-xs text-red-400 mt-1">
              No quote — the pool may have insufficient liquidity for this pair.
            </div>
          )}
        </div>

        {/* Slippage */}
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-gray-400">Slippage tolerance</span>
          <div className="flex gap-2">
            {SLIPPAGE_OPTIONS.map((s) => (
              <button
                key={s.bps}
                onClick={() => setSlippageBps(s.bps)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  slippageBps === s.bps
                    ? 'bg-amber-500/90 text-gray-900'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action button */}
        <div className="mt-6">
          {!isConnected ? (
            <button
              onClick={() =>
                connect({ connector: connectors.find((c) => c.id === 'injected') ?? connectors[0] })
              }
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-gray-900 font-bold rounded-2xl"
            >
              Connect Wallet
            </button>
          ) : !onCorrectChain ? (
            <button
              onClick={() => switchChain({ chainId: remote.chainId })}
              disabled={isSwitching}
              className="w-full py-4 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white font-bold rounded-2xl disabled:opacity-50"
            >
              {isSwitching ? 'Switching…' : `Switch to ${remote.name}`}
            </button>
          ) : needsApproval ? (
            <button
              onClick={doApprove}
              disabled={busy || amountWei === 0n || insufficient}
              className="w-full py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-2xl disabled:bg-gray-700 disabled:opacity-60"
            >
              {busy ? 'Processing…' : `Approve ${remote.wrappedSymbol}`}
            </button>
          ) : (
            <button
              onClick={doSwap}
              disabled={busy || amountWei === 0n || insufficient || minOut === null}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-gray-900 font-bold rounded-2xl disabled:bg-gray-700 disabled:text-gray-400 disabled:opacity-60"
            >
              {insufficient
                ? 'Insufficient balance'
                : busy
                  ? isSigning
                    ? 'Confirm in wallet…'
                    : 'Processing…'
                  : `Swap to ${output.symbol}`}
            </button>
          )}
        </div>

        {/* Success notice */}
        {swapped && (
          <div className="mt-4 bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-sm">
            <p className="text-green-300 font-semibold">✅ Swapped to {swapped.symbol}.</p>
            <a
              href={`${remote.explorer}/tx/${swapped.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 hover:underline break-all"
            >
              View transaction ↗
            </a>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-500 leading-relaxed">
        Swaps execute on {remote.name}
        {remote.dexName ? ` through ${remote.dexName}` : ''} at the current pool rate. Large amounts
        may face high price impact while pool liquidity is small.
      </p>
    </div>
  );
}
