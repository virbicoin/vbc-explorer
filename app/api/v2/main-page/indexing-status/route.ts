import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import { countAll } from '@/lib/db/count';
import { getTraceSourceUrl, readConfig } from '@/lib/config';
import { resolveSyncSettings } from '@/lib/sync/reorg';
import { getWeb3 } from '@/lib/web3/provider';
import { headNumber, internalIndexHead, json, v2Route } from '@/lib/api/v2/common';

/** A ratio as Blockscout writes it: at most 1, rounded down to two decimals. */
function ratio(done: number, total: number): string {
  const value = total > 0 ? Math.min(1, Math.max(0, done) / total) : 0;
  return (Math.floor(value * 100) / 100).toFixed(2);
}

/** The node's height, or null when it does not answer within 3 s. */
async function nodeHead(): Promise<number | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000).unref());
  const answer = getWeb3()
    .eth.getBlockNumber()
    .then(Number)
    .catch(() => null);
  return Promise.race([answer, timeout]);
}

// Blockscout API v2 - how far the indexers are.
// Blocks: the stored blocks against the node's height (the stored height when the node does not
// answer). Internal transactions: the indexer's position against the stored height, which it
// follows `sync.confirmations` + 1 blocks behind; "1.00" when no trace source is configured, as
// Blockscout reports with that fetcher disabled.
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const [stored, storedHead, internalHead, chainHead] = await Promise.all([
      countAll(Block),
      headNumber(),
      internalIndexHead(),
      nodeHead(),
    ]);
    const blocks = ratio(stored, Math.max(chainHead ?? 0, storedHead) + 1);
    let internal = '1.00';
    if (getTraceSourceUrl()) {
      const { confirmations } = resolveSyncSettings(readConfig().sync);
      const target = Math.max(0, storedHead - confirmations - 1);
      internal = internalHead >= target ? '1.00' : ratio(internalHead + 1, target + 1);
    }
    return json({
      finished_indexing: blocks === '1.00' && internal === '1.00',
      finished_indexing_blocks: blocks === '1.00',
      indexed_blocks_ratio: blocks,
      indexed_internal_transactions_ratio: internal,
    });
  });
}
