/**
 * Per-id VRC-1155 balances for the APIs. `tokenholders` keeps one row per
 * holder with the sum over all ids (lib/sync/erc1155.ts); Blockscout lists an
 * ERC-1155 holding per token id, so the ids are computed here from the
 * holder's own transfers (exact, BigInt).
 */

import { TokenTransfer } from '@/models/index';
import { VRC1155_TYPE, erc1155Balances } from '@/lib/sync/erc1155';

/** Whether a stored token type is VRC-1155 / ERC-1155. */
export function isMultiTokenType(type: unknown): boolean {
  return typeof type === 'string' && type.replace(/\D/g, '') === '1155';
}

/** token address → ids the holder has a balance of, largest first. */
export async function erc1155HoldingsOf(
  holder: string,
  tokenAddresses: string[]
): Promise<Map<string, Array<{ tokenId: string; value: string }>>> {
  const result = new Map<string, Array<{ tokenId: string; value: string }>>();
  if (tokenAddresses.length === 0) return result;
  const account = holder.toLowerCase();
  const transfers = (await TokenTransfer.collection
    .find(
      {
        tokenType: VRC1155_TYPE,
        tokenAddress: { $in: tokenAddresses.map((address) => address.toLowerCase()) },
        $or: [{ from: account }, { to: account }],
      },
      { projection: { tokenAddress: 1, from: 1, to: 1, tokenId: 1, value: 1 } }
    )
    .toArray()) as unknown as Array<{
    tokenAddress: string;
    from: string;
    to: string;
    tokenId: string;
    value: string;
  }>;

  const byToken = new Map<string, typeof transfers>();
  for (const transfer of transfers) {
    const list = byToken.get(transfer.tokenAddress) ?? [];
    list.push(transfer);
    byToken.set(transfer.tokenAddress, list);
  }
  for (const [token, list] of byToken) {
    const ids = erc1155Balances(list).get(account);
    if (!ids) continue;
    result.set(
      token,
      [...ids]
        .filter(([, amount]) => amount > 0n)
        .sort(([, a], [, b]) => (a === b ? 0 : a > b ? -1 : 1))
        .map(([tokenId, amount]) => ({ tokenId, value: amount.toString() }))
    );
  }
  return result;
}
