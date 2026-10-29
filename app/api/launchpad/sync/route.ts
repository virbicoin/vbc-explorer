/**
 * /api/launchpad/sync
 *
 * GET  — read-only: when the Launchpad factories were last synchronised with
 *        the `tokens` collection and what that run did. Never writes.
 * POST — manual synchronisation (imports factory tokens missing from the DB,
 *        values from the chain only). `write` rate bucket plus a 60 s
 *        cooldown shared with the periodic run in tools/tokens.ts (429 when
 *        a sync finished less than a minute ago or one is still running).
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../models/index';
import { loadConfig } from '../../../../lib/config';
import { getSecurityHeaders } from '../../../../lib/security/validation';
import { enforceRateLimit, withRateLimit } from '@/lib/security/rate-limits';
import { FactoryRpcError, getLaunchpadFactories } from '@/lib/launchpad/factory';
import {
  LAUNCHPAD_SYNC_COOLDOWN_MS,
  getLaunchpadSyncStatus,
  syncLaunchpadTokens,
} from '@/lib/launchpad/sync';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** A sync started through this API and not finished yet (per process). */
let manualSyncInFlight: Promise<unknown> | null = null;

function factoriesForResponse() {
  return getLaunchpadFactories(loadConfig()).map((f) => ({
    address: f.address,
    legacy: f.legacy,
    ...(f.version ? { version: f.version } : {}),
  }));
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    await connectDB();
    const factories = factoriesForResponse();
    const status = await getLaunchpadSyncStatus();
    return NextResponse.json(
      {
        success: true,
        configured: factories.length > 0,
        factories,
        lastSyncAt: status.lastSyncAt ? status.lastSyncAt.toISOString() : null,
        lastResult: status.lastResult,
        cooldownSeconds: LAUNCHPAD_SYNC_COOLDOWN_MS / 1000,
        message:
          'Read-only status. Tokens are imported periodically by the tokens tool; POST here to run a sync now.',
      },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    logger.error('Launchpad sync status failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to read sync status' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}

export const POST = withRateLimit('write', async (request: NextRequest) => {
  const factories = factoriesForResponse();
  if (factories.length === 0) {
    return NextResponse.json(
      { success: false, error: 'TokenFactory not configured' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  try {
    await connectDB();

    if (manualSyncInFlight) {
      return NextResponse.json(
        { success: false, error: 'A sync is already running', retryAfter: 15 },
        { status: 429, headers: { ...getSecurityHeaders(), 'Retry-After': '15' } }
      );
    }
    const status = await getLaunchpadSyncStatus();
    if (status.lastSyncAt) {
      const elapsed = Date.now() - status.lastSyncAt.getTime();
      if (elapsed >= 0 && elapsed < LAUNCHPAD_SYNC_COOLDOWN_MS) {
        const retryAfter = Math.max(1, Math.ceil((LAUNCHPAD_SYNC_COOLDOWN_MS - elapsed) / 1000));
        return NextResponse.json(
          {
            success: false,
            error: 'Sync ran less than a minute ago',
            lastSyncAt: status.lastSyncAt.toISOString(),
            retryAfter,
          },
          { status: 429, headers: { ...getSecurityHeaders(), 'Retry-After': String(retryAfter) } }
        );
      }
    }

    const run = syncLaunchpadTokens();
    manualSyncInFlight = run;
    let result;
    try {
      result = await run;
    } finally {
      manualSyncInFlight = null;
    }
    const { tokens, ...summary } = result;
    return NextResponse.json(
      {
        success: true,
        message: `Sync completed: ${result.registered} registered, ${result.updated} updated, ${result.unchanged} unchanged, ${result.errors} errors`,
        results: { ...summary, tokens: tokens.filter((t) => t.status !== 'unchanged') },
      },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    if (error instanceof FactoryRpcError) {
      return NextResponse.json(
        { success: false, error: 'Blockchain node unavailable, retry later' },
        { status: 503, headers: { ...getSecurityHeaders(), 'Retry-After': '15' } }
      );
    }
    logger.error('Launchpad manual sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to sync tokens' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
});
