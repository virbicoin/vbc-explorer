/**
 * GET /api/contract/compiler-versions — the solc releases contract verification can use (list.json
 * `releases` of binaries.soliditylang.org, newest first, limited to compiler.allowedVersions).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { listReleaseVersions } from '@/lib/contract/compiler-cache';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { getSecurityHeaders } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;
  try {
    const versions = await listReleaseVersions();
    return NextResponse.json(
      { versions },
      { headers: { ...getSecurityHeaders(), 'Cache-Control': 'public, max-age=3600' } }
    );
  } catch (error) {
    console.error('Failed to list compiler releases:', error);
    return NextResponse.json(
      { versions: [], error: 'The compiler release list is unavailable' },
      { status: 503, headers: { ...getSecurityHeaders(), 'Retry-After': '60' } }
    );
  }
}
