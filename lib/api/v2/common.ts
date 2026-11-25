/**
 * Shared pieces of the Blockscout v2-compatible routes (`app/api/v2/`):
 * the response helpers, paging, and the objects every list embeds (address,
 * token, transaction, token transfer) with Blockscout's current field names.
 * Fields this explorer has no data for are null, never invented.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  connectDB,
  Account,
  Block,
  Contract,
  InternalTransaction,
  ScanProgress,
  Token,
} from '@/models/index';
import { getSecurityHeaders, validatePagination } from '@/lib/security';
import { rejectDeepPagination } from '@/lib/security/pagination';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { ercTokenType } from '@/lib/api/token-standard';

/** Rows per page, as on Blockscout. */
export const PAGE_SIZE = 50;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: getSecurityHeaders() });
}

export const notFound = () => json({ message: 'Not found' }, 404);
export const invalidParameter = (message: string) => json({ message }, 400);

/**
 * Rate limit, database connection and the error envelope of a v2 route.
 * Internal error messages are logged, not returned.
 */
export async function v2Route(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const limited = enforceRateLimit(request, 'api', { format: 'v2' });
  if (limited) return limited;
  try {
    await connectDB();
    return await handler();
  } catch (error) {
    console.error('[api/v2] Error:', error instanceof Error ? error.message : error);
    return json({ message: 'Internal server error' }, 500);
  }
}

export interface V2Page {
  page: number;
  limit: number;
  skip: number;
}

/** `page` / `limit` of a list (50 rows unless a smaller `limit` is given), or the 400 for a page too deep. */
export function v2Page(
  searchParams: URLSearchParams
): { page: V2Page; response?: undefined } | { page?: undefined; response: NextResponse } {
  const pagination = validatePagination(
    searchParams.get('page'),
    searchParams.get('limit'),
    PAGE_SIZE,
    {
      defaultLimit: PAGE_SIZE,
    }
  );
  const tooDeep = rejectDeepPagination(pagination, 'v2');
  if (tooDeep) return { response: tooDeep };
  return { page: { page: pagination.page, limit: pagination.limit, skip: pagination.skip } };
}

/**
 * Splits `limit + 1` fetched rows into the page and `next_page_params`.
 * A Blockscout client sends `next_page_params` back as the query of the next
 * request, so it carries what these routes read (`page`, `limit`); `hint` adds
 * the position keys Blockscout shows for the same list, for information.
 */
export function paginate<T>(
  rows: T[],
  page: V2Page,
  hint: (last: T) => Record<string, unknown> = () => ({})
): { items: T[]; next_page_params: Record<string, unknown> | null } {
  const hasNext = rows.length > page.limit;
  const items = hasNext ? rows.slice(0, page.limit) : rows;
  return {
    items,
    next_page_params: hasNext
      ? {
          ...hint(items[items.length - 1]),
          page: page.page + 1,
          limit: page.limit,
          items_count: page.page * page.limit,
        }
      : null,
  };
}

// ============================================
// Address objects
// ============================================

export interface AddressFacts {
  isContract: boolean;
  isVerified: boolean;
  name: string | null;
}

type Doc = Record<string, unknown>;

/**
 * What the database knows about a set of addresses, for the address objects
 * of a response: contracts (Contract, tokens, Account.type 1), verification
 * and a display name. Names hidden as spam are not returned.
 */
export async function loadAddressFacts(addresses: unknown[]): Promise<Map<string, AddressFacts>> {
  const list = [
    ...new Set(
      addresses
        .filter((address): address is string => typeof address === 'string' && address.length > 0)
        .map((address) => address.toLowerCase())
    ),
  ];
  const facts = new Map<string, AddressFacts>();
  if (list.length === 0) return facts;

  // Records flagged `no-code` are addresses without contract code that an earlier
  // register API stored as tokens or contracts; they are not contracts.
  const withCode = { address: { $in: list }, hiddenReason: { $ne: 'no-code' } };
  const [contracts, tokens, accounts] = (await Promise.all([
    Contract.find(withCode).select('address verified contractName hidden').lean(),
    Token.find(withCode).select('address name hidden').lean(),
    Account.find({ address: { $in: list }, type: 1 })
      .select('address')
      .lean(),
  ])) as [Doc[], Doc[], Doc[]];

  for (const account of accounts) {
    facts.set(String(account.address), { isContract: true, isVerified: false, name: null });
  }
  for (const token of tokens) {
    facts.set(String(token.address), {
      isContract: true,
      isVerified: false,
      name: token.hidden ? null : (token.name as string) || null,
    });
  }
  for (const contract of contracts) {
    const address = String(contract.address);
    facts.set(address, {
      isContract: true,
      isVerified: Boolean(contract.verified),
      name: contract.hidden
        ? null
        : (contract.contractName as string) || facts.get(address)?.name || null,
    });
  }
  return facts;
}

/** Blockscout address object; null for a missing address (contract creation has no `to`). */
export function addressParam(
  hash: unknown,
  facts?: Map<string, AddressFacts>,
  overrides: Partial<AddressFacts> = {}
) {
  if (typeof hash !== 'string' || !hash) return null;
  const address = hash.toLowerCase();
  const known = { ...facts?.get(address), ...overrides };
  return {
    hash: address,
    is_contract: known.isContract ?? false,
    is_verified: known.isVerified ?? false,
    name: known.name ?? null,
    ens_domain_name: null,
    implementations: [],
    is_scam: false,
    metadata: null,
    private_tags: [],
    public_tags: [],
    proxy_type: null,
    reputation: 'ok',
    watchlist_names: [],
    // name used before Blockscout 7, kept for existing clients
    implementation_name: null,
  };
}

// ============================================
// Tokens
// ============================================

/** Blockscout token object from a `tokens` document (or for a token without one). */
export function tokenInfo(address: unknown, token?: Doc | null) {
  const hash = String(address).toLowerCase();
  const holders = token ? String(token.holders ?? 0) : null;
  return {
    address_hash: hash,
    circulating_market_cap: null,
    decimals: token ? String(token.decimals ?? 18) : null,
    exchange_rate: null,
    holders_count: holders,
    icon_url: null,
    name: token && !token.hidden ? (token.name as string) || null : null,
    symbol: token && !token.hidden ? (token.symbol as string) || null : null,
    total_supply: (token?.totalSupply as string | undefined) ?? null,
    type: ercTokenType(token?.type as string | undefined),
    volume_24h: null,
    reputation: 'ok',
    // names used by older Blockscout versions, kept for clients that read either
    address: hash,
    holders,
  };
}

/** Explorer type strings stored for a Blockscout token type (for `type=` filters). */
export function storedTokenTypes(type: string): string[] {
  const digits = type.replace(/\D/g, '');
  if (digits === '721') return ['ERC721', 'ERC-721', 'VRC721', 'VRC-721'];
  if (digits === '1155') return ['ERC1155', 'ERC-1155', 'VRC1155', 'VRC-1155'];
  return [];
}

/** Mongo condition on `tokens.type` for a comma separated Blockscout `type` filter; null for no filter. */
export function tokenTypeFilter(types: string | null): Doc | null {
  if (!types) return null;
  const wanted = new Set(types.split(',').map((type) => ercTokenType(type.trim())));
  if (wanted.size === 0 || wanted.size === 3) return null;
  const nft = [...storedTokenTypes('721'), ...storedTokenTypes('1155')];
  const listed: string[] = [];
  if (wanted.has('ERC-721')) listed.push(...storedTokenTypes('721'));
  if (wanted.has('ERC-1155')) listed.push(...storedTokenTypes('1155'));
  // anything that is not an NFT type counts as ERC-20, like ercTokenType()
  return wanted.has('ERC-20')
    ? { $or: [{ type: { $nin: nft } }, ...(listed.length ? [{ type: { $in: listed } }] : [])] }
    : { type: { $in: listed } };
}

// ============================================
// Transactions
// ============================================

const isoTime = (seconds: unknown) =>
  typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

/** Height of the newest stored block, for `confirmations`. */
export async function headNumber(): Promise<number> {
  const head = (await Block.findOne().sort({ number: -1 }).select('number').lean()) as {
    number?: number;
  } | null;
  return head?.number ?? 0;
}

/**
 * Transactions saved without their own `timestamp` take the time of their
 * block, so a list never reports a mined transaction without a time.
 */
export async function fillTimestamps(txs: Doc[]): Promise<void> {
  const heights = [
    ...new Set(
      txs.filter((tx) => typeof tx.timestamp !== 'number').map((tx) => Number(tx.blockNumber))
    ),
  ].filter((height) => Number.isFinite(height));
  if (heights.length === 0) return;
  const blocks = (await Block.find({ number: { $in: heights } })
    .select('number timestamp')
    .lean()) as Array<{ number: number; timestamp?: number }>;
  const timeByHeight = new Map(blocks.map((block) => [block.number, block.timestamp]));
  for (const tx of txs) {
    if (typeof tx.timestamp !== 'number') tx.timestamp = timeByHeight.get(Number(tx.blockNumber));
  }
}

/**
 * `has_error_in_internal_transactions` of transactions: whether a call inside
 * failed, for transactions the internal transaction indexer has covered
 * (tools/internal-txs.ts), null for the others.
 */
export async function internalErrorFlags(txs: Doc[]): Promise<Map<string, boolean | null>> {
  const flags = new Map<string, boolean | null>();
  if (txs.length === 0) return flags;
  const marker = (await ScanProgress.findOne({ scanType: 'internal-transactions' })
    .select('lastScannedBlock')
    .lean()) as { lastScannedBlock?: number } | null;
  const covered = typeof marker?.lastScannedBlock === 'number' ? marker.lastScannedBlock : -1;
  const hashOf = (tx: Doc) => String(tx.hash).toLowerCase();
  const indexed = txs.filter((tx) => Number(tx.blockNumber) <= covered).map(hashOf);
  const failed = new Set(
    indexed.length > 0
      ? ((await InternalTransaction.distinct('transactionHash', {
          transactionHash: { $in: indexed },
          error: { $ne: null },
        })) as string[])
      : []
  );
  for (const tx of txs) {
    flags.set(hashOf(tx), Number(tx.blockNumber) <= covered ? failed.has(hashOf(tx)) : null);
  }
  return flags;
}

/** Blockscout transaction object from a `Transaction` document. */
export function transactionItem(
  tx: Doc,
  head: number,
  facts?: Map<string, AddressFacts>,
  internalErrors?: Map<string, boolean | null>
) {
  const internalError = internalErrors?.get(String(tx.hash).toLowerCase()) ?? null;
  const input = typeof tx.input === 'string' && tx.input ? tx.input : '0x';
  const height = Number(tx.blockNumber);
  const types = tx.creates
    ? ['contract_creation']
    : input.length > 2
      ? ['contract_call']
      : ['coin_transfer'];
  let fee = '0';
  try {
    if (tx.gasUsed !== undefined && tx.gasUsed !== null && tx.gasPrice) {
      fee = (BigInt(tx.gasUsed as number) * BigInt(tx.gasPrice as string)).toString();
    }
  } catch {
    fee = '0';
  }
  const failed = tx.status === 0;
  return {
    hash: tx.hash,
    block_number: tx.blockNumber,
    timestamp: isoTime(tx.timestamp),
    confirmations: head >= height ? head - height + 1 : 0,
    confirmation_duration: null,
    from: addressParam(tx.from, facts),
    to: addressParam(tx.to, facts),
    created_contract: addressParam(tx.creates, facts, { isContract: true }),
    value: tx.value?.toString() || '0',
    fee: { type: 'actual', value: fee },
    gas_price: tx.gasPrice?.toString() || '0',
    gas_limit: String(tx.gas ?? 0),
    gas_used: tx.gasUsed !== undefined && tx.gasUsed !== null ? String(tx.gasUsed) : null,
    status: failed ? 'error' : 'ok',
    result: failed ? 'error' : 'success',
    method: input.length >= 10 ? input.slice(0, 10) : null,
    transaction_types: types,
    exchange_rate: null,
    historic_exchange_rate: null,
    has_error_in_internal_transactions: internalError,
    actions: [],
    decoded_input: null,
    token_transfers: null,
    token_transfers_overflow: null,
    raw_input: input,
    revert_reason: null,
    nonce: tx.nonce ?? null,
    position: tx.transactionIndex ?? null,
    type: 0,
    max_fee_per_gas: null,
    max_priority_fee_per_gas: null,
    priority_fee: null,
    base_fee_per_gas: null,
    transaction_burnt_fee: null,
    transaction_tag: null,
    authorization_list: [],
    is_pending_update: false,
    // names used before Blockscout 7, kept for existing clients
    block: tx.blockNumber,
    tx_types: types,
    has_error_in_internal_txs: internalError,
    tx_burnt_fee: null,
    tx_tag: null,
  };
}

/** Blockscout token transfer object from a `tokentransfers` document. */
export function tokenTransferItem(
  transfer: Doc,
  token: Doc | null | undefined,
  facts?: Map<string, AddressFacts>
) {
  const isNft = transfer.tokenId !== undefined && transfer.tokenId !== null;
  const isMultiToken = transfer.tokenType === 'VRC-1155';
  const from = String(transfer.from || '').toLowerCase();
  const to = String(transfer.to || '').toLowerCase();
  const info = tokenInfo(transfer.tokenAddress, token);
  const time = transfer.timestamp ? new Date(transfer.timestamp as Date).getTime() : NaN;
  return {
    block_hash: null,
    block_number: Number(transfer.blockNumber),
    from: addressParam(from, facts),
    to: addressParam(to, facts),
    // stored for VRC-20 (since 2026-11) and VRC-1155 transfers; null for VRC-721 and older documents
    log_index: typeof transfer.logIndex === 'number' ? transfer.logIndex : null,
    method: null,
    timestamp: Number.isNaN(time) ? null : new Date(time).toISOString(),
    token: info,
    token_type: info.type,
    total: isMultiToken
      ? {
          decimals: null,
          token_id: String(transfer.tokenId),
          token_instance: null,
          value: transfer.value?.toString() || '0',
        }
      : isNft
        ? { token_id: String(transfer.tokenId), token_instance: null }
        : { decimals: info.decimals, value: transfer.value?.toString() || '0' },
    transaction_hash: transfer.transactionHash,
    type:
      from === ZERO_ADDRESS
        ? 'token_minting'
        : to === ZERO_ADDRESS
          ? 'token_burning'
          : 'token_transfer',
    // name used before Blockscout 7
    tx_hash: transfer.transactionHash,
  };
}

// ============================================
// Internal transactions
// ============================================

/** v2 `type` of an internal transaction: the call type for calls (call, staticcall, ...). */
export function internalTransactionType(doc: Doc): string {
  return doc.type === 'call' ? String(doc.callType || 'call') : String(doc.type);
}

/** Blockscout internal transaction object from an `InternalTransaction` document. */
export function internalTransactionItem(doc: Doc, facts?: Map<string, AddressFacts>) {
  return {
    block_number: doc.blockNumber,
    created_contract: addressParam(doc.createdContract, facts, { isContract: true }),
    error: (doc.error as string | null | undefined) ?? null,
    from: addressParam(doc.from, facts),
    gas_limit: String(doc.gas ?? '0'),
    index: doc.index,
    // false as well below a failed call: nothing the frame did took effect
    success: !doc.reverted,
    timestamp: isoTime(doc.timestamp),
    to: addressParam(doc.to, facts),
    transaction_hash: doc.transactionHash,
    transaction_index: doc.transactionIndex,
    type: internalTransactionType(doc),
    value: String(doc.value ?? '0'),
    // name used before Blockscout 7
    block: doc.blockNumber,
  };
}

/** Position keys Blockscout shows in `next_page_params` of internal transaction lists. */
export const internalTransactionHint = (last: Doc) => ({
  block_number: last.blockNumber,
  transaction_index: last.transactionIndex,
  index: last.index,
});

/** Address objects of a page of internal transactions. */
export function internalTransactionAddresses(docs: Doc[]): unknown[] {
  return docs.flatMap((doc) => [doc.from, doc.to, doc.createdContract]);
}
