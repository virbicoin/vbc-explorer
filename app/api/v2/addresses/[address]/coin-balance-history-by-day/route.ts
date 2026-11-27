import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import { balanceAt, invalidParameter, json, v2Route } from '@/lib/api/v2/common';

const DAY = 86_400;

// Blockscout API v2 - the balance at the end of each of the last `days` days (UTC; default 10,
// at most 90), oldest first, read from the node at the last stored block of each day.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const requested = Number.parseInt(new URL(request.url).searchParams.get('days') ?? '10', 10);
    const days = Math.min(90, Math.max(1, Number.isFinite(requested) ? requested : 10));

    const items = await apiCache.getOrSet(
      `coin-balance-by-day:${address}:${days}`,
      async () => {
        const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
        const rows: Array<{ date: string; value: string }> = [];
        for (let back = days - 1; back >= 0; back--) {
          const dayStart = today - back * DAY;
          const block = (await Block.findOne({ timestamp: { $lt: dayStart + DAY } })
            .sort({ timestamp: -1 })
            .select('number')
            .lean()) as { number?: number } | null;
          if (!block || typeof block.number !== 'number') continue;
          const value = await balanceAt(address, block.number);
          rows.push({
            date: new Date(dayStart * 1000).toISOString().slice(0, 10),
            value: value.toString(),
          });
        }
        return rows;
      },
      CACHE_TTL.MEDIUM
    );
    return json({ days, items });
  });
}
