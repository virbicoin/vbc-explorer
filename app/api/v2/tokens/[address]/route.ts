import { NextRequest } from 'next/server';
import { Token } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { invalidParameter, json, notFound, tokenInfo, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - one token
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');

    const token = (await Token.findOne({ address }).lean()) as Record<string, unknown> | null;
    if (!token) return notFound();
    return json(tokenInfo(address, token));
  });
}
