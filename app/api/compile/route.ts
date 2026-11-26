/**
 * POST /api/compile — despite its name this route does not compile anything.
 * `action: 'find'` returns the stored verification data of a contract (read only: the compiler
 * version is null when none was recorded); `action: 'compile'` is a stub kept for API
 * compatibility.
 * Solidity is compiled only by lib/contract/compile-worker.ts through the
 * verification routes (/api/contract/verify, /api/v2/..., Etherscan API).
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '../../../models/index';
import { withRateLimit } from '@/lib/security/rate-limits';

export const POST = withRateLimit('verify', async (request: NextRequest) => {
  try {
    await connectDB();

    const body = await request.json();
    const { addr, action } = body;

    if (action === 'find') {
      // Find contract in database
      const contract = await Contract.findOne({
        address: addr.toLowerCase(),
      }).lean();

      if (!contract) {
        return NextResponse.json({
          valid: false,
          message: 'Contract not found',
        });
      }

      // Stored compiler version without the 'v' prefix; null when none was recorded. Nothing is
      // written here: a missing version used to be filled in with '0.8.28' (and 'latest' shown as
      // 0.8.30), which recorded a compiler nobody had verified with.
      const storedCompilerVersion: string | undefined = Array.isArray(contract)
        ? contract[0]?.compilerVersion
        : contract.compilerVersion;
      const displayCompilerVersion = storedCompilerVersion
        ? storedCompilerVersion.replace(/^v/, '')
        : null;

      const contractData = Array.isArray(contract) ? contract[0] : contract;
      return NextResponse.json({
        valid: contractData.verified || false,
        contractName: contractData.contractName || 'Unknown',
        compilerVersion: displayCompilerVersion,
        optimization: contractData.optimization || false,
        sourceCode: contractData.sourceCode || '',
        abi: contractData.abi || '',
        address: contractData.address,
      });
    }

    if (action === 'compile') {
      // This would handle contract compilation
      // For now, return a basic response
      return NextResponse.json({
        valid: false,
        message: 'Compilation endpoint not fully implemented',
      });
    }

    return NextResponse.json({
      error: 'Invalid action',
      valid: false,
    });
  } catch (error) {
    console.error('Compile endpoint error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        valid: false,
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});
