/**
 * POST /api/launchpad/register — register a Launchpad token in the explorer DB.
 *
 * The only input is `tokenAddress`. Registration succeeds solely when one of
 * the configured TokenFactory contracts vouches for the address
 * (`isFactoryToken` / `getAllTokens`, see lib/launchpad/factory.ts); creator,
 * name, symbol, decimals, supply, creation time and metadata are read from the
 * chain, never from the request body. Unknown tokens get 404, a token that is
 * already registered gets 200 with the stored record (idempotent).
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Token } from '../../../../models/index';
import { getSecurityHeaders } from '../../../../lib/security/validation';
import { withRateLimit } from '@/lib/security/rate-limits';
import { FactoryRpcError, isHexAddress, resolveFactoryToken } from '@/lib/launchpad/factory';
import { createWeb3FactoryClient } from '@/lib/launchpad/factory';
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

    const client = createWeb3FactoryClient();
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
