/**
 * Contract verification handlers (Etherscan/Hardhat compatible) for the
 * Blockscout-compatible API.
 *
 * Extracted from `app/api/route.ts` to keep the dispatcher thin. Only
 * `verifySourceCode` (POST) and `checkVerifyStatus` (GET) are part of the public
 * surface; `processVerification` is an internal helper. Compilation runs through
 * lib/contract/compile-worker.ts (verified release build, worker thread).
 */

import { type Address } from 'viem';
import { connectDB, VerificationJob } from '@/models/index';
import { isValidAddress } from '@/lib/security';
import { randomUUID } from 'crypto';
import { isAlreadyVerified } from '@/lib/contract/verified';
import { verifiedMessage, verifySubmission } from '@/lib/contract/verify';
import { publicClient, successResponse, errorResponse } from './shared';
import { getCompilerConfig } from '@/lib/config';
import { proxyInfo } from './handlers';

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

    let input: Record<string, unknown>;
    if (codeFormat === 'solidity-standard-json-input') {
      // Standard JSON input (Hardhat, Foundry): compiled with its own settings. The separate
      // request parameters only fill in what the input leaves out; they used to replace them,
      // so every standard JSON input was compiled for paris.
      try {
        input = JSON.parse(sourceCode);
      } catch {
        await VerificationJob.updateOne(
          { guid },
          { status: 'fail', message: 'Invalid Standard JSON Input format' }
        );
        return;
      }
      const settings = { ...((input.settings as Record<string, unknown> | undefined) ?? {}) };
      if (optimizationUsed && !settings.optimizer) {
        settings.optimizer = { enabled: optimizationUsed, runs: runs || 200 };
      }
      if (evmVersion && !settings.evmVersion) settings.evmVersion = evmVersion;
      input.settings = settings;
    } else {
      // A single file, compiled exactly as submitted (rewriting it changed the metadata hash,
      // string literals and comments, and the stored source was not the developer's)
      input = {
        language: 'Solidity',
        sources: {
          [contractName.includes(':') ? contractName.split(':')[0] : `${contractName}.sol`]: {
            content: sourceCode,
          },
        },
        settings: {
          optimizer: { enabled: optimizationUsed, runs: runs || 200 },
          evmVersion: evmVersion || getCompilerConfig().defaultEvmVersion || undefined,
          // Hardhat's defaults
          metadata: { bytecodeHash: 'ipfs', useLiteralContent: false },
          viaIR: false,
        },
      };
    }

    const outcome = await verifySubmission(
      { address, compilerVersion, input, contractName, source: sourceCode, license: licenseType },
      { getCode: (target) => publicClient.getCode({ address: target as Address }) }
    );
    const fail = (message: string) =>
      VerificationJob.updateOne({ guid }, { status: 'fail', message });
    switch (outcome.status) {
      case 'verified':
        await VerificationJob.updateOne(
          { guid },
          { status: 'pass', message: verifiedMessage(outcome.match) }
        );
        return;
      case 'already-verified':
        await fail('Contract source code already verified');
        return;
      case 'no-code':
        await fail('No contract found at this address');
        return;
      case 'node-unavailable':
        await fail('Verification error: the node did not answer');
        return;
      case 'compiler-error':
        await fail(`Compilation failed (${outcome.code}): ${outcome.message}`);
        return;
      case 'compile-errors':
        await fail(`Compilation errors: ${outcome.errors.map((e) => e.message).join('; ')}`);
        return;
      case 'contract-not-found':
        await fail(`Contract '${contractName}' not found in compilation output`);
        return;
      case 'mismatch':
        await fail(
          'Fail - Unable to verify: the compiled bytecode does not match the deployed code'
        );
        return;
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
    const job = await VerificationJob.findOne({ guid, codeFormat: { $ne: 'proxy' } }).lean();
    // Etherscan's answers; result is always a string
    if (!job) return errorResponse('GUID not found', 'Fail - GUID not found');
    if (job.status === 'pending') return errorResponse('Pending in queue', 'Pending in queue');
    if (job.status === 'pass') return successResponse('Pass - Verified');
    const failMessage = job.message || 'Unable to verify';
    return errorResponse(failMessage, `Fail - ${failMessage}`);
  } catch (error) {
    console.error('[checkVerifyStatus] Error:', error);
    return errorResponse(
      'Error checking verification status',
      'Fail - Error checking verification status'
    );
  }
}

/**
 * Etherscan `contract/verifyproxycontract` (used by OpenZeppelin's upgrades plugin): reads the
 * implementation behind the proxy from the chain (EIP-1967, beacon, EIP-1822, zos, EIP-1167) and
 * keeps the outcome under a GUID for `checkproxyverification`. Nothing is stored on the contract:
 * getsourcecode reads the proxy relation from the chain every time, so an upgrade shows at once.
 */
export async function verifyProxyContract(address: string, expectedImplementation?: string) {
  try {
    await connectDB();
    const proxy = await proxyInfo(address);
    let status: 'pass' | 'fail';
    let message: string;
    if (!proxy) {
      status = 'fail';
      message =
        'A corresponding implementation contract was unfortunately not detected for the proxy address.';
    } else if (expectedImplementation && expectedImplementation !== proxy.implementation) {
      status = 'fail';
      message = `The implementation contract at ${proxy.implementation} does not match the expected implementation contract address ${expectedImplementation}.`;
    } else {
      status = 'pass';
      message = `The proxy's (${address}) implementation contract is found at ${proxy.implementation} and is successfully updated.`;
    }
    const guid = randomUUID();
    await VerificationJob.create({ guid, address, status, message, codeFormat: 'proxy' });
    return successResponse(guid);
  } catch (error) {
    console.error('[verifyProxyContract] Error:', error);
    return errorResponse('Error verifying proxy contract');
  }
}

/** Etherscan `contract/checkproxyverification`. */
export async function checkProxyVerification(guid: string) {
  try {
    await connectDB();
    const job = await VerificationJob.findOne({ guid, codeFormat: 'proxy' }).lean();
    if (!job) return errorResponse('GUID not found', 'Fail - GUID not found');
    return job.status === 'pass'
      ? successResponse(job.message)
      : errorResponse('NOTOK', job.message || 'Proxy verification failed');
  } catch (error) {
    console.error('[checkProxyVerification] Error:', error);
    return errorResponse('Error checking proxy verification');
  }
}
