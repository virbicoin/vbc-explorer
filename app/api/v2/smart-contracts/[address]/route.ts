import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '@/models/index';
import { sanitizeAddress, checkRateLimit, getClientIp, getSecurityHeaders } from '@/lib/security';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { blockscoutCompilerVersion, blockscoutLicenseType } from '@/lib/api/v2/common';
import { getWeb3 } from '@/lib/web3/provider';

// The shared node connection (lib/web3/provider.ts)
const web3 = getWeb3();

// Blockscout API v2 - Get smart contract info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    const limited = enforceRateLimit(request, 'api', { format: 'v2' });
    if (limited) return limited;

    // Validate address
    const sanitizedAddress = sanitizeAddress(address);
    if (!sanitizedAddress) {
      return NextResponse.json(
        { message: 'Invalid contract address' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Get contract from database
    const contract = await Contract.findOne({
      address: sanitizedAddress.toLowerCase(),
    }).lean();

    // Get on-chain bytecode
    let bytecode = '0x';
    try {
      bytecode = await web3.eth.getCode(sanitizedAddress);
    } catch (error) {
      console.error('Error fetching bytecode:', error);
    }

    // Check if it's a contract
    const isContract = bytecode !== '0x' && bytecode !== '0x0';

    if (!isContract) {
      return NextResponse.json(
        { message: 'Address is not a contract' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    // Blockscout API v2 response format
    const response: Record<string, unknown> = {
      // Basic info
      hash: sanitizedAddress.toLowerCase(),
      is_contract: true,
      is_verified: contract?.verified || false,

      // Verification info
      name: contract?.contractName || null,
      compiler_version: blockscoutCompilerVersion(contract?.compilerVersion),
      optimization_enabled: contract?.optimization || false,
      // null when the record predates storing them (see the Contract schema)
      optimization_runs:
        typeof contract?.optimizationRuns === 'number' ? contract.optimizationRuns : null,
      evm_version: typeof contract?.evmVersion === 'string' ? contract.evmVersion : null,

      // Source code
      source_code: contract?.sourceCode || null,
      abi: contract?.abi ? JSON.parse(contract.abi as string) : null,

      // Bytecode
      creation_bytecode: null,
      deployed_bytecode: bytecode,

      // Additional info
      constructor_args: null,
      license_type: blockscoutLicenseType(contract?.license),
      verified_at: contract?.verifiedAt || null,

      // External verification
      is_verified_via_sourcify: false,
      is_verified_via_eth_bytecode_db: false,
      sourcify_repo_url: null,

      // Proxy info
      is_self_destructed: false,
      is_changed_bytecode: false,
      minimal_proxy_address_hash: null,
      implementation_address: null,
      implementations: [],

      // File path (for multi-file contracts)
      file_path: null,

      // Additional metadata
      additional_sources: [],
      external_libraries: [],
      verified_twin_address_hash: null,
      creation_tx_hash: null,

      // Language
      language: 'solidity',
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching contract info:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
