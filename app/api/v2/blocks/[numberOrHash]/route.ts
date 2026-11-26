import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import {
  blockCondition,
  blockInternalTransactionCount,
  blockItem,
  invalidParameter,
  json,
  loadAddressFacts,
  loadBlockTotals,
  notFound,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - one block, by height or hash
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ numberOrHash: string }> }
) {
  return v2Route(request, async () => {
    const condition = blockCondition((await params).numberOrHash);
    if (!condition) return invalidParameter('Invalid block number or hash');
    const block = (await Block.findOne(condition).lean()) as Doc | null;
    if (!block) return notFound();

    const height = Number(block.number);
    const [totals, facts, internalTransactions] = await Promise.all([
      loadBlockTotals([height]),
      loadAddressFacts([block.miner]),
      blockInternalTransactionCount(height),
    ]);
    return json(
      blockItem(block, totals.get(height), { single: true, facts, internalTransactions })
    );
  });
}
