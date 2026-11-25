import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Token, TokenHolder } from '@/models/index';
import { sanitizeAddress, getSecurityHeaders } from '@/lib/security';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { tokenInfo } from '@/lib/api/v2/common';
import { erc1155HoldingsOf, isMultiTokenType } from '@/lib/api/erc1155';

function isPositive(balance: string | null | undefined): boolean {
  try {
    return BigInt(balance || '0') > 0n;
  } catch {
    return false;
  }
}

/**
 * Blockscout API v2 - token balances of an address.
 *
 * A plain array without pagination, one row per token the address holds; tools
 * that discover the tokens of an address read it (DefiLlama's token helper:
 * `token.address_hash`, `token.type`, `value`). Served from the token holder
 * collection, so no node call is made.
 *
 * Differences from Blockscout: a VRC-721 collection is one row with the number
 * of items held in `value` (Blockscout lists one row per token id; the holder
 * collection keeps no ids), tokens hidden as spam are left out, as in the
 * explorer's own holdings list, and `icon_url` is always null (icons are
 * resolved by `/api/tokens`). VRC-1155 holdings are one row per token id, as on
 * Blockscout (computed from the holder's transfers).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    const limited = enforceRateLimit(request, 'api', { format: 'v2' });
    if (limited) return limited;

    const holder = sanitizeAddress(address);
    if (!holder) {
      return NextResponse.json(
        { message: 'Invalid address' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    const holdings = (
      await TokenHolder.find({
        holderAddress: holder,
        balance: { $ne: '0', $exists: true },
      }).lean()
    ).filter((holding) => isPositive(holding.balance));

    const tokens = await Token.find({
      address: { $in: holdings.map((holding) => holding.tokenAddress.toLowerCase()) },
    }).lean();
    const tokenByAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));

    const visible = holdings.filter(
      (holding) => !tokenByAddress.get(holding.tokenAddress.toLowerCase())?.hidden
    );
    const perId = await erc1155HoldingsOf(
      holder,
      visible
        .map((holding) => holding.tokenAddress.toLowerCase())
        .filter((token) => isMultiTokenType(tokenByAddress.get(token)?.type))
    );

    type BalanceRow = {
      token: ReturnType<typeof tokenInfo>;
      token_id: string | null;
      token_instance: null;
      value: string;
    };
    const items = visible
      .flatMap((holding): BalanceRow[] => {
        const address = holding.tokenAddress.toLowerCase();
        const token = tokenInfo(
          holding.tokenAddress,
          tokenByAddress.get(address) as Record<string, unknown> | undefined
        );
        if (isMultiTokenType(tokenByAddress.get(address)?.type)) {
          return (perId.get(address) ?? []).map(({ tokenId, value }) => ({
            token,
            token_id: tokenId,
            token_instance: null,
            value,
          }));
        }
        return [{ token, token_id: null, token_instance: null, value: String(holding.balance) }];
      })
      .sort((a, b) => a.token.address_hash.localeCompare(b.token.address_hash));

    return NextResponse.json(items, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching token balances:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
