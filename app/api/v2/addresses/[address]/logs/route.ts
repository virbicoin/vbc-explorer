import { NextRequest } from 'next/server';
import { Log } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  invalidParameter,
  json,
  loadAddressFacts,
  logItem,
  paginate,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - event logs emitted by an address (contract), newest first, from `Log`
// (tools/logs.ts). `topic` narrows them to logs with that topic in any position.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;

    const query: Doc = { address };
    const topic = searchParams.get('topic');
    if (topic !== null) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) return invalidParameter('Invalid topic');
      query.topics = topic.toLowerCase();
    }
    const rows = (await Log.find(query)
      .sort({ blockNumber: -1, logIndex: -1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: last.blockNumber,
      index: last.logIndex,
    }));
    const facts = await loadAddressFacts([address]);
    return json({ items: items.map((log) => logItem(log, facts)), next_page_params });
  });
}
