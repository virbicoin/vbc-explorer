import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import { json, v2Route } from '@/lib/api/v2/common';

const DAY = 86_400;
/** Days before today in the chart (Blockscout's default range). */
const DAYS = 31;

async function chart() {
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const from = today - DAYS * DAY;
  const rows = (await Block.aggregate([
    { $match: { timestamp: { $gte: from, $lt: today } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: { $toDate: { $multiply: ['$timestamp', 1000] } },
          },
        },
        count: { $sum: { $size: { $ifNull: ['$transactions', []] } } },
      },
    },
  ])) as Array<{ _id: string; count: number }>;
  const byDay = new Map(rows.map((row) => [row._id, row.count]));
  const chart_data = [];
  for (let day = today - DAY; day >= from; day -= DAY) {
    const date = new Date(day * 1000).toISOString().slice(0, 10);
    chart_data.push({ date, transactions_count: byDay.get(date) ?? 0 });
  }
  return { chart_data };
}

// Blockscout API v2 - transactions per day (UTC) for the 31 days before today, newest first,
// counted from the stored blocks. A day without stored blocks counts 0.
export async function GET(request: NextRequest) {
  return v2Route(request, async () =>
    json(await apiCache.getOrSet('v2:charts:transactions', chart, CACHE_TTL.VERY_LONG))
  );
}
