/**
 * MetaMask準拠のトランザクションタイプ分類ユーティリティ
 */

// MetaMask準拠のトランザクションタイプを判定するためのメソッドIDマップ
export const METHOD_IDS: Record<string, { type: string; action: string }> = {
  // ERC20
  '0xa9059cbb': { type: 'token_transfer', action: 'Transfer' },
  '0x23b872dd': { type: 'token_transfer', action: 'Transfer From' },
  '0x095ea7b3': { type: 'approve', action: 'Approve' },
  '0x39509351': { type: 'approve', action: 'Increase Allowance' },
  '0xa457c2d7': { type: 'approve', action: 'Decrease Allowance' },
  // ERC721/1155
  '0x42842e0e': { type: 'nft_transfer', action: 'Safe Transfer' },
  '0xb88d4fde': { type: 'nft_transfer', action: 'Safe Transfer' },
  '0xf242432a': { type: 'nft_transfer', action: 'Safe Transfer (ERC1155)' },
  '0x2eb2c2d6': { type: 'nft_transfer', action: 'Batch Transfer (ERC1155)' },
  '0xa22cb465': { type: 'approve', action: 'Set Approval For All' },
  '0xeacabe14': { type: 'mint', action: 'Mint NFT' },
  '0x40c10f19': { type: 'mint', action: 'Mint' },
  '0x6a627842': { type: 'mint', action: 'Mint' },
  // DEX
  '0x7ff36ab5': { type: 'swap', action: 'Swap ETH for Tokens' },
  '0x18cbafe5': { type: 'swap', action: 'Swap Tokens for ETH' },
  '0x38ed1739': { type: 'swap', action: 'Swap Tokens for Tokens' },
  '0xfb3bdb41': { type: 'swap', action: 'Swap ETH for Exact Tokens' },
  '0x4a25d94a': { type: 'swap', action: 'Swap Tokens for Exact ETH' },
  '0x8803dbee': { type: 'swap', action: 'Swap Tokens for Exact Tokens' },
  '0x5c11d795': { type: 'swap', action: 'Swap Exact Tokens' },
  '0xe8e33700': { type: 'liquidity', action: 'Add Liquidity' },
  '0xf305d719': { type: 'liquidity', action: 'Add Liquidity ETH' },
  '0xbaa2abde': { type: 'liquidity', action: 'Remove Liquidity' },
  '0x02751cec': { type: 'liquidity', action: 'Remove Liquidity ETH' },
  '0xaf2979eb': { type: 'liquidity', action: 'Remove Liquidity ETH Permit' },
  // MasterChef / Staking
  '0xe2bbb158': { type: 'stake', action: 'Deposit (Stake)' },
  '0x441a3e70': { type: 'unstake', action: 'Withdraw (Unstake)' },
  '0x1058d281': { type: 'harvest', action: 'Harvest' },
  '0xddc63262': { type: 'harvest', action: 'Harvest All' },
  '0xfb12a6f5': { type: 'harvest', action: 'Harvest (Enter Staking)' },
  '0x8dbdbe6d': { type: 'harvest', action: 'Deposit' },
  '0x5312ea8e': { type: 'unstake', action: 'Emergency Withdraw' },
  // Burn
  '0x42966c68': { type: 'burn', action: 'Burn' },
  '0x79cc6790': { type: 'burn', action: 'Burn From' },
  '0x9dc29fac': { type: 'burn', action: 'Burn' },
  // Contract Creation
  '0x60806040': { type: 'contract_creation', action: 'Contract Deploy' },
};

// トランザクションタイプの結果型
export interface TransactionTypeResult {
  type: string;
  action: string;
  direction?: 'in' | 'out' | 'self';
}

/**
 * トランザクションタイプを判定する関数（アドレスコンテキストあり）
 */
export function getTransactionType(
  tx: { 
    from: string; 
    to: string | null; 
    value: string; 
    input?: string;
    status?: number;
  },
  address: string,
  tokenTransferHashes?: Set<string>,
  txHash?: string
): TransactionTypeResult {
  const input = tx.input || '0x';
  const methodId = input.slice(0, 10).toLowerCase();
  const isFromAddress = tx.from.toLowerCase() === address.toLowerCase();
  const isToAddress = tx.to?.toLowerCase() === address.toLowerCase();
  
  // Direction
  let direction: 'in' | 'out' | 'self' = 'out';
  if (isFromAddress && isToAddress) direction = 'self';
  else if (isToAddress) direction = 'in';
  else direction = 'out';
  
  // Contract creation (no to address)
  if (!tx.to || tx.to === '0x0000000000000000000000000000000000000000') {
    if (tx.from.toLowerCase() === address.toLowerCase()) {
      return { type: 'contract_creation', action: 'Contract Deploy', direction: 'out' };
    }
  }
  
  // Check if this tx is a token transfer
  if (txHash && tokenTransferHashes?.has(txHash.toLowerCase())) {
    const method = METHOD_IDS[methodId];
    if (method) {
      return { ...method, direction };
    }
    return { type: 'token_transfer', action: 'Token Transfer', direction };
  }
  
  // Check method ID
  const method = METHOD_IDS[methodId];
  if (method) {
    return { ...method, direction };
  }
  
  // Contract interaction (has input data)
  if (input && input !== '0x' && input.length > 2) {
    return { type: 'contract_interaction', action: 'Contract Interaction', direction };
  }
  
  // Native transfer
  const value = BigInt(tx.value || '0');
  if (value > 0n) {
    if (direction === 'in') {
      return { type: 'receive', action: 'Receive', direction: 'in' };
    }
    return { type: 'send', action: 'Send', direction: 'out' };
  }
  
  return { type: 'contract_interaction', action: 'Contract Call', direction };
}

/**
 * トランザクションタイプを判定する関数（アドレスコンテキストなし - グローバル用）
 */
export function getTransactionTypeGlobal(
  tx: { 
    from: string; 
    to: string | null; 
    value: string; 
    input?: string;
    status?: number;
  }
): TransactionTypeResult {
  const input = tx.input || '0x';
  const methodId = input.slice(0, 10).toLowerCase();
  
  // Contract creation (no to address)
  if (!tx.to || tx.to === '0x0000000000000000000000000000000000000000') {
    return { type: 'contract_creation', action: 'Contract Deploy' };
  }
  
  // Check method ID
  const method = METHOD_IDS[methodId];
  if (method) {
    return { ...method };
  }
  
  // Contract interaction (has input data)
  if (input && input !== '0x' && input.length > 2) {
    return { type: 'contract_interaction', action: 'Contract Interaction' };
  }
  
  // Native transfer
  const value = BigInt(tx.value || '0');
  if (value > 0n) {
    return { type: 'send', action: 'Transfer' };
  }
  
  return { type: 'contract_interaction', action: 'Contract Call' };
}

// トランザクションタイプに対応する表示設定
export const TRANSACTION_TYPE_CONFIG: Record<string, { 
  label: string; 
  bgColor: string; 
  textColor: string;
  icon: string;
}> = {
  send: { label: 'Send', bgColor: 'bg-red-100', textColor: 'text-red-700', icon: '↑' },
  receive: { label: 'Receive', bgColor: 'bg-green-100', textColor: 'text-green-700', icon: '↓' },
  token_transfer: { label: 'Token Transfer', bgColor: 'bg-purple-100', textColor: 'text-purple-700', icon: '⇆' },
  nft_transfer: { label: 'NFT Transfer', bgColor: 'bg-pink-100', textColor: 'text-pink-700', icon: '🖼' },
  approve: { label: 'Approve', bgColor: 'bg-yellow-100', textColor: 'text-yellow-700', icon: '✓' },
  swap: { label: 'Swap', bgColor: 'bg-blue-100', textColor: 'text-blue-700', icon: '⇋' },
  liquidity: { label: 'Liquidity', bgColor: 'bg-cyan-100', textColor: 'text-cyan-700', icon: '💧' },
  stake: { label: 'Stake', bgColor: 'bg-orange-100', textColor: 'text-orange-700', icon: '📌' },
  unstake: { label: 'Unstake', bgColor: 'bg-amber-100', textColor: 'text-amber-700', icon: '📤' },
  harvest: { label: 'Harvest', bgColor: 'bg-lime-100', textColor: 'text-lime-700', icon: '🌾' },
  mint: { label: 'Mint', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700', icon: '✨' },
  burn: { label: 'Burn', bgColor: 'bg-red-200', textColor: 'text-red-800', icon: '🔥' },
  contract_creation: { label: 'Contract Creation', bgColor: 'bg-indigo-100', textColor: 'text-indigo-700', icon: '📄' },
  contract_interaction: { label: 'Contract', bgColor: 'bg-violet-100', textColor: 'text-violet-700', icon: '📝' },
  mining_reward: { label: 'Mining Reward', bgColor: 'bg-yellow-100', textColor: 'text-yellow-700', icon: '⛏️' },
};

/**
 * トランザクションタイプの表示設定を取得
 */
export function getTransactionTypeDisplay(type: string) {
  return TRANSACTION_TYPE_CONFIG[type] || TRANSACTION_TYPE_CONFIG.contract_interaction;
}
