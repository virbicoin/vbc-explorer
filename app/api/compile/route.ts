import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '../../../models/index';

export async function POST(request: NextRequest) {
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

      // Format compiler version for display
      let displayCompilerVersion = Array.isArray(contract)
        ? contract[0]?.compilerVersion
        : contract.compilerVersion;
      if (displayCompilerVersion) {
        // Remove 'v' prefix if present
        if (displayCompilerVersion.startsWith('v')) {
          displayCompilerVersion = displayCompilerVersion.substring(1);
        }
        // If it's 'latest', show a more descriptive version
        if (displayCompilerVersion === 'latest') {
          displayCompilerVersion = 'Latest (0.8.30)';
        }
      } else {
        // Default to 0.8.28 if no compiler version is set
        displayCompilerVersion = '0.8.28';

        // Update the contract in database with default compiler version
        try {
          await Contract.findOneAndUpdate(
            { address: addr.toLowerCase() },
            { compilerVersion: '0.8.28' },
            { new: true }
          );
        } catch (updateError) {
          console.error('Failed to update contract compiler version:', updateError);
        }
      }

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
}
