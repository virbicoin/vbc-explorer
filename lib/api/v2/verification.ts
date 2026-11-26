/**
 * Blockscout v2 contract verification (`/api/v2/smart-contracts/{address}/verification/via/…`):
 * the request body and the answer for each outcome of the shared flow (lib/contract/verify.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSecurityHeaders } from '@/lib/security';
import type { VerificationOutcome } from '@/lib/contract/verify';

/**
 * Fields of a verification request: multipart form fields (an uploaded file is read as text,
 * as Blockscout clients send the standard JSON input as `files[0]`) or a JSON object.
 */
export async function readVerificationBody(request: NextRequest): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    for (const [key, value] of (await request.formData()).entries()) {
      fields[key] = typeof value === 'string' ? value : await value.text();
    }
    return fields;
  }
  const body = (await request.json()) as Record<string, unknown>;
  for (const [key, value] of Object.entries(body ?? {})) {
    if (value === null || value === undefined) continue;
    fields[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return fields;
}

/** A form flag: true for `true` / `1` (JSON booleans arrive here as "true"). */
export const isTrue = (value: string | undefined) => value === 'true' || value === '1';

export function v2Reply(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...getSecurityHeaders(), ...headers } });
}

/** Blockscout's answer for an outcome of the verification flow. */
export function v2VerificationResponse(outcome: VerificationOutcome): NextResponse {
  switch (outcome.status) {
    case 'verified':
      return v2Reply({ message: 'Smart-contract verification started' }, 200);
    case 'already-verified':
      return v2Reply({ message: 'Smart-contract already verified.' }, 400);
    case 'no-code':
      return v2Reply({ message: 'No contract found at this address' }, 404);
    case 'node-unavailable':
      return v2Reply({ message: 'Failed to connect to blockchain node' }, 502);
    case 'compiler-error':
      return v2Reply(
        {
          message: outcome.httpStatus >= 500 ? 'Compiler unavailable' : 'Compilation failed',
          errors: [outcome.message],
        },
        outcome.httpStatus,
        outcome.retryAfter ? { 'Retry-After': String(outcome.retryAfter) } : {}
      );
    case 'compile-errors':
      return v2Reply(
        { message: 'Compilation errors', errors: outcome.errors.map((error) => error.message) },
        400
      );
    case 'contract-not-found':
      return v2Reply(
        {
          message: outcome.contractName
            ? `Contract '${outcome.contractName}' not found in compilation output`
            : 'No contract with runtime code in compilation output',
        },
        400
      );
    case 'mismatch':
      return v2Reply(
        {
          message: 'Bytecode mismatch - verification failed',
          errors: [
            'The compiled runtime code does not match the deployed code (only the metadata may differ)',
          ],
        },
        400
      );
  }
}
