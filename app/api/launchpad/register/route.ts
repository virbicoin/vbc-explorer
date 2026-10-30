/**
 * POST /api/launchpad/register — register a Launchpad token in the explorer DB.
 *
 * The only input is `tokenAddress`. Registration succeeds solely when one of
 * the configured TokenFactory contracts vouches for the address
 * (`isFactoryToken` / `getAllTokens`, see lib/launchpad/factory.ts); creator,
 * name, symbol, decimals, supply, creation time and metadata are read from the
 * chain, never from the request body. An address without contract code
 * (`eth_getCode` empty: an EOA, an unmined deployment, a self-destructed
 * contract) gets 404 `NO_CODE` before anything else is looked at, even when
 * a stale record exists for it. Unknown tokens get 404 `NOT_FACTORY_TOKEN`; a
 * token that is already registered gets 200 with the stored record
 * (idempotent).
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Token } from '../../../../models/index';
import { getSecurityHeaders } from '../../../../lib/security/validation';
import { withRateLimit } from '@/lib/security/rate-limits';
import {
  FactoryRpcError,
  createWeb3FactoryClient,
  hasContractCode,
  isHexAddress,
  resolveFactoryToken,
} from '@/lib/launchpad/factory';
import { registerFactoryToken, toPublicToken } from '@/lib/launchpad/sync';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const POST = withRateLimit('write', async (request: NextRequest) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  const tokenAddress = (body as { tokenAddress?: unknown } | null)?.tokenAddress;
  if (!tokenAddress) {
    return NextResponse.json(
      { error: 'Token address is required' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }
  if (!isHexAddress(tokenAddress)) {
    return NextResponse.json(
      { error: 'Invalid token address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }
  const address = tokenAddress.toLowerCase();

  try {
    await connectDB();
    const client = createWeb3FactoryClient();

    // No contract code, no token: this is checked before the DB lookup so a
    // stale record (the old API registered creator EOAs as "Unknown" tokens)
    // never turns into a 200. Those records are hidden by
    // `flag-spam-tokens --audit-code`.
    if (!(await hasContractCode(client, address))) {
      logger.info('Launchpad registration refused: no contract code at the address', { address });
      return NextResponse.json(
        { error: 'No contract code at this address', code: 'NO_CODE', address },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    const existing = await Token.findOne({ address }).lean();
    if (existing) {
      return NextResponse.json(
        {
          success: true,
          message: 'Token already registered',
          token: toPublicToken(existing as Parameters<typeof toPublicToken>[0]),
        },
        { headers: getSecurityHeaders() }
      );
    }

    const info = await resolveFactoryToken(address, { client });
    if (!info) {
      logger.info('Launchpad registration refused: no factory knows the token', { address });
      return NextResponse.json(
        {
          error: 'Token is not known to any Launchpad factory',
          code: 'NOT_FACTORY_TOKEN',
          address,
        },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    const { status, token } = await registerFactoryToken(info, client);
    return NextResponse.json(
      {
        success: true,
        message:
          status === 'created' ? 'Token registered successfully' : 'Token already registered',
        token,
      },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    if (error instanceof FactoryRpcError) {
      logger.warn('Launchpad registration: node unavailable', { address, error: error.message });
      return NextResponse.json(
        { error: 'Blockchain node unavailable, retry later' },
        { status: 503, headers: { ...getSecurityHeaders(), 'Retry-After': '15' } }
      );
    }
    logger.error('Launchpad registration failed', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to register token' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
});
