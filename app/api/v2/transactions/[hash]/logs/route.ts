import { NextRequest } from 'next/server';
import type { Hash } from 'viem';
import { Transaction } from '@/models/index';
import { sanitizeHash } from '@/lib/security';
import { publicClient } from '@/lib/api/blockscout/shared';
import {
  invalidParameter,
  json,
  loadAddressFacts,
  logItem,
  notFound,
  v2Route,
} from '@/lib/api/v2/common';

// Blockscout API v2 - event logs of one transaction, from the node's receipt
export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  return v2Route(request, async () => {
    const hash = sanitizeHash((await params).hash);
    if (!hash) return invalidParameter('Invalid transaction hash');

    const known = await Transaction.exists({ hash });
    const receipt = await publicClient.request({
      method: 'eth_getTransactionReceipt',
      params: [hash as Hash],
    });
    if (!receipt) return known ? json({ items: [], next_page_params: null }) : notFound();

    const facts = await loadAddressFacts(receipt.logs.map((log) => log.address));
    return json({
      items: receipt.logs.map((log) => logItem(log as unknown as Record<string, unknown>, facts)),
      next_page_params: null,
    });
  });
}
