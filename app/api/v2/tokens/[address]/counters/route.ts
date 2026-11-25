import { NextRequest } from 'next/server';
import { TokenHolder, TokenTransfer } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { invalidParameter, json, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - holder and transfer counts of a token
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');

    const [holders, transfers] = await Promise.all([
      TokenHolder.countDocuments({
        tokenAddress: address,
        balance: { $nin: ['0', ''], $exists: true },
      }),
      TokenTransfer.countDocuments({ tokenAddress: address }),
    ]);
    return json({ token_holders_count: String(holders), transfers_count: String(transfers) });
  });
}
