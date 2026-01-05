import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '@/models/index';
import Web3 from 'web3';
import fs from 'fs';
import path from 'path';
import {
  sanitizeAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '@/lib/security';

// Function to read config
const readConfig = () => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const exampleConfigPath = path.join(process.cwd(), 'config.example.json');

    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else if (fs.existsSync(exampleConfigPath)) {
      return JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading config:', error);
  }

  return {
    nodeAddr: 'localhost',
    port: 8329,
  };
};

const config = readConfig();
const WEB3_PROVIDER_URL =
  process.env.WEB3_PROVIDER_URL || `http://${config.nodeAddr}:${config.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

// Blockscout API v2 - Get smart contract info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`contract-info:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

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
      compiler_version: contract?.compilerVersion || null,
      optimization_enabled: contract?.optimization || false,
      optimization_runs: contract?.optimizationRuns || 200,
      evm_version: 'paris',
      
      // Source code
      source_code: contract?.sourceCode || null,
      abi: contract?.abi ? JSON.parse(contract.abi as string) : null,
      
      // Bytecode
      creation_bytecode: null,
      deployed_bytecode: bytecode,
      
      // Additional info
      constructor_args: null,
      license_type: contract?.license || null,
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
