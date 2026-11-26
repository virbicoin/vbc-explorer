import { NextRequest } from 'next/server';
import { formatUnits } from 'viem';
import { Market } from '@/models/index';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import { getCurrencyConfig } from '@/lib/config';
import { calculateCirculatingSupplyWei } from '@/lib/supply';
import { json, v2Route } from '@/lib/api/v2/common';

const DAY_MS = 86_400_000;
/** Days in the chart, today included (Blockscout's default range). */
const DAYS = 30;

/** A USD price as a plain decimal string ("0.000000809", never "8.09e-7"). */
const decimalText = (price: number) => price.toFixed(12).replace(/\.?0+$/, '') || '0';

async function chart() {
  const from = (Math.floor(Date.now() / DAY_MS) - (DAYS - 1)) * DAY_MS;
  const [rows, supplyWei] = await Promise.all([
    Market.aggregate([
      { $match: { timestamp: { $gte: from }, quoteUSD: { $gt: 0 } } },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$timestamp' } } },
          price: { $last: '$quoteUSD' },
        },
      },
      { $sort: { _id: -1 } },
    ]) as Promise<Array<{ _id: string; price: number }>>,
    calculateCirculatingSupplyWei().catch(() => null),
  ]);
  return {
    available_supply:
      supplyWei === null ? null : formatUnits(supplyWei, getCurrencyConfig().decimals ?? 18),
    chart_data: rows.map((row) => ({
      date: row._id,
      closing_price: decimalText(row.price),
      // the supply of past days is not stored, so their market cap is not known
      market_cap: null,
      tvl: null,
    })),
  };
}

// Blockscout API v2 - the native coin's closing price (USD) per day (UTC) for the last 30 days,
// newest first, from the quotes tools/price.ts stores (the last one of each day), and the
// circulating supply.
export async function GET(request: NextRequest) {
  return v2Route(request, async () =>
    json(await apiCache.getOrSet('v2:charts:market', chart, CACHE_TTL.LONG))
  );
}
