import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import { blockListItems, json, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - the newest blocks for a home page: an array of 4, as on Blockscout
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const blocks = (await Block.find().sort({ number: -1 }).limit(4).lean()) as Array<
      Record<string, unknown>
    >;
    return json(await blockListItems(blocks));
  });
}
