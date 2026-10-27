import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '../../../lib/config';
import { enforceRateLimit } from '@/lib/security/rate-limits';

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const config = loadConfig();

    // Return only the config needed on the client side
    const clientConfig = {
      miners: config.miners,
      explorer: config.explorer,
    };

    return NextResponse.json(clientConfig);
  } catch (error) {
    console.error('Error reading config:', error);
    return NextResponse.json(
      {
        error: 'Failed to load configuration',
        miners: {},
      },
      { status: 500 }
    );
  }
}
