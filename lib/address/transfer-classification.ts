/**
 * Pure helpers to classify token transfers as mint / burn / transfer.
 *
 * The mint/burn detection (zero-address, dead-address and the `'System'`
 * sentinel) was previously inlined repeatedly across the token pages
 * (`app/token/[address]/**`). Centralizing it here removes the duplication and
 * makes the classification unit-testable. This module is dependency-free so it
 * is safe to import from client components.
 */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';

/**
 * A transfer originates a mint when the sender is the zero address or the
 * `'System'` sentinel used by the indexer.
 */
export function isMintAddress(from: string | null | undefined): boolean {
  if (!from) return false;
  return from === 'System' || from.toLowerCase() === ZERO_ADDRESS;
}

/**
 * A transfer is a burn when the recipient is the zero address, the dead address
 * or the `'System'` sentinel.
 */
export function isBurnAddress(to: string | null | undefined): boolean {
  if (!to) return false;
  const toLower = to.toLowerCase();
  return to === 'System' || toLower === ZERO_ADDRESS || toLower === DEAD_ADDRESS;
}

export type TransferKind = 'mint' | 'burn' | 'transfer';

/**
 * Classify a transfer by its endpoints. Mint takes precedence over burn,
 * matching the existing inline logic on the token pages.
 */
export function getTransferKind(
  from: string | null | undefined,
  to: string | null | undefined
): TransferKind {
  if (isMintAddress(from)) return 'mint';
  if (isBurnAddress(to)) return 'burn';
  return 'transfer';
}
