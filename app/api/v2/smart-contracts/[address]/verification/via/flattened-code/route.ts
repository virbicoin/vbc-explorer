import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '@/models/index';
import Web3 from 'web3';
import solc from 'solc';
import fs from 'fs';
import path from 'path';
import { sanitizeAddress, checkRateLimit, getClientIp, getSecurityHeaders } from '@/lib/security';

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

// Helper function to modernize old Solidity syntax
function modernizeSyntax(sourceCode: string): string {
  let modernized = sourceCode;

  // Strip NatSpec comments
  modernized = modernized.replace(/\/\*\*[\s\S]*?\*\//g, '');

  // Replace var with uint256
  modernized = modernized.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, 'uint256 $1 =');

  // Replace suicide with selfdestruct
  modernized = modernized.replace(/suicide\(/g, 'selfdestruct(');

  // Replace throw with revert
  modernized = modernized.replace(/\bthrow\b/g, 'revert()');

  // Convert strict pragma to flexible pragma for 0.8.x versions
  modernized = modernized.replace(/pragma\s+solidity\s+(\d+\.\d+\.\d+)\s*;/g, (match, version) => {
    const parts = version.split('.');
    if (parts[0] === '0' && parts[1] === '8') {
      return 'pragma solidity ^0.8.0;';
    }
    return match;
  });

  modernized = modernized.replace(
    /pragma\s+solidity\s+=\s*(\d+\.\d+\.\d+)\s*;/g,
    (match, version) => {
      const parts = version.split('.');
      if (parts[0] === '0' && parts[1] === '8') {
        return 'pragma solidity ^0.8.0;';
      }
      return match;
    }
  );

  return modernized;
}

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

// Blockscout API v2 - Verify via flattened source code
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

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        body[key] = value.toString();
      });
    } else {
      body = await request.json();
    }

    const {
      compiler_version,
      source_code,
      is_optimization_enabled,
      optimization_runs,
      contract_name,
      evm_version,
      autodetect_constructor_args,
      constructor_args,
      license_type,
    } = body;

    // Validate required fields
    if (!source_code) {
      return NextResponse.json(
        { message: 'Source code is required' },
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

    // Auto-detect contract name if not provided
    let detectedContractName = contract_name;
    if (!detectedContractName) {
      const contractMatches = source_code.match(/contract\s+([A-Za-z0-9_]+)/g);
      if (contractMatches && contractMatches.length > 0) {
        const lastContractMatch = contractMatches[contractMatches.length - 1];
        detectedContractName = lastContractMatch.replace(/contract\s+/, '');
      } else {
        return NextResponse.json(
          { message: 'No contract found in source code' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
    }

    // Prepare source code
    const cleanedSourceCode = modernizeSyntax(source_code);

    // Compile
    const input = {
      language: 'Solidity',
      sources: {
        [detectedContractName]: {
          content: cleanedSourceCode,
        },
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'],
          },
        },
        optimizer: {
          enabled: is_optimization_enabled === 'true' || is_optimization_enabled === '1',
          runs: parseInt(optimization_runs) || 200,
        },
        evmVersion: evm_version || 'paris',
      },
    };

    let compiledOutput;
    try {
      compiledOutput = JSON.parse(solc.compile(JSON.stringify(input)));
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

    // Find compiled contract
    let compiledContract = null;
    let actualContractName = detectedContractName;

    if (compiledOutput.contracts) {
      for (const sourceName in compiledOutput.contracts) {
        const contracts = compiledOutput.contracts[sourceName];
        for (const name in contracts) {
          if (name === detectedContractName || !compiledContract) {
            compiledContract = contracts[name];
            actualContractName = name;
          }
        }
      }
    }

    if (!compiledContract) {
      return NextResponse.json(
        { message: `Contract '${detectedContractName}' not found in compilation output` },
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
      if (!license_type) {
        const spdxMatch = source_code.match(/SPDX-License-Identifier:\s*([^\s\n\r*]+)/i);
        if (spdxMatch && spdxMatch[1]) {
          license = spdxMatch[1].trim();
        }
      }

      // Normalize compiler version
      let normalizedVersion = compiler_version || installedSolcVersion;
      if (normalizedVersion.startsWith('v')) {
        normalizedVersion = normalizedVersion.substring(1);
      }
      normalizedVersion = normalizedVersion.split('+')[0];

      // Save to database
      const contractData = {
        address: sanitizedAddress.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: normalizedVersion,
        optimization: is_optimization_enabled === 'true' || is_optimization_enabled === '1',
        optimizationRuns: parseInt(optimization_runs) || 200,
        license,
        sourceCode: cleanedSourceCode,
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date(),
      };

      await Contract.findOneAndUpdate({ address: sanitizedAddress.toLowerCase() }, contractData, {
        upsert: true,
        new: true,
      });

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
