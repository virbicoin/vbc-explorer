/**
 * Server-side pagination helpers (NextResponse); the pure parsing lives in
 * validation.ts so it stays browser-safe.
 */

import { NextResponse } from 'next/server';
import type { Pagination } from './validation';
import { getSecurityHeaders } from './validation';

export type PaginationErrorFormat = 'default' | 'v2' | 'etherscan';

/**
 * 400 response for a page that is too deep (`page × limit > maxOffset`), or
 * null when the request may proceed.
 */
export function rejectDeepPagination(
  pagination: Pagination,
  format: PaginationErrorFormat = 'default'
): NextResponse | null {
  if (!pagination.tooDeep) return null;
  const message = `Page too deep: page × limit must not exceed ${pagination.maxOffset}`;
  const body =
    format === 'v2'
      ? { message }
      : format === 'etherscan'
        ? { status: '0', message, result: null }
        : { error: message, maxOffset: pagination.maxOffset };
  return NextResponse.json(body, { status: 400, headers: getSecurityHeaders() });
}
