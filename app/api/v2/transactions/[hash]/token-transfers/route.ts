import { NextRequest } from 'next/server';
import { Token, TokenTransfer, Transaction } from '@/models/index';
import { sanitizeHash } from '@/lib/security';
import {
  invalidParameter,
  json,
  loadAddressFacts,
  notFound,
  tokenTransferItem,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - token transfers of one transaction
export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  return v2Route(request, async () => {
    const hash = sanitizeHash((await params).hash);
    if (!hash) return invalidParameter('Invalid transaction hash');

    const [tx, transfers] = (await Promise.all([
      Transaction.findOne({ hash }).select('hash').lean(),
      TokenTransfer.find({ transactionHash: hash }).sort({ logIndex: 1, _id: 1 }).limit(500).lean(),
    ])) as [Doc | null, Doc[]];
    if (!tx && transfers.length === 0) return notFound();

    const [tokens, facts] = await Promise.all([
      Token.find({
        address: { $in: [...new Set(transfers.map((t) => String(t.tokenAddress)))] },
      }).lean(),
      loadAddressFacts(transfers.flatMap((transfer) => [transfer.from, transfer.to])),
    ]);
    const tokenByAddress = new Map(
      (tokens as Doc[]).map((token) => [String(token.address), token])
    );

    return json({
      items: transfers.map((transfer) =>
        tokenTransferItem(transfer, tokenByAddress.get(String(transfer.tokenAddress)), facts)
      ),
      next_page_params: null,
    });
  });
}
