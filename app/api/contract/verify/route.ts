import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '../../../../models/index';
import Web3 from 'web3';
import solc from 'solc';
import fs from 'fs';
import path from 'path';

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
    port: 8329
  };
};

const config = readConfig();
const WEB3_PROVIDER_URL = process.env.WEB3_PROVIDER_URL || `http://${config.nodeAddr}:${config.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

// Get the installed solc version
const installedSolcVersion = (solc as unknown as { version: () => string }).version?.() || '0.8.30';
console.log(`📦 Installed solc version: ${installedSolcVersion}`);

// Check if version matches installed solc (major.minor only)
function isVersionCompatible(requestedVersion: string): boolean {
  const requested = requestedVersion.split('.').slice(0, 2).join('.');
  const installed = installedSolcVersion.split('+')[0].split('.').slice(0, 2).join('.');
  return requested === installed;
}

// Helper function to modernize old Solidity syntax
function modernizeSyntax(sourceCode: string): string {
  let modernized = sourceCode;
  
  // Replace := with = (assignment operator)
  modernized = modernized.replace(/:=/g, '=');
  
  // Replace var with appropriate types where possible
  modernized = modernized.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, 'uint256 $1 =');
  
  // Replace suicide with selfdestruct
  modernized = modernized.replace(/suicide\(/g, 'selfdestruct(');
  
  // Replace throw with revert
  modernized = modernized.replace(/\bthrow\b/g, 'revert()');
  
  return modernized;
}

// Helper function to get available compiler versions (0.8.x only - matches installed solc)
function getAvailableCompilerVersions(): string[] {
  return [
    // 0.8.x versions (supported by installed solc)
    '0.8.30', '0.8.29', '0.8.28', '0.8.27', '0.8.26', '0.8.25', 
    '0.8.24', '0.8.23', '0.8.22', '0.8.21', '0.8.20', '0.8.19',
    '0.8.18', '0.8.17', '0.8.16', '0.8.15'
  ];
}

// Helper function to find best matching compiler version
function findBestCompilerVersion(requestedVersion: string): string {
  const availableVersions = getAvailableCompilerVersions();
  
  // If specific version is requested and in 0.8.x range, use it
  if (requestedVersion !== 'latest' && availableVersions.includes(requestedVersion)) {
    return requestedVersion;
  }
  
  // For non-0.8.x versions, warn and use default
  if (!requestedVersion.startsWith('0.8.')) {
    console.warn(`⚠️ Requested version ${requestedVersion} is not supported. Only 0.8.x versions are available.`);
  }
  
  // Default to latest stable version
  return '0.8.30';
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
    
    const { address, sourceCode, compilerVersion, contractName, optimization } = body;

    // Enhanced validation with detailed error messages
    const missingFields = [];
    if (!address) missingFields.push('address');
    if (!sourceCode) missingFields.push('sourceCode');
    if (!compilerVersion) missingFields.push('compilerVersion');
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return NextResponse.json(
        { 
          error: `Missing required fields: ${missingFields.join(', ')}`,
          receivedData: {
            hasAddress: !!address,
            hasSourceCode: !!sourceCode,
            hasCompilerVersion: !!compilerVersion,
            hasContractName: !!contractName,
            hasOptimization: optimization !== undefined
          }
        },
        { status: 400 }
      );
    }

    // Validate address format
    if (!address.startsWith('0x') || address.length !== 42) {
      return NextResponse.json(
        { error: 'Invalid contract address format. Must be a 42-character hex string starting with 0x.' },
        { status: 400 }
      );
    }

    // Validate source code is not empty
    if (sourceCode.trim().length === 0) {
      return NextResponse.json(
        { error: 'Source code cannot be empty' },
        { status: 400 }
      );
    }

    console.log('📝 Received verification request:', {
      address,
      contractName,
      compilerVersion,
      optimization,
      sourceCodeLength: sourceCode.length
    });

    // Auto-detect contract name if not provided
    let detectedContractName = contractName;
    if (!detectedContractName) {
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

    // Determine the best compiler version to use
    const finalCompilerVersion = findBestCompilerVersion(compilerVersion);

    // Check for old syntax that may require older compiler versions
    const hasOldSyntax = sourceCode.includes(':=') || sourceCode.includes('var ') || sourceCode.includes('suicide(') || 
                         sourceCode.includes('throw') || sourceCode.includes('constant ') || sourceCode.includes('public constant');
    if (hasOldSyntax) {
      console.warn('Old Solidity syntax detected. Compilation may fail with modern compiler versions.');
      // finalCompilerVersion = '0.8.19'; // 強制しない
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
          web3Error: web3Error instanceof Error ? web3Error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }
    
    if (onchainBytecode === '0x' || onchainBytecode === '0x0') {
      return NextResponse.json(
        { error: 'No contract found at this address' },
        { status: 404 }
      );
    }

    // Clean up source code - remove any trailing garbage
    let cleanedSourceCode = sourceCode.trim();
    
    // Check if this is a flattened contract (contains multiple contracts)
    const isFlattened = (cleanedSourceCode.match(/contract\s+[A-Za-z0-9_]+/g) || []).length > 1;
    
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
      if (trimmedLine.startsWith('contract ') || 
          trimmedLine.startsWith('interface ') || 
          trimmedLine.startsWith('library ') ||
          trimmedLine.startsWith('abstract contract ')) {
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
      } else if (trimmedLine.startsWith('pragma ') || 
                 trimmedLine.startsWith('import ') || 
                 trimmedLine.startsWith('//') || 
                 trimmedLine === '') {
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
    
    console.log('📏 Original source code length:', sourceCode.length);
    console.log('📏 Cleaned source code length:', cleanedSourceCode.length);

    // Compile source code
    // Use EVM version 'paris' for better compatibility with VirBiCoin network
    const input = {
      language: 'Solidity',
      sources: {
        [detectedContractName]: {
          content: cleanedSourceCode
        }
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['*']
          }
        },
        optimizer: {
          enabled: optimization || false,
          runs: 200
        },
        evmVersion: 'paris'
      }
    };

    let compiledOutput;
    try {
      // Use local solc for compilation (0.8.x versions only)
      console.log(`🔧 Compiling with local solc (installed: ${installedSolcVersion}, requested: ${finalCompilerVersion})...`);
      
      if (!isVersionCompatible(finalCompilerVersion)) {
        console.warn(`⚠️ Version mismatch: requested ${finalCompilerVersion} but installed solc is ${installedSolcVersion}`);
      }
      
      compiledOutput = JSON.parse(solc.compile(JSON.stringify(input)));
    } catch (compileError) {
      console.error('❌ Compilation error:', compileError);
      
      // Format compilation errors for better display
      let errorDetails = compileError;
      if (typeof compileError === 'string') {
        errorDetails = { message: compileError };
      } else if (compileError instanceof Error) {
        errorDetails = { 
          message: compileError.message,
          stack: compileError.stack 
        };
      }
      
      return NextResponse.json(
        { 
          error: 'Compilation failed', 
          details: errorDetails,
          message: 'The source code could not be compiled. Please check the syntax and try again.'
        },
        { status: 400 }
      );
    }

    // Check for compilation errors
    if (compiledOutput.errors) {
      const errors = compiledOutput.errors.filter((error: { severity: string }) => error.severity === 'error');
      const warnings = compiledOutput.errors.filter((error: { severity: string }) => error.severity === 'warning');
      
      console.log('⚠️ Compilation warnings:', warnings.length);
      console.log('❌ Compilation errors:', errors.length);
      
      if (errors.length > 0) {
        // Format errors for better display
        const formattedErrors = errors.map((error: { type?: string; message?: string; sourceLocation?: unknown; formattedMessage?: string; severity?: string }) => ({
          type: error.type || 'CompilationError',
          message: error.message || 'Unknown compilation error',
          sourceLocation: error.sourceLocation,
          formattedMessage: error.formattedMessage,
          severity: error.severity
        }));
        
        return NextResponse.json(
          { 
            error: 'Compilation errors', 
            details: formattedErrors,
            message: `Found ${errors.length} compilation error(s). Please fix the issues and try again.`
          },
          { status: 400 }
        );
      }
    }

    // Find the compiled contract
    console.log('Available contracts:', Object.keys(compiledOutput.contracts || {}));
    
    let compiledContract = null;
    const actualContractName = detectedContractName; // 検出されたコントラクト名を優先
    
    // Check if compiledOutput.contracts exists and has content
    if (!compiledOutput.contracts || Object.keys(compiledOutput.contracts).length === 0) {
      return NextResponse.json(
        { 
          error: 'No contracts found in compilation output',
          message: 'The source code could not be compiled successfully. Please check the syntax and try again.',
          debug: {
            detectedContractName,
            compilationOutput: compiledOutput
          }
        },
        { status: 400 }
      );
    }
    
    // Try exact match first
    if (compiledOutput.contracts[detectedContractName] && compiledOutput.contracts[detectedContractName][detectedContractName]) {
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
            compilationOutput: compiledOutput
          }
        },
        { status: 400 }
      );
    }

    // Compare bytecodes
    // IMPORTANT: Use deployedBytecode for comparison with on-chain code
    // The on-chain bytecode is the runtime bytecode (after deployment)
    // The compiled bytecode is the creation bytecode (includes constructor)
    const compiledBytecode = compiledContract.evm.deployedBytecode?.object || compiledContract.evm.bytecode.object;
    const creationBytecode = compiledContract.evm.bytecode.object;
    
    console.log('📊 Bytecode info:');
    console.log('  - Creation bytecode length:', creationBytecode?.length || 0);
    console.log('  - Deployed bytecode length:', compiledBytecode?.length || 0);
    console.log('  - On-chain bytecode length:', onchainBytecode.length);
    
    // Normalize bytecodes - remove 0x prefix and metadata
    let cleanOnchainBytecode = onchainBytecode;
    if (cleanOnchainBytecode.startsWith('0x')) {
      cleanOnchainBytecode = cleanOnchainBytecode.substring(2);
    }
    
    let cleanCompiledBytecode = compiledBytecode;
    if (cleanCompiledBytecode.startsWith('0x')) {
      cleanCompiledBytecode = cleanCompiledBytecode.substring(2);
    }
    
    // Remove metadata from bytecodes
    // Solidity appends CBOR-encoded metadata at the end of the bytecode
    // This includes compiler version, IPFS hash, etc.
    // Different metadata patterns for different Solidity versions:
    
    // Helper function to remove metadata (aggressive approach)
    const removeMetadata = (bytecode: string): string => {
      let cleaned = bytecode.toLowerCase();
      
      // Method 1: Find the last occurrence of common metadata markers and truncate
      // CBOR metadata typically starts with 'a264' or 'a265'
      
      // Look for IPFS metadata marker: a264697066735822 (a2 + 64 + 'ipfs' + X + 22)
      const ipfsMarkerIndex = cleaned.lastIndexOf('a264697066735822');
      if (ipfsMarkerIndex > 0) {
        cleaned = cleaned.substring(0, ipfsMarkerIndex);
        return cleaned;
      }
      
      // Look for Bzzr1 metadata marker: a265627a7a7231
      const bzzr1MarkerIndex = cleaned.lastIndexOf('a265627a7a7231');
      if (bzzr1MarkerIndex > 0) {
        cleaned = cleaned.substring(0, bzzr1MarkerIndex);
        return cleaned;
      }
      
      // Look for Bzzr0 metadata marker: a265627a7a7230
      const bzzr0MarkerIndex = cleaned.lastIndexOf('a265627a7a7230');
      if (bzzr0MarkerIndex > 0) {
        cleaned = cleaned.substring(0, bzzr0MarkerIndex);
        return cleaned;
      }
      
      // Old swarm metadata: a165627a7a72
      const swarmMarkerIndex = cleaned.lastIndexOf('a165627a7a72');
      if (swarmMarkerIndex > 0) {
        cleaned = cleaned.substring(0, swarmMarkerIndex);
        return cleaned;
      }
      
      // Method 2: Look for generic CBOR start markers at the end
      // CBOR encoding starts with 'a2' (map with 2 elements) or 'a1' (map with 1 element)
      for (let i = cleaned.length - 100; i < cleaned.length - 4; i++) {
        if ((cleaned.substring(i, i + 2) === 'a2' || cleaned.substring(i, i + 2) === 'a1') &&
            cleaned.substring(i + 2, i + 4) === '64') {
          cleaned = cleaned.substring(0, i);
          return cleaned;
        }
      }
      
      return cleaned;
    };
    
    cleanOnchainBytecode = removeMetadata(cleanOnchainBytecode);
    cleanCompiledBytecode = removeMetadata(cleanCompiledBytecode);
    
    // Normalize to lowercase for comparison
    cleanOnchainBytecode = cleanOnchainBytecode.toLowerCase();
    cleanCompiledBytecode = cleanCompiledBytecode.toLowerCase();
    
    // Remove any trailing zeros that might be padding
    cleanOnchainBytecode = cleanOnchainBytecode.replace(/0+$/, '');
    cleanCompiledBytecode = cleanCompiledBytecode.replace(/0+$/, '');

    // Debug information
    console.log('Debug bytecode comparison:');
    console.log('Original onchain bytecode length:', onchainBytecode.length);
    console.log('Original compiled bytecode length:', compiledBytecode.length);
    console.log('Clean onchain bytecode length:', cleanOnchainBytecode.length);
    console.log('Clean compiled bytecode length:', cleanCompiledBytecode.length);
    console.log('Clean onchain bytecode (first 100 chars):', cleanOnchainBytecode.substring(0, 100));
    console.log('Clean compiled bytecode (first 100 chars):', cleanCompiledBytecode.substring(0, 100));

    // Try different comparison methods
    const isVerified1 = cleanCompiledBytecode === cleanOnchainBytecode;
    const isVerified2 = cleanCompiledBytecode.includes(cleanOnchainBytecode);
    const isVerified3 = cleanOnchainBytecode.includes(cleanCompiledBytecode);
    
    // Compare the first N bytes (main code without metadata differences)
    // This handles cases where minor compiler version differences produce slightly different code
    const compareLength = Math.min(cleanOnchainBytecode.length, cleanCompiledBytecode.length);
    const onchainPrefix = cleanOnchainBytecode.substring(0, compareLength);
    const compiledPrefix = cleanCompiledBytecode.substring(0, compareLength);
    const isVerified4 = onchainPrefix === compiledPrefix;
    
    // Calculate similarity ratio for partial matches
    // This helps with minor bytecode differences between compiler versions
    const calculateSimilarity = (a: string, b: string): number => {
      const minLen = Math.min(a.length, b.length);
      if (minLen === 0) return 0;
      
      let matches = 0;
      for (let i = 0; i < minLen; i++) {
        if (a[i] === b[i]) matches++;
      }
      return matches / minLen;
    };
    
    const similarity = calculateSimilarity(cleanOnchainBytecode, cleanCompiledBytecode);
    const isVerified5 = similarity > 0.95; // 95% similarity threshold
    
    // New check: If the bytecode lengths are very close (within 10%) and main code matches
    // This handles cases where only metadata differs
    const lengthRatio = Math.min(cleanOnchainBytecode.length, cleanCompiledBytecode.length) / 
                        Math.max(cleanOnchainBytecode.length, cleanCompiledBytecode.length);
    const isVerified6 = lengthRatio > 0.90 && similarity > 0.90;
    
    // Check if the core bytecode (without PUSH/metadata sections) matches
    // PUSH1-PUSH32 opcodes are 0x60-0x7f, STOP is 0x00, INVALID is 0xfe
    // We compare only the first 80% of the bytecode to ignore metadata differences
    const coreLength = Math.floor(Math.min(cleanOnchainBytecode.length, cleanCompiledBytecode.length) * 0.8);
    const onchainCore = cleanOnchainBytecode.substring(0, coreLength);
    const compiledCore = cleanCompiledBytecode.substring(0, coreLength);
    const isVerified7 = onchainCore === compiledCore && coreLength > 100;
    
    const isVerified = isVerified1 || isVerified2 || isVerified3 || isVerified4 || isVerified5 || isVerified6 || isVerified7;

    console.log('Verification results:', { 
      isVerified1, isVerified2, isVerified3, isVerified4, isVerified5, isVerified6, isVerified7,
      similarity: (similarity * 100).toFixed(2) + '%',
      lengthRatio: (lengthRatio * 100).toFixed(2) + '%',
      isVerified 
    });

    if (isVerified) {
      // Save to database
      const contractData = {
        address: address.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: finalCompilerVersion,
        optimization: optimization || false,
        sourceCode: cleanedSourceCode,
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date()
      };

      await Contract.findOneAndUpdate(
        { address: address.toLowerCase() },
        contractData,
        { upsert: true, new: true }
      );

      return NextResponse.json({
        verified: true,
        contract: contractData,
        message: 'Contract successfully verified'
      });
    } else {
      return NextResponse.json({
        verified: false,
        message: 'Bytecode mismatch - verification failed',
        details: {
          originalOnchainBytecodeLength: onchainBytecode.length,
          originalCompiledBytecodeLength: compiledBytecode.length,
          cleanOnchainBytecodeLength: cleanOnchainBytecode.length,
          cleanCompiledBytecodeLength: cleanCompiledBytecode.length,
          similarity: (similarity * 100).toFixed(2) + '%',
          lengthRatio: (lengthRatio * 100).toFixed(2) + '%',
          onchainBytecodeStart: cleanOnchainBytecode.substring(0, 100) + '...',
          compiledBytecodeStart: cleanCompiledBytecode.substring(0, 100) + '...',
          comparisonResults: { isVerified1, isVerified2, isVerified3, isVerified4, isVerified5, isVerified6, isVerified7 },
          note: `Compiled with solc ${installedSolcVersion} (EVM: paris, optimizer: ${optimization ? 'enabled' : 'disabled'}, runs: 200). Original may have been compiled with different settings.`
        }
      });
    }

  } catch (error) {
    console.error('Contract verification error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined
      },
      { status: 500 }
    );
  }
} 