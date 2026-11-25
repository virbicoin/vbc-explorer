import { NextRequest } from 'next/server';
import { Block, Transaction } from '@/models/index';
import { sanitizeAddress, sanitizeHash, sanitizeSearchQuery } from '@/lib/security';
import { json, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - whether a search term names exactly one page to open
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const q = sanitizeSearchQuery(new URL(request.url).searchParams.get('q') || '', 100).trim();
    const none = { parameter: null, redirect: false, type: null };

    const address = sanitizeAddress(q);
    if (address) return json({ parameter: address, redirect: true, type: 'address' });

    const hash = sanitizeHash(q);
    if (hash) {
      if (await Transaction.exists({ hash })) {
        return json({ parameter: hash, redirect: true, type: 'transaction' });
      }
      if (await Block.exists({ hash }))
        return json({ parameter: hash, redirect: true, type: 'block' });
      return json(none);
    }
    if (/^\d{1,15}$/.test(q) && (await Block.exists({ number: Number(q) }))) {
      return json({ parameter: q, redirect: true, type: 'block' });
    }
    return json(none);
  });
}
