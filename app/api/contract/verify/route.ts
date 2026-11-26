import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '../../../../models/index';
import Web3 from 'web3';
import fs from 'fs';
import path from 'path';
import {
  sanitizeAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
  isValidContentType,
} from '../../../../lib/security';
import {
  compileSettingsRecord,
  normalizeCompilerVersion,
  spdxLicense,
} from '../../../../lib/contract/solc-utils';
import { compileStandardJson, describeCompileError } from '@/lib/contract/compile-worker';
import { matchRuntimeBytecode } from '@/lib/contract/bytecode-match';
import { isAlreadyVerified } from '@/lib/contract/verified';
import { enforceRateLimit, withRateLimit } from '@/lib/security/rate-limits';
import { getCompilerConfig } from '@/lib/config';

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

  // Default configuration
  return {
    nodeAddr: 'localhost',
    port: 8545,
  };
};

const config = readConfig();
const WEB3_PROVIDER_URL =
  process.env.WEB3_PROVIDER_URL || `http://${config.nodeAddr}:${config.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

// Supported compiler versions
const SUPPORTED_COMPILER_VERSIONS = [
  '0.8.33',
  '0.8.32',
  '0.8.31',
  '0.8.30',
  '0.8.29',
  '0.8.28',
  '0.8.27',
  '0.8.26',
  '0.8.25',
  '0.8.24',
  '0.8.23',
  '0.8.22',
  '0.8.21',
  '0.8.20',
  '0.8.19',
  '0.8.18',
  '0.8.17',
  '0.8.16',
  '0.8.15',
  '0.6.12', // Legacy support
];

// Helper function to strip NatSpec comments to avoid DocstringParsingError
// NatSpec comments (/** ... */) can cause compilation errors if @param doesn't match
function stripNatSpecComments(sourceCode: string): string {
  // Replace /** ... */ style comments with empty string
  // Use non-greedy match to handle multiple comment blocks
  return sourceCode.replace(/\/\*\*[\s\S]*?\*\//g, '');
}

// Helper function to modernize old Solidity syntax
// NOTE: We no longer modify pragma statements to preserve exact compiler version matching
function modernizeSyntax(sourceCode: string, targetVersion?: string): string {
  let modernized = sourceCode;

  // NOTE: Do NOT replace := with = - := is the correct assignment operator in assembly blocks

  // Strip NatSpec comments to avoid DocstringParsingError
  modernized = stripNatSpecComments(modernized);

  // Replace var with appropriate types where possible (very old Solidity syntax)
  modernized = modernized.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, 'uint256 $1 =');

  // Replace suicide with selfdestruct (deprecated in newer Solidity)
  modernized = modernized.replace(/suicide\(/g, 'selfdestruct(');

  // Replace throw with revert (deprecated in newer Solidity)
  modernized = modernized.replace(/\bthrow\b/g, 'revert()');

  // If a target version is specified, update the pragma to match
  // This ensures the exact compiler version is used
  if (targetVersion) {
    // Replace strict pragma with the target version
    modernized = modernized.replace(
      /pragma\s+solidity\s+[=^~>=<]*\s*(\d+\.\d+\.\d+)\s*;/g,
      `pragma solidity ^${targetVersion};`
    );
    // Also handle range pragmas like ">=0.8.0 <0.9.0"
    modernized = modernized.replace(
      /pragma\s+solidity\s+>=?\s*\d+\.\d+\.\d+\s*<?=?\s*\d*\.?\d*\.?\d*\s*;/g,
      `pragma solidity ^${targetVersion};`
    );
  }

  return modernized;
}

// Helper function to get available compiler versions (0.8.x only - matches installed solc)
function getAvailableCompilerVersions(): string[] {
  return [
    // 0.8.x versions (supported by installed solc)
    '0.8.30',
    '0.8.29',
    '0.8.28',
    '0.8.27',
    '0.8.26',
    '0.8.25',
    '0.8.24',
    '0.8.23',
    '0.8.22',
    '0.8.21',
    '0.8.20',
    '0.8.19',
    '0.8.18',
    '0.8.17',
    '0.8.16',
    '0.8.15',
  ];
}

// Helper function to find best matching compiler version
function findBestCompilerVersion(requestedVersion: string): string {
  // Normalize the requested version first
  const normalizedVersion = normalizeCompilerVersion(requestedVersion);

  // Check if the normalized version is in the supported list
  if (SUPPORTED_COMPILER_VERSIONS.includes(normalizedVersion)) {
    console.log(`✅ Using requested compiler version: ${normalizedVersion}`);
    return normalizedVersion;
  }

  // For non-supported versions, warn and use the requested version anyway
  // (the compiler cache serves release builds only; unknown versions fail with 400)
  if (normalizedVersion.startsWith('0.8.') || normalizedVersion.startsWith('0.6.')) {
    console.warn(
      `⚠️ Requested version ${normalizedVersion} is not in the pre-defined list, but will try to load it.`
    );
    return normalizedVersion;
  }

  // For completely unsupported versions, use default
  console.warn(
    `⚠️ Requested version ${normalizedVersion} is not supported. Falling back to 0.8.30.`
  );
  return '0.8.30';
}

export const POST = withRateLimit('verify', async (request: NextRequest) => {
  try {
    // Validate content type
    if (!isValidContentType(request)) {
      return NextResponse.json(
        { error: 'Invalid content type. Expected application/json' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Try to connect to DB with timeout
    try {
      await Promise.race([
        connectDB(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database connection timeout')), 10000)
        ),
      ]);
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      return NextResponse.json(
        {
          error: 'Database connection failed',
          details: 'Unable to connect to the database. Please try again later.',
          message: dbError instanceof Error ? dbError.message : 'Unknown database error',
        },
        { status: 503, headers: getSecurityHeaders() }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const { address, sourceCode, standardJsonInput, compilerVersion, contractName, optimization } =
      body;

    // Enhanced validation with detailed error messages
    // Either sourceCode OR standardJsonInput is required
    const missingFields = [];
    if (!address) missingFields.push('address');
    if (!sourceCode && !standardJsonInput) missingFields.push('sourceCode or standardJsonInput');
    if (!compilerVersion) missingFields.push('compilerVersion');

    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return NextResponse.json(
        {
          error: `Missing required fields: ${missingFields.join(', ')}`,
          receivedData: {
            hasAddress: !!address,
            hasSourceCode: !!sourceCode,
            hasStandardJsonInput: !!standardJsonInput,
            hasCompilerVersion: !!compilerVersion,
            hasContractName: !!contractName,
            hasOptimization: optimization !== undefined,
          },
        },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate address format using security module
    const sanitizedAddress = sanitizeAddress(address);
    if (!sanitizedAddress) {
      return NextResponse.json(
        {
          error:
            'Invalid contract address format. Must be a 42-character hex string starting with 0x.',
        },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate source code or standardJsonInput is not empty and not too large (max 500KB)
    const MAX_SOURCE_SIZE = 500 * 1024; // 500KB
    const inputToValidate = standardJsonInput || sourceCode;
    if (inputToValidate.trim().length === 0) {
      return NextResponse.json(
        { error: 'Source code or Standard JSON Input cannot be empty' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }
    if (inputToValidate.length > MAX_SOURCE_SIZE) {
      return NextResponse.json(
        { error: `Source code too large. Maximum size is ${MAX_SOURCE_SIZE / 1024}KB` },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Check if using Standard JSON Input mode
    const isStandardJsonInput = !!standardJsonInput;

    console.log('📝 Received verification request:', {
      address: sanitizedAddress,
      contractName,
      compilerVersion,
      optimization,
      isStandardJsonInput,
      sourceCodeLength: isStandardJsonInput ? standardJsonInput.length : sourceCode?.length || 0,
    });

    // Auto-detect contract name if not provided
    let detectedContractName = contractName;
    let targetFileName = '';
    let targetContractName = '';

    // Parse contract name (format: "FileName.sol:ContractName" or just "ContractName")
    if (contractName && contractName.includes(':')) {
      [targetFileName, targetContractName] = contractName.split(':');
      detectedContractName = targetContractName;
    } else if (contractName) {
      targetContractName = contractName;
      detectedContractName = contractName;
    }

    // For Standard JSON Input, we need the contract name from the input
    if (isStandardJsonInput && !detectedContractName) {
      try {
        const jsonInput = JSON.parse(standardJsonInput);
        if (jsonInput.sources) {
          const sourceFiles = Object.keys(jsonInput.sources);
          if (sourceFiles.length > 0) {
            // Use the first source file name as a hint
            const firstFile = sourceFiles[0];
            // Try to extract contract name from file content
            const content = jsonInput.sources[firstFile].content || '';
            const contractMatches = content.match(/contract\s+([A-Za-z0-9_]+)/g);
            if (contractMatches && contractMatches.length > 0) {
              const lastContractMatch = contractMatches[contractMatches.length - 1];
              detectedContractName = lastContractMatch.replace(/contract\s+/, '');
              targetFileName = firstFile;
            }
          }
        }
      } catch (e) {
        // Ignore parse errors, will be handled later
      }
    }

    // For single file mode, auto-detect from source code
    if (!isStandardJsonInput && !detectedContractName) {
      const contractMatches = sourceCode.match(/contract\s+([A-Za-z0-9_]+)/g);
      if (contractMatches && contractMatches.length > 0) {
        // Extract the last contract name (usually the main contract in flattened code)
        const lastContractMatch = contractMatches[contractMatches.length - 1];
        detectedContractName = lastContractMatch.replace(/contract\s+/, '');
      } else {
        return NextResponse.json(
          { error: 'No contract found in source code. Please provide a contract name.' },
          { status: 400 }
        );
      }
    }

    if (!detectedContractName) {
      return NextResponse.json(
        { error: 'Contract name is required for Standard JSON Input verification.' },
        { status: 400 }
      );
    }

    // Determine the best compiler version to use
    const finalCompilerVersion = findBestCompilerVersion(compilerVersion);

    // Check for old syntax that may require older compiler versions (only for single file mode)
    if (!isStandardJsonInput && sourceCode) {
      const hasOldSyntax =
        sourceCode.includes(':=') ||
        sourceCode.includes('var ') ||
        sourceCode.includes('suicide(') ||
        sourceCode.includes('throw') ||
        sourceCode.includes('constant ') ||
        sourceCode.includes('public constant');
      if (hasOldSyntax) {
        console.warn(
          'Old Solidity syntax detected. Compilation may fail with modern compiler versions.'
        );
        // finalCompilerVersion = '0.8.19'; // do not force
      }
    }

    console.log(`🔧 Using compiler version: ${finalCompilerVersion}`);

    // Get bytecode from blockchain
    let onchainBytecode;
    try {
      onchainBytecode = await web3.eth.getCode(address);
    } catch (web3Error) {
      console.error('Web3 connection error:', web3Error);
      return NextResponse.json(
        {
          error: 'Failed to connect to blockchain node',
          details: 'Please check the WEB3_PROVIDER_URL configuration',
          web3Error: web3Error instanceof Error ? web3Error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    if (onchainBytecode === '0x' || onchainBytecode === '0x0') {
      return NextResponse.json({ error: 'No contract found at this address' }, { status: 404 });
    }

    // A verified contract keeps its source (a second verification used to replace it)
    if (await isAlreadyVerified(address)) {
      return NextResponse.json(
        {
          verified: false,
          alreadyVerified: true,
          error: 'Contract source code already verified',
          message: 'Contract source code already verified',
        },
        { status: 409, headers: getSecurityHeaders() }
      );
    }

    // Clean up source code - remove any trailing garbage
    // For Standard JSON Input mode, cleanedSourceCode will be set later from the input
    let cleanedSourceCode = '';

    if (!isStandardJsonInput && sourceCode) {
      cleanedSourceCode = sourceCode.trim();
    }

    // Check if this is a flattened contract (contains multiple contracts) - only for single file mode
    const isFlattened =
      !isStandardJsonInput &&
      cleanedSourceCode &&
      (cleanedSourceCode.match(/contract\s+[A-Za-z0-9_]+/g) || []).length > 1;

    if (isFlattened) {
      // For flattened contracts (like Hardhat flattened), use the original source as-is
      // This preserves all dependencies, interfaces, libraries, and abstract contracts
      console.log('📦 Detected flattened contract - using original source code as-is');
      // cleanedSourceCode remains unchanged for flattened contracts
    } else {
      // Original logic for single contracts
      const lines = cleanedSourceCode.split('\n');
      const cleanedLines = [];
      let inContract = false;
      let braceCount = 0;
      let inCommentBlock = false;

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Handle comment blocks
        if (trimmedLine.startsWith('/**') || trimmedLine.startsWith('/*')) {
          inCommentBlock = true;
        }
        if (inCommentBlock && trimmedLine.includes('*/')) {
          inCommentBlock = false;
          continue; // Skip the comment block entirely
        }
        if (inCommentBlock) {
          continue; // Skip lines within comment blocks
        }

        // Start of contract
        if (
          trimmedLine.startsWith('contract ') ||
          trimmedLine.startsWith('interface ') ||
          trimmedLine.startsWith('library ') ||
          trimmedLine.startsWith('abstract contract ')
        ) {
          inContract = true;
        }

        if (inContract) {
          // Count braces to track contract structure
          braceCount += (trimmedLine.match(/{/g) || []).length;
          braceCount -= (trimmedLine.match(/}/g) || []).length;

          cleanedLines.push(line);

          // End of contract when brace count reaches 0
          if (braceCount === 0 && inContract) {
            inContract = false;
            break;
          }
        } else if (
          trimmedLine.startsWith('pragma ') ||
          trimmedLine.startsWith('import ') ||
          trimmedLine.startsWith('//') ||
          trimmedLine === ''
        ) {
          cleanedLines.push(line);
        }
      }

      cleanedSourceCode = cleanedLines.join('\n');
    }

    // Additional cleanup: remove any remaining problematic content
    cleanedSourceCode = cleanedSourceCode.replace(/\n\s*\n\s*\n/g, '\n\n'); // Remove excessive newlines
    cleanedSourceCode = cleanedSourceCode.replace(/[^\x00-\x7F]/g, ''); // Remove non-ASCII characters

    // Modernize old Solidity syntax (for 0.8.x compilation)
    cleanedSourceCode = modernizeSyntax(cleanedSourceCode);

    console.log(
      '📏 Original source code length:',
      isStandardJsonInput ? standardJsonInput.length : sourceCode?.length || 0
    );
    console.log('📏 Cleaned source code length:', cleanedSourceCode.length);

    // Prepare compilation input
    let input: Record<string, unknown>;
    let sourceCodeForStorage = cleanedSourceCode;

    if (isStandardJsonInput) {
      // Standard JSON Input mode - parse and use the provided JSON directly
      console.log('📦 Using Standard JSON Input mode');
      try {
        input = JSON.parse(standardJsonInput);

        // Ensure outputSelection is set correctly
        if (!input.settings) {
          input.settings = {};
        }
        const settings = input.settings as Record<string, unknown>;
        settings.outputSelection = {
          '*': {
            '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers'],
          },
        };

        // Store the original Standard JSON Input for reference
        sourceCodeForStorage = standardJsonInput;

        // Extract source code from the first file for license detection
        if (input.sources && typeof input.sources === 'object') {
          const sources = input.sources as Record<string, { content?: string }>;
          const firstSourceKey = Object.keys(sources)[0];
          if (firstSourceKey && sources[firstSourceKey].content) {
            cleanedSourceCode = sources[firstSourceKey].content;
          }
        }
      } catch (parseError) {
        console.error('Failed to parse Standard JSON Input:', parseError);
        return NextResponse.json(
          {
            error: 'Invalid Standard JSON Input format',
            details: parseError instanceof Error ? parseError.message : 'Parse error',
          },
          { status: 400 }
        );
      }
    } else {
      // Single file mode - build the input JSON
      // EVM version: the request's, else config.json compiler.defaultEvmVersion, else the compiler's
      // Match Hardhat's default settings exactly for bytecode compatibility
      input = {
        language: 'Solidity',
        sources: {
          [detectedContractName]: {
            content: cleanedSourceCode,
          },
        },
        settings: {
          outputSelection: {
            '*': {
              '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers'],
            },
          },
          optimizer: {
            enabled: optimization || false,
            runs: body.optimizationRuns || 200,
          },
          evmVersion: body.evmVersion || getCompilerConfig().defaultEvmVersion || undefined,
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

    let compiledOutput;
    try {
      const normalizedVersion = normalizeCompilerVersion(finalCompilerVersion);
      console.log(`🔧 Compiling with solc ${normalizedVersion} in a worker thread...`);

      // Verified release build from the local cache, executed off the event loop
      const compiled = await compileStandardJson({ version: finalCompilerVersion, input });
      compiledOutput = JSON.parse(compiled.output);
      console.log(`✅ Compiled with solc ${compiled.longVersion} in ${compiled.durationMs} ms`);
    } catch (compileError) {
      const described = describeCompileError(compileError);
      console.error('❌ Compilation error:', described.code, described.message);

      return NextResponse.json(
        {
          error: described.status >= 500 ? 'Compiler unavailable' : 'Compilation failed',
          code: described.code,
          details: { message: described.message },
          message:
            described.status >= 500
              ? 'The compiler could not run right now. Please try again later.'
              : 'The source code could not be compiled. Please check the compiler version and the syntax and try again.',
        },
        {
          status: described.status,
          headers: described.retryAfter
            ? { ...getSecurityHeaders(), 'Retry-After': String(described.retryAfter) }
            : getSecurityHeaders(),
        }
      );
    }

    // Check for compilation errors
    if (compiledOutput.errors) {
      const errors = compiledOutput.errors.filter(
        (error: { severity: string }) => error.severity === 'error'
      );
      const warnings = compiledOutput.errors.filter(
        (error: { severity: string }) => error.severity === 'warning'
      );

      console.log('⚠️ Compilation warnings:', warnings.length);
      console.log('❌ Compilation errors:', errors.length);

      if (errors.length > 0) {
        // Format errors for better display
        const formattedErrors = errors.map(
          (error: {
            type?: string;
            message?: string;
            sourceLocation?: unknown;
            formattedMessage?: string;
            severity?: string;
          }) => ({
            type: error.type || 'CompilationError',
            message: error.message || 'Unknown compilation error',
            sourceLocation: error.sourceLocation,
            formattedMessage: error.formattedMessage,
            severity: error.severity,
          })
        );

        return NextResponse.json(
          {
            error: 'Compilation errors',
            details: formattedErrors,
            message: `Found ${errors.length} compilation error(s). Please fix the issues and try again.`,
          },
          { status: 400 }
        );
      }
    }

    // Find the compiled contract
    console.log('Available contracts:', Object.keys(compiledOutput.contracts || {}));

    let compiledContract = null;
    const actualContractName = detectedContractName; // Prefer the detected contract name

    // Check if compiledOutput.contracts exists and has content
    if (!compiledOutput.contracts || Object.keys(compiledOutput.contracts).length === 0) {
      return NextResponse.json(
        {
          error: 'No contracts found in compilation output',
          message:
            'The source code could not be compiled successfully. Please check the syntax and try again.',
          debug: {
            detectedContractName,
            compilationOutput: compiledOutput,
          },
        },
        { status: 400 }
      );
    }

    // Try exact match first
    if (
      compiledOutput.contracts[detectedContractName] &&
      compiledOutput.contracts[detectedContractName][detectedContractName]
    ) {
      compiledContract = compiledOutput.contracts[detectedContractName][detectedContractName];
    } else {
      // Try to find any contract in the output
      for (const sourceName in compiledOutput.contracts) {
        const contracts = compiledOutput.contracts[sourceName];
        for (const contractNameInOutput in contracts) {
          console.log('Found contract:', contractNameInOutput, 'in source:', sourceName);
          if (!compiledContract) {
            compiledContract = contracts[contractNameInOutput];
          }
        }
      }
    }

    if (!compiledContract) {
      return NextResponse.json(
        {
          error: 'Contract not found in compilation output',
          message: `The contract '${detectedContractName}' was not found in the compilation output. Please check the contract name and try again.`,
          debug: {
            requestedContractName: detectedContractName,
            availableContracts: Object.keys(compiledOutput.contracts || {}),
            compilationOutput: compiledOutput,
          },
        },
        { status: 400 }
      );
    }

    // Compare bytecodes
    // IMPORTANT: Use deployedBytecode for comparison with on-chain code
    // The on-chain bytecode is the runtime bytecode (after deployment)
    // The compiled bytecode is the creation bytecode (includes constructor)
    const compiledBytecode =
      compiledContract.evm.deployedBytecode?.object || compiledContract.evm.bytecode.object;
    const creationBytecode = compiledContract.evm.bytecode.object;

    console.log('📊 Bytecode info:');
    console.log('  - Creation bytecode length:', creationBytecode?.length || 0);
    console.log('  - Deployed bytecode length:', compiledBytecode?.length || 0);
    console.log('  - On-chain bytecode length:', onchainBytecode.length);

    // Exact match of the runtime code (immutables, library addresses and, for a partial
    // match, the metadata aside). See lib/contract/bytecode-match.ts.
    const match = matchRuntimeBytecode(onchainBytecode, compiledContract.evm.deployedBytecode);
    const isVerified = match !== null;
    console.log('Verification result:', { address, match: match ?? 'none' });

    if (isVerified) {
      // The SPDX identifier of the contract's own file (the first file of a standard JSON input
      // is usually a dependency)
      const license = spdxLicense(sourceCodeForStorage, actualContractName) || 'None';

      // Save to database
      const contractData = {
        address: address.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: finalCompilerVersion,
        // The settings that were compiled (from the standard JSON input or the form)
        ...compileSettingsRecord(input),
        license: license,
        sourceCode: cleanedSourceCode,
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date(),
      };

      await Contract.findOneAndUpdate({ address: address.toLowerCase() }, contractData, {
        upsert: true,
        new: true,
      });

      return NextResponse.json({
        verified: true,
        contract: contractData,
        message:
          match === 'full'
            ? 'Contract successfully verified'
            : 'Contract successfully verified (partial match: metadata differs)',
      });
    } else {
      const used = compileSettingsRecord(input);
      return NextResponse.json({
        verified: false,
        message: 'Bytecode mismatch - verification failed',
        details: {
          onchainBytecodeLength: onchainBytecode.length,
          compiledBytecodeLength: compiledBytecode.length,
          note: `Compiled with solc ${normalizeCompilerVersion(finalCompilerVersion)} (EVM: ${used.evmVersion}, optimizer: ${used.optimization ? 'enabled' : 'disabled'}, runs: ${used.optimizationRuns}). The runtime code must match the deployed code exactly (only the metadata may differ), so the source, compiler version and settings must be those used for the deployment.`,
        },
      });
    }
  } catch (error) {
    console.error('Contract verification error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        stack:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.stack
              : undefined
            : undefined,
      },
      { status: 500 }
    );
  }
});
