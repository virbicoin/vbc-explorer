import { NextRequest } from 'next/server';
import { Block, Token, Transaction } from '@/models/index';
import { escapeRegex, sanitizeAddress, sanitizeHash, sanitizeSearchQuery } from '@/lib/security';
import { ercTokenType } from '@/lib/api/token-standard';
import { json, loadAddressFacts, v2Route } from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

const isoTime = (seconds: unknown) =>
  typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

function tokenResult(token: Doc, verified: boolean) {
  return {
    type: 'token',
    name: token.name || null,
    symbol: token.symbol || null,
    address_hash: token.address,
    address_url: `/address/${token.address}`,
    token_url: `/token/${token.address}`,
    token_type: ercTokenType(token.type as string | undefined),
    total_supply: token.totalSupply ?? null,
    exchange_rate: null,
    circulating_market_cap: null,
    icon_url: null,
    is_smart_contract_address: true,
    is_smart_contract_verified: verified,
    is_verified_via_admin_panel: false,
    certified: false,
    priority: 2,
    reputation: 'ok',
    // name used before Blockscout 7
    address: token.address,
  };
}

// Blockscout API v2 - search by address, transaction hash, block (height or
// hash), or the start of a token name / symbol. Hidden tokens are not listed.
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const q = sanitizeSearchQuery(new URL(request.url).searchParams.get('q') || '', 100).trim();
    if (!q) return json({ items: [], next_page_params: null });
    const items: Doc[] = [];

    const address = sanitizeAddress(q);
    const hash = sanitizeHash(q);
    if (address) {
      const [token, facts] = await Promise.all([
        Token.findOne({ address, hidden: { $ne: true } }).lean() as Promise<Doc | null>,
        loadAddressFacts([address]),
      ]);
      const fact = facts.get(address);
      if (token) items.push(tokenResult(token, fact?.isVerified ?? false));
      items.push({
        type: fact?.isContract ? 'contract' : 'address',
        name: fact?.name ?? null,
        address_hash: address,
        url: `/address/${address}`,
        is_smart_contract_address: fact?.isContract ?? false,
        is_smart_contract_verified: fact?.isVerified ?? false,
        ens_info: null,
        certified: false,
        priority: 0,
        reputation: 'ok',
        address,
      });
    } else if (hash) {
      const [tx, block] = (await Promise.all([
        Transaction.findOne({ hash }).select('hash timestamp').lean(),
        Block.findOne({ hash }).select('number hash timestamp').lean(),
      ])) as [Doc | null, Doc | null];
      if (tx) {
        items.push({
          type: 'transaction',
          transaction_hash: tx.hash,
          timestamp: isoTime(tx.timestamp),
          url: `/tx/${tx.hash}`,
          priority: 0,
          tx_hash: tx.hash,
        });
      }
      if (block) items.push(blockResult(block));
    } else if (/^\d{1,15}$/.test(q)) {
      const block = (await Block.findOne({ number: Number(q) })
        .select('number hash timestamp')
        .lean()) as Doc | null;
      if (block) items.push(blockResult(block));
    } else if (q.length >= 2) {
      const starts = { $regex: `^${escapeRegex(q)}`, $options: 'i' };
      const tokens = (await Token.find({
        hidden: { $ne: true },
        $or: [{ name: starts }, { symbol: starts }],
      })
        .sort({ holders: -1, address: 1 })
        .limit(50)
        .lean()) as Doc[];
      const facts = await loadAddressFacts(tokens.map((token) => token.address));
      for (const token of tokens) {
        items.push(tokenResult(token, facts.get(String(token.address))?.isVerified ?? false));
      }
    }

    return json({ items, next_page_params: null });
  });
}

function blockResult(block: Doc) {
  return {
    type: 'block',
    block_number: block.number,
    block_hash: block.hash,
    block_type: 'block',
    timestamp: isoTime(block.timestamp),
    url: `/block/${block.number}`,
    priority: 0,
  };
}
