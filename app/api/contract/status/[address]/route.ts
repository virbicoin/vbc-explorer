import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract, Transaction } from '../../../../../models/index';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { spdxLicense } from '@/lib/contract/solc-utils';
import { getCode } from '@/lib/web3/provider';

// Function to read config

// The shared node connection (lib/web3/provider.ts)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    await connectDB();
    const { address } = await params;

    if (!address) {
      return NextResponse.json({ error: 'Contract address is required' }, { status: 400 });
    }

    // Get bytecode from blockchain
    let bytecode = '';
    try {
      bytecode = await getCode(address);
    } catch {
      // ignore
    }

    // Find contract creation transaction from Transaction collection
    let creationTxData: { hash?: string; from?: string; blockNumber?: number } | null = null;
    try {
      const creationTx = await Transaction.findOne({
        creates: address.toLowerCase(),
      }).lean();

      if (creationTx) {
        const txDoc = Array.isArray(creationTx) ? creationTx[0] : creationTx;
        creationTxData = {
          hash: (txDoc as Record<string, unknown>).hash as string,
          from: (txDoc as Record<string, unknown>).from as string,
          blockNumber: (txDoc as Record<string, unknown>).blockNumber as number,
        };
      }
    } catch {
      // ignore
    }

    // Find contract in database (case-insensitive search)
    const contract = await Contract.findOne({
      address: address.toLowerCase(),
    }).lean();

    const contractDoc = Array.isArray(contract) ? contract[0] : contract;

    if (!contractDoc) {
      return NextResponse.json({
        verified: false,
        message: 'Contract not found in database',
        address: address,
        byteCode: bytecode || null,
        // Include creation info from transaction if available
        creationTransaction: creationTxData?.hash || null,
        creator: creationTxData?.from || null,
        blockNumber: creationTxData?.blockNumber || null,
      });
    }

    // Extract license from source code if not stored in DB (spdxLicense() reads the files of a
    // standard JSON input, so escaped newlines no longer end up in the identifier)
    let license = ((contractDoc as Record<string, unknown>).license as string) || '';
    if ((!license || license === 'None') && contractDoc.sourceCode) {
      license = spdxLicense(contractDoc.sourceCode, contractDoc.contractName) ?? license;
    }

    return NextResponse.json({
      verified: contractDoc.verified || false,
      contractName: contractDoc.contractName,
      compilerVersion: contractDoc.compilerVersion,
      optimization: contractDoc.optimization,
      // null for records verified before the settings were stored (no guessed 200)
      optimizationRuns: (contractDoc as Record<string, unknown>).optimizationRuns ?? null,
      evmVersion: (contractDoc as Record<string, unknown>).evmVersion || 'default',
      license: license || 'None',
      verifiedAt: contractDoc.verifiedAt,
      hasSourceCode: !!contractDoc.sourceCode,
      hasABI: !!contractDoc.abi,
      address: contractDoc.address,
      sourceCode: contractDoc.sourceCode || null,
      abi: contractDoc.abi || null,
      byteCode: contractDoc.byteCode || bytecode || null,
      blockNumber: contractDoc.blockNumber || creationTxData?.blockNumber || null,
      creationTransaction: contractDoc.creationTransaction || creationTxData?.hash || null,
      owner: contractDoc.owner || creationTxData?.from || null,
      message: contractDoc.verified ? 'Contract is verified' : 'Contract is not verified',
    });
  } catch (error) {
    console.error('Contract status check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
