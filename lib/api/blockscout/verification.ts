/**
 * Contract verification handlers (Etherscan/Hardhat compatible) for the
 * Blockscout-compatible API.
 *
 * Extracted from `app/api/route.ts` to keep the dispatcher thin. Only
 * `verifySourceCode` (POST) and `checkVerifyStatus` (GET) are part of the public
 * surface; `processVerification` is an internal helper. Compilation runs through
 * lib/contract/compile-worker.ts (verified release build, worker thread).
 */

import { NextResponse } from 'next/server';
import { type Address } from 'viem';
import { connectDB, Contract, VerificationJob } from '@/models/index';
import { isValidAddress, getSecurityHeaders } from '@/lib/security';
import { randomUUID } from 'crypto';
import {
  compileSettingsRecord,
  normalizeCompilerVersion,
  modernizeSyntax,
  spdxLicense,
} from '@/lib/contract/solc-utils';
import { matchRuntimeBytecode, type CompiledRuntimeCode } from '@/lib/contract/bytecode-match';
import { isAlreadyVerified } from '@/lib/contract/verified';
import { compileStandardJson, describeCompileError } from '@/lib/contract/compile-worker';
import { publicClient, successResponse, errorResponse } from './shared';
import { getCompilerConfig } from '@/lib/config';

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

    // A verified contract keeps its source. A second verification used to replace the name and
    // source of a verified contract (2026-11-09); Etherscan refuses it the same way.
    if (await isAlreadyVerified(contractaddress)) {
      return errorResponse('NOTOK', 'Contract source code already verified');
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
      // '' = not given (see processVerification)
      evmVersion: evmversion || '',
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
        // The input carries its own settings (Hardhat sends exactly what it compiled with).
        // The separate request parameters only fill in what the input leaves out; they used
        // to replace them, so every standard JSON input was compiled for paris.
        if (optimizationUsed && !settings.optimizer) {
          settings.optimizer = {
            enabled: optimizationUsed,
            runs: runs || 200,
          };
        }
        if (evmVersion && !settings.evmVersion) {
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
          evmVersion: evmVersion || getCompilerConfig().defaultEvmVersion || undefined,
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

    // Verified release build from the local cache, executed in a worker thread
    let compiledOutput;
    try {
      const compiled = await compileStandardJson({ version: compilerVersion, input: inputJson });
      compiledOutput = JSON.parse(compiled.output);
      console.log(`✅ Compiled with solc ${compiled.longVersion} in ${compiled.durationMs} ms`);
    } catch (compileError) {
      const described = describeCompileError(compileError);
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: `Compilation failed (${described.code}): ${described.message}` }
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

    // Exact match of the runtime code (immutables, library addresses and, for a partial
    // match, the metadata aside). See lib/contract/bytecode-match.ts.
    const match = matchRuntimeBytecode(
      onchainBytecode,
      compiledContract.evm?.deployedBytecode as CompiledRuntimeCode | undefined
    );
    const isVerified = match !== null;
    console.log(`[processVerification] ${address}: match=${match ?? 'none'}`);

    if (isVerified) {
      // Extract license from source code
      // The SPDX identifier of the contract's own file (decoded from a standard JSON input)
      const license = licenseType || spdxLicense(sourceCode, actualContractName) || 'None';

      // Save verified contract
      const contractData = {
        address: address.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: normalizeCompilerVersion(compilerVersion),
        // The settings that were compiled, not the request parameters
        ...compileSettingsRecord(inputJson),
        license,
        sourceCode: codeFormat === 'solidity-standard-json-input' ? sourceCode : compiledSourceCode,
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date(),
      };

      await Contract.findOneAndUpdate({ address: address.toLowerCase() }, contractData, {
        upsert: true,
        returnDocument: 'after',
      });

      await VerificationJob.updateOne(
        { guid },
        {
          status: 'pass',
          message:
            match === 'full'
              ? 'Contract successfully verified'
              : 'Contract successfully verified (partial match: metadata differs)',
        }
      );
    } else {
      await VerificationJob.updateOne(
        { guid },
        {
          status: 'fail',
          message:
            'Fail - Unable to verify: the compiled bytecode does not match the deployed code',
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
