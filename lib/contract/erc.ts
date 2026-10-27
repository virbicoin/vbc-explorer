/**
 * Token standard codes as stored in the `Contract.ERC` field and the
 * ERC-165 interface ids used to detect NFTs on-chain.
 *
 * `tools/sync.ts` writes these codes when it registers a contract; the APIs
 * and the token metadata path read them. Keep every mapping here.
 */

export const ERC_CODES = {
  CONTRACT: 0,
  ERC20: 2,
  ERC721: 721,
  ERC1155: 1155,
} as const;

export type DetectedTokenType = 'ERC20' | 'ERC721' | 'ERC1155' | 'Contract';

/** ERC-165 interface id of ERC-721 (`supportsInterface(0x80ac58cd)`). */
export const ERC721_INTERFACE_ID = '0x80ac58cd';
/** ERC-165 interface id of ERC-1155 (`supportsInterface(0xd9b67a26)`). */
export const ERC1155_INTERFACE_ID = '0xd9b67a26';

/** `Contract.ERC` code for a detected token type. */
export function ercCodeForTokenType(tokenType: DetectedTokenType): number {
  switch (tokenType) {
    case 'ERC20':
      return ERC_CODES.ERC20;
    case 'ERC721':
      return ERC_CODES.ERC721;
    case 'ERC1155':
      return ERC_CODES.ERC1155;
    default:
      return ERC_CODES.CONTRACT;
  }
}

const NFT_TYPE_STRINGS = new Set([
  'VRC-721',
  'VRC-1155',
  'VRC721',
  'VRC1155',
  'ERC-721',
  'ERC-1155',
  'ERC721',
  'ERC1155',
]);

const FUNGIBLE_TYPE_STRINGS = new Set(['VRC-20', 'VRC20', 'ERC-20', 'ERC20', 'LP']);

/** True for the ERC codes that denote an NFT contract (721 / 1155). */
export function isNftErcCode(code: unknown): boolean {
  return code === ERC_CODES.ERC721 || code === ERC_CODES.ERC1155;
}

/** True for the ERC codes that denote a fungible token contract (2, legacy 20). */
export function isFungibleErcCode(code: unknown): boolean {
  return code === ERC_CODES.ERC20 || code === 20;
}

/** True for the `type` strings that denote an NFT (VRC-721 / VRC-1155 and spellings). */
export function isNftTokenType(type: unknown): boolean {
  return typeof type === 'string' && NFT_TYPE_STRINGS.has(type);
}

/** True for the `type` strings that denote a fungible token (VRC-20, LP, ...). */
export function isFungibleTokenType(type: unknown): boolean {
  return typeof type === 'string' && FUNGIBLE_TYPE_STRINGS.has(type);
}
