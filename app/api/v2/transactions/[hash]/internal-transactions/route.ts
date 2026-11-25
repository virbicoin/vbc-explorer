import { NextRequest } from 'next/server';
import { json, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - internal transactions. Call traces are not indexed, so
// the list is always empty (ordinary transactions are not passed off as internal ones).
export async function GET(request: NextRequest) {
  return v2Route(request, async () => json({ items: [], next_page_params: null }));
}
