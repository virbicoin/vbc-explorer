/**
 * Launchpad token registration and factory synchronisation (DB side).
 *
 * `registerFactoryToken()` writes a token the factory vouches for (see
 * lib/launchpad/factory.ts) with chain values only; `syncLaunchpadTokens()`
 * imports the difference between the factories' `getAllTokens()` and the
 * `tokens` collection. The sync runs periodically from tools/tokens.ts and on
 * demand from `POST /api/launchpad/sync`; its last result is kept in
 * `scan_progress` (`scanType: 'launchpad-sync'`) for the read-only GET.
 */

import { connectDB, ScanProgress, Token, TokenHolder } from '../../models/index';
import { hiddenFields } from '../security/display-name';
import { logger } from '../logger';
import {
  ZERO_ADDRESS,
  createWeb3FactoryClient,
  describeFactoryToken,
  getLaunchpadFactories,
  hasContractCode,
  listFactoryTokens,
  readBalanceOf,
  type FactoryClient,
  type FactorySource,
  type FactoryTokenInfo,
} from './factory';

export const LAUNCHPAD_SYNC_SCAN_TYPE = 'launchpad-sync';
/** Minimum spacing between two syncs triggered through the API. */
export const LAUNCHPAD_SYNC_COOLDOWN_MS = 60_000;

export interface PublicLaunchpadToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  type: string;
  creator: string | null;
  factory: string | null;
  factoryVerified: boolean;
  createdAt: string | null;
  hidden: boolean;
}

/** `skipped`: the factory lists the address but no contract code is deployed there. */
export type RegistrationStatus = 'created' | 'updated' | 'unchanged' | 'skipped';

export interface LaunchpadSyncResult {
  factories: number;
  total: number;
  registered: number;
  updated: number;
  unchanged: number;
  /** Factory entries without contract code (nothing written). */
  skipped: number;
  errors: number;
  tokens: Array<{ address: string; symbol: string; status: RegistrationStatus | 'error' }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface LaunchpadSyncStatus {
  lastSyncAt: Date | null;
  lastResult: Omit<LaunchpadSyncResult, 'tokens'> | null;
}

interface StoredToken {
  address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  type?: string;
  createdBy?: string | null;
  source?: string | null;
  factory?: string | null;
  factoryVerified?: boolean;
  createdAt?: Date;
  hidden?: boolean;
}

export function toPublicToken(doc: StoredToken): PublicLaunchpadToken {
  return {
    address: doc.address,
    name: doc.name ?? '',
    symbol: doc.symbol ?? '',
    decimals: Number(doc.decimals ?? 18),
    totalSupply: String(doc.totalSupply ?? '0'),
    type: doc.type ?? 'VRC-20',
    creator: doc.createdBy ?? null,
    factory: doc.factory ?? null,
    factoryVerified: doc.factoryVerified === true,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    hidden: doc.hidden === true,
  };
}

/**
 * Persist a factory-vouched token. Existing documents are only marked as
 * factory-verified (names, supply and holders are maintained by the token
 * scanner); new documents take every value from the chain, and the creator's
 * real `balanceOf()` becomes the first holder row.
 */
export async function registerFactoryToken(
  info: FactoryTokenInfo,
  client: FactoryClient
): Promise<{ status: RegistrationStatus; token: PublicLaunchpadToken }> {
  await connectDB();
  const existing = (await Token.findOne({ address: info.address }).lean()) as StoredToken | null;
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (existing.factoryVerified !== true) patch.factoryVerified = true;
    if (existing.factory !== info.factory) patch.factory = info.factory;
    if (!existing.createdBy && info.creator !== ZERO_ADDRESS) patch.createdBy = info.creator;
    if (!existing.source) patch.source = 'launchpad';
    if (Object.keys(patch).length === 0)
      return { status: 'unchanged', token: toPublicToken(existing) };
    await Token.updateOne({ address: info.address }, { $set: patch });
    return { status: 'updated', token: toPublicToken({ ...existing, ...patch }) };
  }

  // Never create a record for an address without contract code (an externally
  // owned account, a deployment that is not mined yet, a self-destructed
  // contract). The old registration API did exactly that and left "Unknown"
  // tokens behind; those are hidden by `flag-spam-tokens --audit-code`.
  if (!(await hasContractCode(client, info.address))) {
    logger.warn('Launchpad token not registered: no contract code at the address', {
      address: info.address,
      factory: info.factory,
    });
    return {
      status: 'skipped',
      token: toPublicToken({
        address: info.address,
        name: info.name,
        symbol: info.symbol,
        decimals: info.decimals,
        totalSupply: info.totalSupply,
        type: 'VRC-20',
        createdBy: info.creator !== ZERO_ADDRESS ? info.creator : null,
        source: 'launchpad',
        factory: info.factory,
        factoryVerified: true,
        createdAt: info.createdAt ?? undefined,
        hidden: false,
      }),
    };
  }

  const creatorBalance =
    info.creator !== ZERO_ADDRESS ? await readBalanceOf(client, info.address, info.creator) : 0n;
  const supply = BigInt(info.totalSupply || '0');
  const now = new Date();
  const doc: Record<string, unknown> = {
    address: info.address,
    name: info.name,
    symbol: info.symbol,
    decimals: info.decimals,
    totalSupply: info.totalSupply,
    supply: info.totalSupply,
    holders: creatorBalance > 0n ? 1 : 0,
    type: 'VRC-20',
    verified: false,
    createdAt: info.createdAt ?? now,
    updatedAt: now,
    createdBy: info.creator !== ZERO_ADDRESS ? info.creator : null,
    source: 'launchpad',
    factory: info.factory,
    factoryVerified: true,
    logoUrl: info.logoUrl,
    ...hiddenFields({ name: info.name, symbol: info.symbol, logoUrl: info.logoUrl }),
  };
  if (info.logoUrl || info.description || info.website) {
    doc.metadata = {
      ...(info.logoUrl ? { logoUrl: info.logoUrl } : {}),
      ...(info.description ? { description: info.description } : {}),
      ...(info.website ? { website: info.website } : {}),
    };
  }
  // $setOnInsert keeps a concurrent registration of the same address idempotent
  await Token.updateOne({ address: info.address }, { $setOnInsert: doc }, { upsert: true });

  if (creatorBalance > 0n) {
    const percentage = supply > 0n ? Number((creatorBalance * 10_000n) / supply) / 100 : 100;
    await TokenHolder.updateOne(
      { tokenAddress: info.address, holderAddress: info.creator },
      { $set: { balance: creatorBalance.toString(), rank: 1, percentage } },
      { upsert: true }
    );
  }

  logger.info('Launchpad token registered', {
    address: info.address,
    symbol: info.symbol,
    factory: info.factory,
    creator: info.creator,
    hidden: doc.hidden === true,
  });
  return { status: 'created', token: toPublicToken(doc as unknown as StoredToken) };
}

export interface SyncLaunchpadOptions {
  client?: FactoryClient;
  factories?: FactorySource[];
}

/** Import every factory token that the `tokens` collection does not know yet. */
export async function syncLaunchpadTokens(
  options: SyncLaunchpadOptions = {}
): Promise<LaunchpadSyncResult> {
  await connectDB();
  const client = options.client ?? createWeb3FactoryClient();
  const factories = options.factories ?? getLaunchpadFactories();
  const startedAt = new Date();
  const result: LaunchpadSyncResult = {
    factories: factories.length,
    total: 0,
    registered: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    tokens: [],
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    durationMs: 0,
  };

  for (const factory of factories) {
    let addresses: string[];
    try {
      addresses = await listFactoryTokens(client, factory.address);
    } catch (error) {
      result.errors += 1;
      logger.warn('Launchpad sync: factory token list failed', {
        factory: factory.address,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const address of addresses) {
      result.total += 1;
      try {
        const info = await describeFactoryToken(client, factory, address);
        const { status, token } = await registerFactoryToken(info, client);
        if (status === 'created') result.registered += 1;
        else if (status === 'updated') result.updated += 1;
        else if (status === 'skipped') result.skipped += 1;
        else result.unchanged += 1;
        result.tokens.push({ address, symbol: token.symbol, status });
      } catch (error) {
        result.errors += 1;
        result.tokens.push({ address, symbol: '', status: 'error' });
        logger.warn('Launchpad sync: token import failed', {
          factory: factory.address,
          address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const finishedAt = new Date();
  result.finishedAt = finishedAt.toISOString();
  result.durationMs = finishedAt.getTime() - startedAt.getTime();
  const { tokens: _tokens, ...summary } = result;
  await ScanProgress.updateOne(
    { scanType: LAUNCHPAD_SYNC_SCAN_TYPE },
    { $set: { lastUpdateTime: finishedAt, meta: summary }, $setOnInsert: { lastScannedBlock: 0 } },
    { upsert: true }
  );
  logger.info('Launchpad sync finished', summary);
  return result;
}

/** When the factories were last synchronised and what that run did (read-only). */
export async function getLaunchpadSyncStatus(): Promise<LaunchpadSyncStatus> {
  await connectDB();
  const doc = (await ScanProgress.findOne({ scanType: LAUNCHPAD_SYNC_SCAN_TYPE }).lean()) as {
    lastUpdateTime?: Date;
    meta?: Omit<LaunchpadSyncResult, 'tokens'> | null;
  } | null;
  return {
    lastSyncAt: doc?.lastUpdateTime ? new Date(doc.lastUpdateTime) : null,
    lastResult: doc?.meta ?? null,
  };
}
