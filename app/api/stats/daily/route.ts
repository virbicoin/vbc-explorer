import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/db';
import { tryGetDb } from '../../../../lib/db/get-db';

export const dynamic = 'force-dynamic';

interface DailyStats {
  date: string;
  transactions: number;
  blocks: number;
  avgGasPrice: number;
  activeAddresses: number;
}

// Cache for daily stats
let dailyStatsCache: { [key: string]: DailyStats[] } = {};
let lastFetchTime: { [key: string]: number } = {};
const CACHE_DURATION = 300000; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || '7d';

    const now = Date.now();
    const cacheKey = period;

    // Return cached data if still valid
    if (dailyStatsCache[cacheKey] && now - (lastFetchTime[cacheKey] || 0) < CACHE_DURATION) {
      return NextResponse.json({ stats: dailyStatsCache[cacheKey] });
    }

    // Calculate date range
    let days = 7;
    if (period === '30d') days = 30;
    if (period === '90d') days = 90;

    await dbConnect();
    const db = tryGetDb();
    if (!db) {
      return NextResponse.json({ stats: [] });
    }

    const stats: DailyStats[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const startTimestamp = Math.floor(date.getTime() / 1000);
      const endTimestamp = startTimestamp + 86400; // 24 hours

      try {
        // Get transaction count for the day
        const txCount = await db.collection('Transaction').countDocuments({
          timestamp: { $gte: startTimestamp, $lt: endTimestamp },
        });

        // Get block count for the day
        const blockCount = await db.collection('Block').countDocuments({
          timestamp: { $gte: startTimestamp, $lt: endTimestamp },
        });

        // Get average gas price for the day
        const gasPriceAgg = await db
          .collection('Transaction')
          .aggregate([
            {
              $match: {
                timestamp: { $gte: startTimestamp, $lt: endTimestamp },
                gasPrice: { $exists: true, $ne: null },
              },
            },
            {
              $group: {
                _id: null,
                avgGasPrice: { $avg: { $toDouble: '$gasPrice' } },
              },
            },
          ])
          .toArray();

        const avgGasPrice = gasPriceAgg[0]?.avgGasPrice
          ? Math.round(gasPriceAgg[0].avgGasPrice / 1e9)
          : 0;

        // Get unique active addresses for the day
        const activeAddressesAgg = await db
          .collection('Transaction')
          .aggregate([
            {
              $match: {
                timestamp: { $gte: startTimestamp, $lt: endTimestamp },
              },
            },
            {
              $group: {
                _id: null,
                fromAddresses: { $addToSet: '$from' },
                toAddresses: { $addToSet: '$to' },
              },
            },
            {
              $project: {
                uniqueAddresses: {
                  $size: {
                    $setUnion: ['$fromAddresses', '$toAddresses'],
                  },
                },
              },
            },
          ])
          .toArray();

        const activeAddresses = activeAddressesAgg[0]?.uniqueAddresses || 0;

        stats.push({
          date: dateStr,
          transactions: txCount,
          blocks: blockCount,
          avgGasPrice,
          activeAddresses,
        });
      } catch (error) {
        console.error(`Error fetching stats for ${dateStr}:`, error);
        stats.push({
          date: dateStr,
          transactions: 0,
          blocks: 0,
          avgGasPrice: 0,
          activeAddresses: 0,
        });
      }
    }

    // Update cache
    dailyStatsCache[cacheKey] = stats;
    lastFetchTime[cacheKey] = now;

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return NextResponse.json({ stats: [], error: 'Failed to fetch daily stats' }, { status: 500 });
  }
}
