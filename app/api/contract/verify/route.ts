import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/models/index';
import { sanitizeAddress, getSecurityHeaders, isValidContentType } from '@/lib/security';
import { normalizeCompilerVersion } from '@/lib/contract/solc-utils';
import { verifiedMessage, verifySubmission, type VerificationOutcome } from '@/lib/contract/verify';
import { withRateLimit } from '@/lib/security/rate-limits';
import { getCompilerConfig } from '@/lib/config';
import { getWeb3 } from '@/lib/web3/provider';

export const POST = withRateLimit('verify', async (request: NextRequest) => {
  try {
    // Validate content type
    if (!isValidContentType(request)) {
      return NextResponse.json(
        { error: 'Invalid content type. Expected application/json' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Try to connect to DB with timeout
    try {
      await Promise.race([
        connectDB(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database connection timeout')), 10000)
        ),
      ]);
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      return NextResponse.json(
        {
          error: 'Database connection failed',
          details: 'Unable to connect to the database. Please try again later.',
          message: dbError instanceof Error ? dbError.message : 'Unknown database error',
        },
        { status: 503, headers: getSecurityHeaders() }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const { address, sourceCode, standardJsonInput, compilerVersion, contractName, optimization } =
      body;

    // Enhanced validation with detailed error messages
    // Either sourceCode OR standardJsonInput is required
    const missingFields = [];
    if (!address) missingFields.push('address');
    if (!sourceCode && !standardJsonInput) missingFields.push('sourceCode or standardJsonInput');
    if (!compilerVersion) missingFields.push('compilerVersion');

    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return NextResponse.json(
        {
          error: `Missing required fields: ${missingFields.join(', ')}`,
          receivedData: {
            hasAddress: !!address,
            hasSourceCode: !!sourceCode,
            hasStandardJsonInput: !!standardJsonInput,
            hasCompilerVersion: !!compilerVersion,
            hasContractName: !!contractName,
            hasOptimization: optimization !== undefined,
          },
        },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate address format using security module
    const sanitizedAddress = sanitizeAddress(address);
    if (!sanitizedAddress) {
      return NextResponse.json(
        {
          error:
            'Invalid contract address format. Must be a 42-character hex string starting with 0x.',
        },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate source code or standardJsonInput is not empty and not too large (max 500KB)
    const MAX_SOURCE_SIZE = 500 * 1024; // 500KB
    const inputToValidate = standardJsonInput || sourceCode;
    if (inputToValidate.trim().length === 0) {
      return NextResponse.json(
        { error: 'Source code or Standard JSON Input cannot be empty' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }
    if (inputToValidate.length > MAX_SOURCE_SIZE) {
      return NextResponse.json(
        { error: `Source code too large. Maximum size is ${MAX_SOURCE_SIZE / 1024}KB` },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Check if using Standard JSON Input mode
    const isStandardJsonInput = Boolean(standardJsonInput);
    const submittedSource: string = isStandardJsonInput ? standardJsonInput : sourceCode;
    let input: Record<string, unknown>;
    if (isStandardJsonInput) {
      try {
        input = JSON.parse(standardJsonInput);
      } catch {
        return NextResponse.json(
          { error: 'Invalid Standard JSON Input format' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
    } else {
      // A single file, compiled exactly as submitted. Its source unit is named after the contract
      // (the given name or the last contract in the file), as this page always did.
      const declared = [...submittedSource.matchAll(/contract\s+([A-Za-z0-9_]+)/g)].pop()?.[1];
      const unitName = (contractName && String(contractName).split(':').pop()) || declared;
      if (!unitName) {
        return NextResponse.json(
          { error: 'No contract found in source code. Please provide a contract name.' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
      input = {
        language: 'Solidity',
        sources: { [unitName]: { content: submittedSource } },
        settings: {
          optimizer: { enabled: Boolean(optimization), runs: body.optimizationRuns || 200 },
          evmVersion: body.evmVersion || getCompilerConfig().defaultEvmVersion || undefined,
          // Hardhat's defaults
          metadata: { bytecodeHash: 'ipfs', useLiteralContent: false },
          viaIR: false,
        },
      };
    }

    const outcome = await verifySubmission(
      {
        address: sanitizedAddress,
        // any release on binaries.soliditylang.org (the compiler cache refuses anything else)
        compilerVersion: normalizeCompilerVersion(compilerVersion),
        input,
        // without a name, the contract whose code matches is found among all of them
        contractName: contractName || undefined,
        source: submittedSource,
      },
      { getCode: (target) => getWeb3().eth.getCode(target) }
    );
    return verificationResponse(outcome);
  } catch (error) {
    console.error('Contract verification error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
});

/** This page's answer for an outcome of the verification flow (lib/contract/verify.ts). */
function verificationResponse(outcome: VerificationOutcome): NextResponse {
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { ...getSecurityHeaders(), ...headers } });
  switch (outcome.status) {
    case 'verified':
      return reply({
        verified: true,
        contract: outcome.record,
        message: verifiedMessage(outcome.match),
      });
    case 'already-verified':
      return reply(
        {
          verified: false,
          alreadyVerified: true,
          error: 'Contract source code already verified',
          message: 'Contract source code already verified',
        },
        409
      );
    case 'no-code':
      return reply({ error: 'No contract found at this address' }, 404);
    case 'node-unavailable':
      return reply(
        {
          error: 'Failed to connect to blockchain node',
          details: 'Please check the WEB3_PROVIDER_URL configuration',
        },
        502
      );
    case 'compiler-error':
      return reply(
        {
          error: outcome.httpStatus >= 500 ? 'Compiler unavailable' : 'Compilation failed',
          code: outcome.code,
          details: { message: outcome.message },
          message:
            outcome.httpStatus >= 500
              ? 'The compiler could not run right now. Please try again later.'
              : 'The source code could not be compiled. Please check the compiler version and the syntax and try again.',
        },
        outcome.httpStatus,
        outcome.retryAfter ? { 'Retry-After': String(outcome.retryAfter) } : {}
      );
    case 'compile-errors':
      return reply(
        {
          error: 'Compilation errors',
          details: outcome.errors,
          message: `Found ${outcome.errors.length} compilation error(s). Please fix the issues and try again.`,
        },
        400
      );
    case 'contract-not-found':
      return reply(
        {
          error: 'Contract not found in compilation output',
          message: outcome.contractName
            ? `The contract '${outcome.contractName}' was not found in the compilation output. Please check the contract name and try again.`
            : 'The compilation output has no contract with runtime code.',
        },
        400
      );
    case 'mismatch': {
      const { evmVersion, optimization, optimizationRuns } = outcome.settings;
      return reply({
        verified: false,
        message: 'Bytecode mismatch - verification failed',
        details: {
          note: `Compiled with solc ${outcome.compilerVersion} (EVM: ${evmVersion}, optimizer: ${optimization ? `enabled, ${optimizationRuns} runs` : 'disabled'}). Only the metadata may differ from the deployed code.`,
        },
      });
    }
  }
}
