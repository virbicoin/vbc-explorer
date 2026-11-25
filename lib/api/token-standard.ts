/**
 * Token standard names as Etherscan / Blockscout spell them.
 *
 * The explorer stores its own type strings ('VRC-20', 'ERC20', 'VRC-721',
 * 'ERC1155', ...). The compatible APIs report the ERC name, and anything
 * fungible or unknown as ERC-20, like the explorer's own holdings list.
 */
export type ErcTokenType = 'ERC-20' | 'ERC-721' | 'ERC-1155';

export function ercTokenType(type: string | null | undefined): ErcTokenType {
  const standard = (type ?? '').replace(/\D/g, '');
  if (standard === '721') return 'ERC-721';
  if (standard === '1155') return 'ERC-1155';
  return 'ERC-20';
}
