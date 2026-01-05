import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '@/models/index';
import Web3 from 'web3';
import solc from 'solc';
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

// Get the installed solc version
const installedSolcVersion = (solc as unknown as { version: () => string }).version?.() || '0.8.30';

// Helper function to remove metadata from bytecode
function removeMetadata(bytecode: string): string {
  let cleaned = bytecode.toLowerCase();
  if (cleaned.startsWith('0x')) {
    cleaned = cleaned.substring(2);
  }

  const ipfsMarkerIndex = cleaned.lastIndexOf('a264697066735822');
  if (ipfsMarkerIndex > 0) {
    return cleaned.substring(0, ipfsMarkerIndex);
  }

  const bzzr1MarkerIndex = cleaned.lastIndexOf('a265627a7a7231');
  if (bzzr1MarkerIndex > 0) {
    return cleaned.substring(0, bzzr1MarkerIndex);
  }

  const bzzr0MarkerIndex = cleaned.lastIndexOf('a265627a7a7230');
  if (bzzr0MarkerIndex > 0) {
    return cleaned.substring(0, bzzr0MarkerIndex);
  }

  const swarmMarkerIndex = cleaned.lastIndexOf('a165627a7a72');
  if (swarmMarkerIndex > 0) {
    return cleaned.substring(0, swarmMarkerIndex);
  }

  return cleaned;
}

// Blockscout API v2 - Verify via Standard JSON Input (Hardhat format)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`verify:${clientIp}`, 10, 60);
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

    // Parse request body (form-data or JSON)
    const contentType = request.headers.get('content-type') || '';
    let body: Record<string, string> = {};
    let filesData: Record<string, string> = {};

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        if (key === 'files' || key.startsWith('files[')) {
          // Handle file uploads
          if (value instanceof File) {
            // Will be handled separately
          } else {
            filesData[key] = value.toString();
          }
        } else {
          body[key] = value.toString();
        }
      });
    } else {
      body = await request.json();
    }

    const {
      compiler_version,
      contract_name,
      license_type,
    } = body;

    // Get Standard JSON Input from files or body
    let standardInput: Record<string, unknown> | null = null;

    if (body.files) {
      try {
        standardInput = JSON.parse(body.files);
      } catch {
        return NextResponse.json(
          { message: 'Invalid Standard JSON Input format' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
    } else if (body.standard_input) {
      try {
        standardInput = JSON.parse(body.standard_input);
      } catch {
        return NextResponse.json(
          { message: 'Invalid Standard JSON Input format' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
    }

    if (!standardInput) {
      return NextResponse.json(
        { message: 'Standard JSON Input is required (files or standard_input field)' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate contract name
    if (!contract_name) {
      return NextResponse.json(
        { message: 'Contract name is required (format: FileName.sol:ContractName)' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Get on-chain bytecode
    let onchainBytecode;
    try {
      onchainBytecode = await web3.eth.getCode(sanitizedAddress);
    } catch (web3Error) {
      return NextResponse.json(
        { message: 'Failed to connect to blockchain node' },
        { status: 500, headers: getSecurityHeaders() }
      );
    }

    if (onchainBytecode === '0x' || onchainBytecode === '0x0') {
      return NextResponse.json(
        { message: 'No contract found at this address' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    // Ensure output selection is set
    if (!standardInput.settings) {
      standardInput.settings = {};
    }
    const settings = standardInput.settings as Record<string, unknown>;
    settings.outputSelection = {
      '*': {
        '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'],
      },
    };

    // Compile
    let compiledOutput;
    try {
      compiledOutput = JSON.parse(solc.compile(JSON.stringify(standardInput)));
    } catch (compileError) {
      return NextResponse.json(
        {
          message: 'Compilation failed',
          errors: [compileError instanceof Error ? compileError.message : 'Unknown error'],
        },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Check for compilation errors
    if (compiledOutput.errors) {
      const errors = compiledOutput.errors.filter(
        (e: { severity: string }) => e.severity === 'error'
      );
      if (errors.length > 0) {
        return NextResponse.json(
          {
            message: 'Compilation errors',
            errors: errors.map((e: { message: string }) => e.message),
          },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
    }

    // Parse contract name (format: "FileName.sol:ContractName")
    let fileName = '';
    let targetContractName = contract_name;
    if (contract_name.includes(':')) {
      [fileName, targetContractName] = contract_name.split(':');
    }

    // Find compiled contract
    let compiledContract = null;
    let actualContractName = targetContractName;
    let actualFileName = fileName;

    if (compiledOutput.contracts) {
      for (const sourceName in compiledOutput.contracts) {
        const contracts = compiledOutput.contracts[sourceName];
        for (const name in contracts) {
          if (name === targetContractName) {
            compiledContract = contracts[name];
            actualContractName = name;
            actualFileName = sourceName;
            break;
          }
        }
        if (compiledContract) break;
      }
    }

    if (!compiledContract) {
      return NextResponse.json(
        { message: `Contract '${contract_name}' not found in compilation output` },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Compare bytecodes
    const compiledBytecode =
      compiledContract.evm?.deployedBytecode?.object || compiledContract.evm?.bytecode?.object;

    if (!compiledBytecode) {
      return NextResponse.json(
        { message: 'No bytecode generated from compilation' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const cleanOnchainBytecode = removeMetadata(onchainBytecode).replace(/0+$/, '');
    const cleanCompiledBytecode = removeMetadata(compiledBytecode).replace(/0+$/, '');

    // Calculate similarity
    const minLen = Math.min(cleanOnchainBytecode.length, cleanCompiledBytecode.length);
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
      if (cleanOnchainBytecode[i] === cleanCompiledBytecode[i]) matches++;
    }
    const similarity = minLen > 0 ? matches / minLen : 0;

    const isVerified =
      cleanCompiledBytecode === cleanOnchainBytecode ||
      cleanCompiledBytecode.includes(cleanOnchainBytecode) ||
      cleanOnchainBytecode.includes(cleanCompiledBytecode) ||
      similarity > 0.95;

    if (isVerified) {
      // Extract license
      let license = license_type || 'none';

      // Normalize compiler version
      let normalizedVersion = compiler_version || installedSolcVersion;
      if (normalizedVersion.startsWith('v')) {
        normalizedVersion = normalizedVersion.substring(1);
      }
      normalizedVersion = normalizedVersion.split('+')[0];

      // Get optimizer settings
      const optimizer = settings.optimizer as { enabled?: boolean; runs?: number } | undefined;

      // Save to database
      const contractData = {
        address: sanitizedAddress.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: normalizedVersion,
        optimization: optimizer?.enabled || false,
        optimizationRuns: optimizer?.runs || 200,
        license,
        sourceCode: JSON.stringify(standardInput),
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date(),
      };

      await Contract.findOneAndUpdate(
        { address: sanitizedAddress.toLowerCase() },
        contractData,
        { upsert: true, new: true }
      );

      // Blockscout API v2 response format
      return NextResponse.json(
        {
          message: 'Smart-contract verification started',
        },
        { status: 200, headers: getSecurityHeaders() }
      );
    } else {
      return NextResponse.json(
        {
          message: 'Bytecode mismatch - verification failed',
          errors: [`Similarity: ${(similarity * 100).toFixed(2)}%`],
        },
        { status: 400, headers: getSecurityHeaders() }
      );
    }
  } catch (error) {
    console.error('Contract verification error:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
