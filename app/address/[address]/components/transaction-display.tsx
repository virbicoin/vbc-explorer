/**
 * Shared transaction-display helpers for the address pages.
 *
 * These render functions (transaction-type badge and token-transfer value
 * formatting) were duplicated verbatim in the main address page and its
 * `transactions` sub-page. Centralizing them removes the duplication while
 * keeping the rendered output identical.
 */

import type { JSX } from 'react';
import type { AddressTransaction, TokenInfo } from '../../../../lib/address/format';

// MetaMask準拠のトランザクションタイプバッジを返す
export function getTransactionTypeBadge(tx: AddressTransaction): JSX.Element {
  const type = tx.type || 'unknown';
  const action = tx.action || type;
  const direction = tx.direction || 'out';

  // タイプごとのスタイル定義
  const styles: Record<string, { bg: string; text: string; icon: string }> = {
    send: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '↑' },
    receive: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '↓' },
    token_transfer: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: '⇄' },
    nft_transfer: { bg: 'bg-pink-500/20', text: 'text-pink-400', icon: '🎨' },
    approve: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '✓' },
    swap: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '⟲' },
    liquidity: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: '💧' },
    stake: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '📥' },
    unstake: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '📤' },
    harvest: { bg: 'bg-lime-500/20', text: 'text-lime-400', icon: '🌾' },
    mint: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '✨' },
    burn: { bg: 'bg-red-600/20', text: 'text-red-500', icon: '🔥' },
    contract_creation: { bg: 'bg-indigo-500/20', text: 'text-indigo-400', icon: '📄' },
    contract_interaction: { bg: 'bg-violet-500/20', text: 'text-violet-400', icon: '⚡' },
    mining_reward: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⛏️' },
    unknown: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: '?' },
  };

  const style = styles[type] || styles['unknown'];

  // 方向矢印（receive/sendの場合を除く）
  let directionIcon = '';
  if (type !== 'send' && type !== 'receive' && type !== 'mining_reward') {
    if (direction === 'in') directionIcon = ' ↓';
    else if (direction === 'out') directionIcon = ' ↑';
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${style.bg} ${style.text}`}
    >
      <span>{style.icon}</span>
      <span>
        {action}
        {directionIcon}
      </span>
    </span>
  );
}

// トークン転送値をフォーマット（単一）
export function formatSingleTokenValue(tokenInfo: TokenInfo): JSX.Element {
  const { value, decimals, symbol, tokenId, type, direction } = tokenInfo;

  // NFTの場合
  if (type === 'VRC-721' || type === 'ERC721' || tokenId !== undefined) {
    return <span className="text-pink-400">Token ID: #{tokenId}</span>;
  }

  // ERC20の場合 - 常にシンボルを使用
  try {
    const numValue = BigInt(value);
    const divisor = BigInt(10 ** decimals);
    const intPart = numValue / divisor;
    const fracPart = numValue % divisor;
    const formatted =
      fracPart > 0n
        ? `${intPart}.${fracPart.toString().padStart(decimals, '0').slice(0, 4)}`
        : intPart.toString();
    const color = direction === 'in' ? 'text-green-400' : 'text-red-400';
    const prefix = direction === 'in' ? '+' : '-';
    return (
      <span className={color}>
        {prefix}
        {formatted} {symbol}
      </span>
    );
  } catch {
    return (
      <span className="text-purple-400">
        {value} {symbol}
      </span>
    );
  }
}

// トークン転送値をフォーマット（複数対応）
export function formatTokenValue(tx: AddressTransaction): JSX.Element | null {
  // 複数のトークン転送がある場合
  if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
    return (
      <div className="flex flex-col gap-1">
        {tx.tokenTransfers.map((transfer, idx) => (
          <div key={idx}>{formatSingleTokenValue(transfer)}</div>
        ))}
      </div>
    );
  }

  // 単一のtokenInfoの場合（後方互換）
  if (!tx.tokenInfo) return null;

  const { value, decimals, symbol, tokenId, type } = tx.tokenInfo;

  // NFTの場合
  if (type === 'VRC-721' || type === 'ERC721' || tokenId !== undefined) {
    return <span className="text-pink-400">Token ID: #{tokenId}</span>;
  }

  // ERC20の場合 - 常にシンボルを使用
  try {
    const numValue = BigInt(value);
    const divisor = BigInt(10 ** decimals);
    const intPart = numValue / divisor;
    const fracPart = numValue % divisor;
    const formatted =
      fracPart > 0n
        ? `${intPart}.${fracPart.toString().padStart(decimals, '0').slice(0, 4)}`
        : intPart.toString();
    return (
      <span className="text-purple-400">
        {formatted} {symbol}
      </span>
    );
  } catch {
    return (
      <span className="text-purple-400">
        {value} {symbol}
      </span>
    );
  }
}
