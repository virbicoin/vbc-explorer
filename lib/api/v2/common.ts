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
  Transaction,
} from '@/models/index';
import { getSecurityHeaders, sanitizeHash, validatePagination } from '@/lib/security';
import { getRewardSchedule } from '@/lib/config';
import { minerRewardWei, transactionFeesWei } from '@/lib/reward-schedule';
import { rejectDeepPagination } from '@/lib/security/pagination';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { getClient } from '@/lib/web3/provider';
import { ercTokenType } from '@/lib/api/token-standard';
import { fullCompilerVersion } from '@/lib/contract/solc-utils';

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
  const covered = await internalIndexHead();
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

/** Highest block the internal transaction indexer has covered; -1 before its first range. */
export async function internalIndexHead(): Promise<number> {
  const marker = (await ScanProgress.findOne({ scanType: 'internal-transactions' })
    .select('lastScannedBlock')
    .lean()) as { lastScannedBlock?: number } | null;
  return typeof marker?.lastScannedBlock === 'number' ? marker.lastScannedBlock : -1;
}

/**
 * Blockscout transaction objects for a page of `Transaction` documents: the address
 * objects, internal error flags and missing timestamps are loaded for the whole page.
 */
export async function transactionItems(txs: Doc[], head?: number) {
  const [facts, internalErrors, tip] = await Promise.all([
    loadAddressFacts(txs.flatMap((tx) => [tx.from, tx.to, tx.creates])),
    internalErrorFlags(txs),
    head ?? headNumber(),
    fillTimestamps(txs),
  ]);
  return txs.map((tx) => transactionItem(tx, tip, facts, internalErrors));
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

/**
 * The balance of an address at a height, from the node through request() (as every node read
 * in the APIs, so that tests can answer it). Old heights need an archive node.
 */
export async function balanceAt(address: string, height: number): Promise<bigint> {
  const hex = await getClient().request({
    method: 'eth_getBalance',
    params: [address as `0x${string}`, `0x${height.toString(16)}`],
  });
  return BigInt(hex as string);
}

/**
 * Blockscout event log object, from a `Log` document or a receipt's log (hex quantities are
 * read too). `topics` always has four entries, null where the event has fewer.
 */
export function logItem(log: Doc, facts?: Map<string, AddressFacts>) {
  const number = (value: unknown) =>
    typeof value === 'string' && value.startsWith('0x') ? Number(BigInt(value)) : Number(value);
  const topics = Array.isArray(log.topics) ? (log.topics as unknown[]) : [];
  return {
    address: addressParam(log.address, facts, { isContract: true }),
    block_hash: log.blockHash ?? null,
    block_number:
      log.blockNumber === undefined || log.blockNumber === null ? null : number(log.blockNumber),
    data: log.data ?? '0x',
    decoded: null,
    index: log.logIndex === undefined || log.logIndex === null ? 0 : number(log.logIndex),
    smart_contract: null,
    topics: [0, 1, 2, 3].map((position) => (topics[position] as string | undefined) ?? null),
    transaction_hash: log.transactionHash ?? null,
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

/**
 * Blockscout's `license_type` for the SPDX identifier stored at verification. Blockscout answers
 * with a fixed set of values and 'none' when no license was given; identifiers outside that set
 * (expressions such as "MIT OR Apache-2.0") are also 'none'.
 */
const BLOCKSCOUT_LICENSES: Record<string, string> = {
  unlicense: 'unlicense',
  mit: 'mit',
  'gpl-2.0': 'gnu_gpl_v2',
  'gpl-3.0': 'gnu_gpl_v3',
  'lgpl-2.1': 'gnu_lgpl_v2_1',
  'lgpl-3.0': 'gnu_lgpl_v3',
  'bsd-2-clause': 'bsd_2_clause',
  'bsd-3-clause': 'bsd_3_clause',
  'mpl-2.0': 'mpl_2_0',
  'osl-3.0': 'osl_3_0',
  'apache-2.0': 'apache_2_0',
  'agpl-3.0': 'gnu_agpl_v3',
  'busl-1.1': 'bsl_1_1',
};

export function blockscoutLicenseType(spdx: unknown): string {
  if (typeof spdx !== 'string') return 'none';
  const id = spdx
    .trim()
    .toLowerCase()
    .replace(/-(only|or-later)$/, '');
  return BLOCKSCOUT_LICENSES[id] ?? 'none';
}

/** Blockscout writes compiler versions in full ("v0.8.28+commit.7893614a"). */
export const blockscoutCompilerVersion = fullCompilerVersion;

// ============================================
// Blocks
// ============================================

/** Query for a block given by height or hash in a path; null when it is neither. */
export function blockCondition(numberOrHash: string): Doc | null {
  if (/^\d{1,15}$/.test(numberOrHash)) return { number: Number(numberOrHash) };
  const hash = sanitizeHash(numberOrHash);
  return hash ? { hash } : null;
}

export interface BlockTotals {
  transactions: number;
  /** Sum of gasUsed × gasPrice over the block's transactions, in wei. */
  fees: bigint;
}

/** Transaction count and fees of each of the given heights, from the stored transactions. */
export async function loadBlockTotals(heights: number[]): Promise<Map<number, BlockTotals>> {
  const totals = new Map(heights.map((height) => [height, { transactions: 0, fees: 0n }]));
  if (heights.length === 0) return totals;
  const txs = (await Transaction.find({ blockNumber: { $in: heights } })
    .select('blockNumber gasUsed gasPrice')
    .lean()) as Array<{ blockNumber: number; gasUsed?: number; gasPrice?: string }>;
  for (const tx of txs) {
    const total = totals.get(tx.blockNumber);
    if (!total) continue;
    total.transactions += 1;
    try {
      total.fees += transactionFeesWei([tx]);
    } catch {
      // a gas price that is not an integer string adds nothing
    }
  }
  return totals;
}

/** Internal transactions stored for a block; null while the indexer has not reached it. */
export async function blockInternalTransactionCount(height: number): Promise<number | null> {
  if ((await internalIndexHead()) < height) return null;
  return InternalTransaction.countDocuments({ blockNumber: height });
}

/** A percentage as Blockscout writes it: a number, without float noise. */
const percentage = (value: number) => Number(value.toFixed(10));

/** The 8-byte PoW nonce as Blockscout writes it, 16 hex digits (the sync stores a decimal string). */
function nonceHex(nonce: unknown): string | null {
  if (typeof nonce !== 'string' || !/^(0x[0-9a-f]+|\d+)$/i.test(nonce)) return null;
  return `0x${BigInt(nonce).toString(16).padStart(16, '0')}`;
}

/**
 * Blockscout block object from a `Block` document.
 *
 * `rewards`: the miner's reward is what consensus credits it (block reward from the
 * configured schedule, the fees not burnt, 1/32 per included uncle), the uncle reward is
 * the stored uncle issuance without that nephew part (absent until it is backfilled).
 * Blockscout names the types on the block page ("Miner Reward", "Uncle Reward") and lists
 * the raw ones ("validator", "uncle"); `single` selects the block page form, which also
 * carries `burnt_fees_percentage` and `internal_transactions_count`.
 */
export function blockItem(
  block: Doc,
  totals: BlockTotals | undefined,
  options: {
    single?: boolean;
    facts?: Map<string, AddressFacts>;
    internalTransactions?: number | null;
  } = {}
) {
  const single = options.single === true;
  const height = Number(block.number);
  const gasUsed = Number(block.gasUsed ?? 0);
  const gasLimit = Number(block.gasLimit ?? 0);
  const fees = totals?.fees ?? 0n;
  const uncles = Array.isArray(block.uncles) ? (block.uncles as string[]) : [];
  const baseFee = typeof block.baseFeePerGas === 'string' ? BigInt(block.baseFeePerGas) : null;
  const burnt = baseFee === null ? 0n : baseFee * BigInt(gasUsed);
  const tips = fees > burnt ? fees - burnt : 0n;

  const rewards: Array<{ reward: string; type: string }> = [];
  if (height > 0) {
    const miner = minerRewardWei(getRewardSchedule(), height, uncles.length, tips);
    rewards.push({ reward: miner.total.toString(), type: single ? 'Miner Reward' : 'validator' });
    if (uncles.length > 0 && typeof block.uncleReward === 'string') {
      const uncleReward = BigInt(block.uncleReward) - miner.uncleInclusionReward;
      if (uncleReward > 0n) {
        rewards.push({ reward: uncleReward.toString(), type: single ? 'Uncle Reward' : 'uncle' });
      }
    }
  }

  return {
    height,
    hash: block.hash,
    parent_hash: block.parentHash,
    timestamp: isoTime(block.timestamp),
    miner: addressParam(block.miner, options.facts),
    size: block.size ?? null,
    nonce: nonceHex(block.nonce),
    difficulty: String(block.difficulty ?? '0'),
    total_difficulty: block.totalDifficulty ? String(block.totalDifficulty) : null,
    gas_limit: String(gasLimit),
    gas_used: String(gasUsed),
    gas_used_percentage: gasLimit > 0 ? percentage((gasUsed / gasLimit) * 100) : 0,
    // against half the limit, as Blockscout computes it whether or not the chain has London
    gas_target_percentage: gasLimit > 0 ? percentage((gasUsed / (gasLimit / 2) - 1) * 100) : null,
    base_fee_per_gas: baseFee === null ? null : baseFee.toString(),
    burnt_fees: burnt.toString(),
    burnt_fees_percentage: single
      ? fees > 0n
        ? percentage(Number((burnt * 10n ** 12n) / fees) / 1e10)
        : 0
      : null,
    priority_fee: (baseFee === null ? 0n : tips).toString(),
    transaction_fees: fees.toString(),
    transactions_count: totals?.transactions ?? 0,
    internal_transactions_count: single ? (options.internalTransactions ?? null) : null,
    uncles_hashes: uncles,
    rewards,
    type: 'block',
    // withdrawals are not indexed
    withdrawals_count: null,
    is_pending_update: false,
    extra_data: block.extraData || '0x',
    state_root: block.stateRoot ?? null,
    transactions_root: block.transactionsRoot ?? null,
    receipts_root: block.receiptRoot ?? null,
    sha3_uncles: block.sha3Uncles ?? null,
    // names used before Blockscout 7, kept for existing clients
    tx_count: totals?.transactions ?? 0,
    tx_fees: fees.toString(),
  };
}

/** Blockscout block objects (list form) for a page of `Block` documents. */
export async function blockListItems(blocks: Doc[]) {
  const [totals, facts] = await Promise.all([
    loadBlockTotals(blocks.map((block) => Number(block.number))),
    loadAddressFacts(blocks.map((block) => block.miner)),
  ]);
  return blocks.map((block) => blockItem(block, totals.get(Number(block.number)), { facts }));
}
