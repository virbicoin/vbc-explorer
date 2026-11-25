import { NextRequest } from 'next/server';
import { hexToNumber, type Hash } from 'viem';
import { Transaction } from '@/models/index';
import { sanitizeHash } from '@/lib/security';
import { publicClient } from '@/lib/api/blockscout/shared';
import {
  addressParam,
  invalidParameter,
  json,
  loadAddressFacts,
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
      items: receipt.logs.map((log) => ({
        address: addressParam(log.address, facts, { isContract: true }),
        block_hash: log.blockHash,
        block_number: log.blockNumber ? hexToNumber(log.blockNumber) : null,
        data: log.data,
        decoded: null,
        index: log.logIndex ? hexToNumber(log.logIndex) : 0,
        smart_contract: null,
        // always four entries, null where the event has fewer topics
        topics: [0, 1, 2, 3].map((position) => log.topics[position] ?? null),
        transaction_hash: log.transactionHash,
      })),
      next_page_params: null,
    });
  });
}
