/**
 * Contract verification handlers (Etherscan/Hardhat compatible) for the
 * Blockscout-compatible API.
 *
 * Extracted from `app/api/route.ts` to keep the dispatcher thin. Only
 * `verifySourceCode` (POST) and `checkVerifyStatus` (GET) are part of the public
 * surface; `loadSolcVersion` and `processVerification` are internal helpers.
 */

import { NextResponse } from 'next/server';
import { type Address } from 'viem';
import { connectDB, Contract, VerificationJob } from '@/models/index';
import { isValidAddress, getSecurityHeaders } from '@/lib/security';
import { randomUUID } from 'crypto';
import solc from 'solc';
import {
  normalizeCompilerVersion,
  SOLC_RELEASES,
  modernizeSyntax,
  removeMetadata,
} from '@/lib/contract/solc-utils';
import { publicClient, successResponse, errorResponse } from './shared';

// Cache for loaded solc compilers
const solcCache: Map<string, unknown> = new Map();

// Load a specific version of solc compiler
async function loadSolcVersion(version: string): Promise<unknown> {
  const normalizedVersion = normalizeCompilerVersion(version);

  // Check cache first
  if (solcCache.has(normalizedVersion)) {
    console.log(`📦 Using cached solc ${normalizedVersion}`);
    return solcCache.get(normalizedVersion);
  }

  // Get the full release name for this version
  const fullReleaseName = SOLC_RELEASES[normalizedVersion];

  if (!fullReleaseName) {
    console.warn(
      `⚠️ No release mapping for solc ${normalizedVersion}, falling back to installed solc`
    );
    return solc;
  }

  return new Promise((resolve) => {
    console.log(`📥 Loading solc ${normalizedVersion} (${fullReleaseName}) from remote...`);

    // Use solc.loadRemoteVersion to load the specific version
    // The version string must be the full release name like "v0.8.30+commit.73712a01"
    (
      solc as unknown as {
        loadRemoteVersion: (
          version: string,
          callback: (err: Error | null, solcSnapshot: unknown) => void
        ) => void;
      }
    ).loadRemoteVersion(fullReleaseName, (err: Error | null, solcSnapshot: unknown) => {
      if (err) {
        console.error(`❌ Failed to load solc ${normalizedVersion}:`, err.message);
        // Fall back to installed solc
        console.log(`⚠️ Falling back to installed solc`);
        resolve(solc);
      } else {
        console.log(`✅ Successfully loaded solc ${normalizedVersion}`);
        // Cache the loaded compiler
        solcCache.set(normalizedVersion, solcSnapshot);
        resolve(solcSnapshot);
      }
    });
  });
}

// Verify source code (Etherscan/Hardhat compatible)
export async function verifySourceCode(params: {
  contractaddress: string;
  sourceCode: string;
  codeformat: string;
  contractname: string;
  compilerversion: string;
  optimizationUsed: string;
  runs: string;
  constructorArguements?: string;
  evmversion?: string;
  licenseType?: string;
  libraryname1?: string;
  libraryaddress1?: string;
}) {
  try {
    await connectDB();

    const {
      contractaddress,
      sourceCode,
      codeformat,
      contractname,
      compilerversion,
      optimizationUsed,
      runs,
      constructorArguements,
      evmversion,
      licenseType,
    } = params;

    // Validate address
    if (!isValidAddress(contractaddress)) {
      return errorResponse('Invalid contract address');
    }

    // Generate GUID for tracking
    const guid = randomUUID();

    // Create verification job
    const job = new VerificationJob({
      guid,
      address: contractaddress.toLowerCase(),
      status: 'pending',
      message: 'Verification in progress',
      sourceCode,
      codeFormat: codeformat || 'solidity-single-file',
      contractName: contractname,
      compilerVersion: compilerversion,
      optimizationUsed: optimizationUsed === '1',
      runs: parseInt(runs) || 200,
      constructorArguments: constructorArguements || '',
      evmVersion: evmversion || 'paris',
      licenseType: licenseType || '',
    });

    await job.save();

    // Process verification asynchronously
    processVerification(guid).catch((err) => {
      console.error(`Verification job ${guid} failed:`, err);
    });

    // Return GUID immediately (Etherscan-style response)
    return successResponse(guid, 'OK');
  } catch (error) {
    console.error('[verifySourceCode] Error:', error);
    return errorResponse('Error submitting verification request');
  }
}

// Process verification job
async function processVerification(guid: string) {
  try {
    await connectDB();

    const job = await VerificationJob.findOne({ guid });
    if (!job) {
      console.error(`Verification job ${guid} not found`);
      return;
    }

    const {
      address,
      sourceCode,
      codeFormat,
      contractName,
      compilerVersion,
      optimizationUsed,
      runs,
      constructorArguments,
      evmVersion,
      licenseType,
    } = job;

    // Get on-chain bytecode
    const onchainBytecode = await publicClient.getCode({ address: address as Address });

    if (!onchainBytecode || onchainBytecode === '0x') {
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: 'No contract found at this address' }
      );
      return;
    }

    let compiledSourceCode = sourceCode;
    let inputJson: Record<string, unknown>;

    // Handle different code formats
    if (codeFormat === 'solidity-standard-json-input') {
      // Standard JSON Input format (used by Hardhat)
      try {
        inputJson = JSON.parse(sourceCode);
        // Ensure settings are present
        if (!inputJson.settings) {
          inputJson.settings = {};
        }
        const settings = inputJson.settings as Record<string, unknown>;
        settings.outputSelection = {
          '*': {
            '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'],
          },
        };
        if (optimizationUsed) {
          settings.optimizer = {
            enabled: optimizationUsed,
            runs: runs || 200,
          };
        }
        if (evmVersion) {
          settings.evmVersion = evmVersion;
        }
      } catch (parseError) {
        await VerificationJob.updateOne(
          { guid },
          { status: 'fail', message: 'Invalid Standard JSON Input format' }
        );
        return;
      }
    } else {
      // Single file format
      compiledSourceCode = modernizeSyntax(sourceCode);

      inputJson = {
        language: 'Solidity',
        sources: {
          [contractName.includes(':') ? contractName.split(':')[0] : `${contractName}.sol`]: {
            content: compiledSourceCode,
          },
        },
        settings: {
          outputSelection: {
            '*': {
              '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers'],
            },
          },
          optimizer: {
            enabled: optimizationUsed,
            runs: runs || 200,
          },
          evmVersion: evmVersion || 'paris',
          // Match Hardhat's default metadata settings
          metadata: {
            bytecodeHash: 'ipfs', // Hardhat default
            useLiteralContent: false,
          },
          // Disable viaIR by default (Hardhat default)
          viaIR: false,
        },
      };
    }

    // Load the requested compiler version
    const normalizedVersion = normalizeCompilerVersion(compilerVersion);
    console.log(
      `🔧 Requested compiler version: ${compilerVersion} (normalized: ${normalizedVersion})`
    );

    const solcCompiler = await loadSolcVersion(compilerVersion);

    // Compile with the loaded compiler
    let compiledOutput;
    try {
      const compileFunc = (solcCompiler as { compile: (input: string) => string }).compile;
      compiledOutput = JSON.parse(compileFunc(JSON.stringify(inputJson)));
      console.log(`✅ Compiled with solc ${normalizedVersion}`);
    } catch (compileError) {
      await VerificationJob.updateOne(
        { guid },
        {
          status: 'fail',
          message: `Compilation failed: ${compileError instanceof Error ? compileError.message : 'Unknown error'}`,
        }
      );
      return;
    }

    // Check for compilation errors
    if (compiledOutput.errors) {
      const errors = compiledOutput.errors.filter(
        (e: { severity: string }) => e.severity === 'error'
      );
      if (errors.length > 0) {
        await VerificationJob.updateOne(
          { guid },
          {
            status: 'fail',
            message: `Compilation errors: ${errors.map((e: { message: string }) => e.message).join('; ')}`,
          }
        );
        return;
      }
    }

    // Find the compiled contract
    let compiledContract = null;
    let actualContractName = contractName;

    // Parse contract name (format: "FileName.sol:ContractName" or just "ContractName")
    let fileName = '';
    let targetContractName = contractName;
    if (contractName.includes(':')) {
      [fileName, targetContractName] = contractName.split(':');
    }

    if (compiledOutput.contracts) {
      for (const sourceName in compiledOutput.contracts) {
        const contracts = compiledOutput.contracts[sourceName];
        for (const name in contracts) {
          if (name === targetContractName || (!targetContractName && !compiledContract)) {
            compiledContract = contracts[name];
            actualContractName = name;
          }
        }
      }
    }

    if (!compiledContract) {
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: `Contract '${contractName}' not found in compilation output` }
      );
      return;
    }

    // Compare bytecodes
    const compiledBytecode =
      compiledContract.evm?.deployedBytecode?.object || compiledContract.evm?.bytecode?.object;

    if (!compiledBytecode) {
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: 'No bytecode generated from compilation' }
      );
      return;
    }

    // Normalize and compare bytecodes
    const cleanOnchainBytecode = removeMetadata(onchainBytecode).replace(/0+$/, '');
    const cleanCompiledBytecode = removeMetadata(compiledBytecode).replace(/0+$/, '');

    // Calculate similarity
    const minLen = Math.min(cleanOnchainBytecode.length, cleanCompiledBytecode.length);
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
      if (cleanOnchainBytecode[i] === cleanCompiledBytecode[i]) matches++;
    }
    const similarity = minLen > 0 ? matches / minLen : 0;

    // Check various verification methods
    const isVerified =
      cleanCompiledBytecode === cleanOnchainBytecode ||
      cleanCompiledBytecode.includes(cleanOnchainBytecode) ||
      cleanOnchainBytecode.includes(cleanCompiledBytecode) ||
      similarity > 0.95;

    if (isVerified) {
      // Extract license from source code
      let license = licenseType || 'None';
      if (!licenseType) {
        const spdxMatch = sourceCode.match(/SPDX-License-Identifier:\s*([^\s\n\r*]+)/i);
        if (spdxMatch && spdxMatch[1]) {
          license = spdxMatch[1].trim();
        }
      }

      // Save verified contract
      const contractData = {
        address: address.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: normalizeCompilerVersion(compilerVersion),
        optimization: optimizationUsed,
        optimizationRuns: runs,
        license,
        sourceCode: codeFormat === 'solidity-standard-json-input' ? sourceCode : compiledSourceCode,
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date(),
      };

      await Contract.findOneAndUpdate({ address: address.toLowerCase() }, contractData, {
        upsert: true,
        new: true,
      });

      await VerificationJob.updateOne(
        { guid },
        { status: 'pass', message: 'Contract successfully verified' }
      );
    } else {
      await VerificationJob.updateOne(
        { guid },
        {
          status: 'fail',
          message: `Bytecode mismatch (similarity: ${(similarity * 100).toFixed(2)}%)`,
        }
      );
    }
  } catch (error) {
    console.error(`[processVerification] Error for ${guid}:`, error);
    await VerificationJob.updateOne(
      { guid },
      {
        status: 'fail',
        message: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    );
  }
}

// Check verification status
export async function checkVerifyStatus(guid: string) {
  try {
    await connectDB();

    const job = await VerificationJob.findOne({ guid }).lean();

    if (!job) {
      // Etherscan returns status 0 with result as string for not found
      return NextResponse.json(
        {
          status: '0',
          message: 'GUID not found',
          result: 'Fail - GUID not found',
        },
        { headers: getSecurityHeaders() }
      );
    }

    // Etherscan-style response - result must ALWAYS be a string, never null
    if (job.status === 'pending') {
      return NextResponse.json(
        {
          status: '0',
          message: 'Pending in queue',
          result: 'Pending in queue',
        },
        { headers: getSecurityHeaders() }
      );
    } else if (job.status === 'pass') {
      return NextResponse.json(
        {
          status: '1',
          message: 'OK',
          result: 'Pass - Verified',
        },
        { headers: getSecurityHeaders() }
      );
    } else {
      // Fail status - result must be a string describing the failure
      const failMessage = job.message || 'Fail - Unable to verify';
      return NextResponse.json(
        {
          status: '0',
          message: failMessage,
          result: `Fail - ${failMessage}`,
        },
        { headers: getSecurityHeaders() }
      );
    }
  } catch (error) {
    console.error('[checkVerifyStatus] Error:', error);
    return NextResponse.json(
      {
        status: '0',
        message: 'Error checking verification status',
        result: 'Fail - Error checking verification status',
      },
      { headers: getSecurityHeaders() }
    );
  }
}
