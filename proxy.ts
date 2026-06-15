import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Security Proxy
 *
 * Adds security headers to all responses and handles basic request validation.
 * Also handles address type redirects for contracts and tokens.
 * Note: In Next.js 16+, middleware has been renamed to proxy.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Handle /address/[address] redirects to /contract/ or /token/
  if (pathname.startsWith('/address/')) {
    const parts = pathname.split('/');
    // Only redirect for /address/[address] (exactly 3 parts: '', 'address', '[address]')
    if (parts.length === 3) {
      const address = parts[2];

      // Validate address format
      if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
        try {
          // Use the lightweight type-check API. Bound it with a short timeout:
          // the type check connects to MongoDB, so a slow or unreachable DB
          // must not be allowed to hang the /address page. On timeout we abort
          // and fall through to render the page normally (no redirect).
          const baseUrl = request.nextUrl.origin;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);
          try {
            const typeResponse = await fetch(`${baseUrl}/api/address/${address}/type`, {
              headers: { Accept: 'application/json' },
              signal: controller.signal,
            });

            if (typeResponse.ok) {
              const typeData = await typeResponse.json();

              if (typeData.type === 'token') {
                // Redirect to token page
                return NextResponse.redirect(new URL(`/token/${address}`, request.url));
              }

              if (typeData.type === 'contract') {
                // Redirect to contract page
                return NextResponse.redirect(new URL(`/contract/${address}`, request.url));
              }
            }
          } finally {
            clearTimeout(timeout);
          }
        } catch (error) {
          // If the type check fails or times out, let the page render.
          console.error('Proxy redirect error:', error);
        }
      }
    }
  }

  // Get response
  const response = NextResponse.next();

  // Add security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HTTPS upgrade in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content Security Policy for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }

  return response;
}

// Apply middleware to all routes except static files
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|img/).*)',
  ],
};
