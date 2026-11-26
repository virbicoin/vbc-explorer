import { NextRequest } from 'next/server';
import { Block, Contract } from '@/models/index';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import { json, v2Route } from '@/lib/api/v2/common';

// Records flagged `no-code` are addresses without contract code that an old register API stored.
const WITH_CODE = { hiddenReason: { $ne: 'no-code' } };

async function counters() {
  const since = Math.floor(Date.now() / 1000) - 86_400;
  const firstBlock = (await Block.findOne({ timestamp: { $gte: since } })
    .sort({ timestamp: 1 })
    .select('number')
    .lean()) as { number: number } | null;
  const [all, verified, created, newlyVerified] = await Promise.all([
    Contract.countDocuments(WITH_CODE),
    Contract.countDocuments({ ...WITH_CODE, verified: true }),
    firstBlock
      ? Contract.countDocuments({ ...WITH_CODE, blockNumber: { $gte: firstBlock.number } })
      : 0,
    Contract.countDocuments({
      ...WITH_CODE,
      verified: true,
      verifiedAt: { $gte: new Date(since * 1000) },
    }),
  ]);
  return {
    smart_contracts: String(all),
    new_smart_contracts_24h: String(created),
    verified_smart_contracts: String(verified),
    new_verified_smart_contracts_24h: String(newlyVerified),
  };
}

// Blockscout API v2 - contract counters: the contracts the sync recorded (every contract a
// transaction or another contract created), those created in the last 24 hours, and the
// verified ones (new = verified in the last 24 hours).
export async function GET(request: NextRequest) {
  return v2Route(request, async () =>
    json(await apiCache.getOrSet('v2:smart-contracts:counters', counters, CACHE_TTL.LONG))
  );
}
