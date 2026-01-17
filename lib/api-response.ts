/**
 * Standardized API Response Utilities
 *
 * Provides consistent response formats across all API endpoints.
 */

import { NextResponse } from 'next/server';

// Standard pagination metadata
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Standard success response with data
export interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: PaginationMeta;
    timestamp?: number;
  };
}

// Standard error response
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Error codes
export const ErrorCodes = {
  RATE_LIMIT: 'RATE_LIMIT_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_PARAM: 'INVALID_PARAMETER',
  INTERNAL: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  BAD_REQUEST: 'BAD_REQUEST',
  DB_ERROR: 'DATABASE_ERROR',
} as const;

/**
 * Create a paginated success response
 */
export function paginatedResponse<T>(
  data: T[],
  pagination: { page: number; limit: number; total: number },
  status = 200
): NextResponse<ApiSuccessResponse<T[]>> {
  return NextResponse.json(
    {
      data,
      meta: {
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
          totalPages: Math.ceil(pagination.total / pagination.limit),
        },
        timestamp: Date.now(),
      },
    },
    { status }
  );
}

/**
 * Create a success response (non-paginated)
 */
export function successResponse<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    {
      data,
      meta: {
        timestamp: Date.now(),
      },
    },
    { status }
  );
}

/**
 * Create an error response
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined && { details }),
      },
    },
    { status }
  );
}

/**
 * Create a rate limit error response
 */
export function rateLimitResponse(retryAfter?: number): NextResponse<ApiErrorResponse> {
  const response = errorResponse(
    ErrorCodes.RATE_LIMIT,
    'Rate limit exceeded. Please try again later.',
    429,
    retryAfter ? { retryAfter } : undefined
  );
  if (retryAfter) {
    response.headers.set('Retry-After', String(retryAfter));
  }
  return response;
}

/**
 * Create a not found error response
 */
export function notFoundResponse(resource: string): NextResponse<ApiErrorResponse> {
  return errorResponse(ErrorCodes.NOT_FOUND, `${resource} not found`, 404);
}

/**
 * Create an invalid parameter error response
 */
export function invalidParamResponse(
  param: string,
  reason?: string
): NextResponse<ApiErrorResponse> {
  return errorResponse(
    ErrorCodes.INVALID_PARAM,
    `Invalid parameter: ${param}${reason ? `. ${reason}` : ''}`,
    400
  );
}

/**
 * Create an internal error response
 */
export function internalErrorResponse(
  message = 'An internal error occurred'
): NextResponse<ApiErrorResponse> {
  return errorResponse(ErrorCodes.INTERNAL, message, 500);
}

// Contract type constants for consistent display
export const ContractTypes = {
  VRC20: 'VRC-20',
  VRC721: 'VRC-721',
  VRC1155: 'VRC-1155',
  VRC223: 'VRC-223',
  CONTRACT: 'Contract',
} as const;

export type ContractType = (typeof ContractTypes)[keyof typeof ContractTypes];

/**
 * Normalize contract/token type to consistent format
 * Converts various formats (ERC20, erc-20, VRC20, etc.) to VRC-XX
 */
export function normalizeContractType(type?: string | null, erc?: number | null): ContractType {
  // Convert ERC number to type
  if (typeof erc === 'number') {
    switch (erc) {
      case 2:
      case 20:
        return ContractTypes.VRC20;
      case 3:
      case 223:
        return ContractTypes.VRC223;
      case 721:
        return ContractTypes.VRC721;
      case 1155:
        return ContractTypes.VRC1155;
    }
  }

  // Normalize string type
  if (type) {
    const normalized = type.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (normalized === 'ERC20' || normalized === 'VRC20' || normalized === 'TOKEN') {
      return ContractTypes.VRC20;
    }
    if (normalized === 'ERC223' || normalized === 'VRC223') {
      return ContractTypes.VRC223;
    }
    if (normalized === 'ERC721' || normalized === 'VRC721' || normalized === 'NFT') {
      return ContractTypes.VRC721;
    }
    if (normalized === 'ERC1155' || normalized === 'VRC1155') {
      return ContractTypes.VRC1155;
    }
  }

  return ContractTypes.CONTRACT;
}

// Legacy response format helpers for backwards compatibility
// These wrap the new format in the old structure

/**
 * Create legacy paginated response (for backwards compatibility)
 * @deprecated Use paginatedResponse instead
 */
export function legacyPaginatedResponse<T>(
  dataKey: string,
  data: T[],
  pagination: { page: number; limit: number; total: number }
): NextResponse {
  return NextResponse.json({
    [dataKey]: data,
    total: pagination.total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(pagination.total / pagination.limit),
  });
}
