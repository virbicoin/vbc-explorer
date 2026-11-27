import { NextRequest } from 'next/server';
import { Block, InternalTransaction, Transaction } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { balanceAt, invalidParameter, json, paginate, v2Page, v2Route } from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

interface Change {
  block: number;
  timestamp: number;
  transactionHash: string | null;
}

/** Balances at the given heights, ten at a time. */
async function balancesAt(address: string, heights: number[]): Promise<Map<number, bigint>> {
  const balances = new Map<number, bigint>();
  for (let start = 0; start < heights.length; start += 10) {
    const part = heights.slice(start, start + 10);
    const values = await Promise.all(part.map((height) => balanceAt(address, height)));
    part.forEach((height, index) => balances.set(height, values[index]));
  }
  return balances;
}

// Blockscout API v2 - the balance of an address at each block where it may have changed (its
// transactions, its value-moving internal transactions and the blocks it mined), newest first.
// Values come from the node at those heights, so old ones need an archive node; `delta` is the
// change from the next older entry (for the oldest one, from the block before it).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const paging = v2Page(new URL(request.url).searchParams);
    if (paging.response) return paging.response;

    // one entry more than the page, so that the page's last entry has an older one to compare with
    const want = paging.page.skip + paging.page.limit + 2;
    const [transactions, internals, mined] = (await Promise.all([
      Transaction.find({ $or: [{ from: address }, { to: address }, { creates: address }] })
        .sort({ blockNumber: -1 })
        .limit(want)
        .select('blockNumber hash timestamp')
        .lean(),
      InternalTransaction.find({
        $or: [{ from: address }, { to: address }, { createdContract: address }],
        value: { $nin: ['0', null] },
        reverted: { $ne: true },
      })
        .sort({ blockNumber: -1 })
        .limit(want)
        .select('blockNumber transactionHash timestamp')
        .lean(),
      Block.find({ miner: address })
        .sort({ number: -1 })
        .limit(want)
        .select('number timestamp')
        .lean(),
    ])) as [Doc[], Doc[], Doc[]];

    const changes = new Map<number, Change>();
    const add = (block: unknown, timestamp: unknown, hash: unknown) => {
      const height = Number(block);
      const known = changes.get(height);
      if (!known) {
        changes.set(height, {
          block: height,
          timestamp: Number(timestamp) || 0,
          transactionHash: typeof hash === 'string' ? hash : null,
        });
      } else if (!known.transactionHash && typeof hash === 'string') {
        known.transactionHash = hash;
      }
    };
    transactions.forEach((tx) => add(tx.blockNumber, tx.timestamp, tx.hash));
    internals.forEach((itx) => add(itx.blockNumber, itx.timestamp, itx.transactionHash));
    mined.forEach((block) => add(block.number, block.timestamp, null));
    const ordered = [...changes.values()].sort((a, b) => b.block - a.block);

    const window = ordered.slice(paging.page.skip, paging.page.skip + paging.page.limit + 1);
    const { items, next_page_params } = paginate(window, paging.page, (last) => ({
      block_number: last.block,
    }));
    if (items.length === 0) return json({ items: [], next_page_params: null });
    // the entry older than the page's last one, or the block before it when there is none
    const older = window[items.length] ?? ordered[paging.page.skip + items.length];
    const base = older ? older.block : Math.max(0, items[items.length - 1].block - 1);
    const balances = await balancesAt(address, [
      ...new Set([...items.map((item) => item.block), base]),
    ]);
    return json({
      items: items.map((item, index) => {
        const value = balances.get(item.block) ?? 0n;
        const previousBlock = items[index + 1]?.block ?? base;
        const previous = item.block === previousBlock ? 0n : (balances.get(previousBlock) ?? 0n);
        return {
          block_number: item.block,
          block_timestamp: item.timestamp ? new Date(item.timestamp * 1000).toISOString() : null,
          delta: (value - previous).toString(),
          transaction_hash: item.transactionHash,
          value: value.toString(),
        };
      }),
      next_page_params,
    });
  });
}
