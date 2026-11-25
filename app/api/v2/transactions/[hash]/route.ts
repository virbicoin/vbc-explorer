import { NextRequest } from 'next/server';
import { Token, TokenTransfer, Transaction } from '@/models/index';
import { isValidHash } from '@/lib/security';
import {
  fillTimestamps,
  headNumber,
  internalErrorFlags,
  invalidParameter,
  json,
  loadAddressFacts,
  notFound,
  tokenTransferItem,
  transactionItem,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

/** Token transfers embedded in the transaction, as on Blockscout. */
const TRANSFER_LIMIT = 50;

// Blockscout API v2 - a transaction: the list object plus its token transfers.
export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  return v2Route(request, async () => {
    const { hash } = await params;
    if (!isValidHash(hash)) return invalidParameter('Invalid transaction hash');
    const txHash = hash.toLowerCase();

    const tx = (await Transaction.findOne({ hash: txHash }).lean()) as Doc | null;
    if (!tx) return notFound();

    const transfers = (await TokenTransfer.find({ transactionHash: txHash })
      .sort({ logIndex: 1, _id: 1 })
      .limit(TRANSFER_LIMIT + 1)
      .lean()) as Doc[];
    const shown = transfers.slice(0, TRANSFER_LIMIT);
    const tokenAddresses = [...new Set(shown.map((transfer) => String(transfer.tokenAddress)))];

    const [head, facts, internalErrors, tokens] = await Promise.all([
      headNumber(),
      loadAddressFacts([
        tx.from,
        tx.to,
        tx.creates,
        ...shown.flatMap((transfer) => [transfer.from, transfer.to]),
      ]),
      internalErrorFlags([tx]),
      tokenAddresses.length > 0
        ? (Token.find({ address: { $in: tokenAddresses } }).lean() as Promise<Doc[]>)
        : Promise.resolve([] as Doc[]),
      fillTimestamps([tx]),
    ]);
    const tokenByAddress = new Map(tokens.map((token) => [String(token.address), token]));

    return json({
      ...transactionItem(tx, head, facts, internalErrors),
      token_transfers: shown.map((transfer) =>
        tokenTransferItem(transfer, tokenByAddress.get(String(transfer.tokenAddress)), facts)
      ),
      token_transfers_overflow: transfers.length > TRANSFER_LIMIT,
    });
  });
}
