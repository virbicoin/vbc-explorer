import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';
import Web3 from 'web3';
import {
  sanitizeAddress,
  isValidAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
  isValidContentType,
} from '../../../../lib/security';

// Allowed methods for security (read-only methods only)
const ALLOWED_METHODS = new Set([
  'name',
  'symbol',
  'decimals',
  'totalSupply',
  'balanceOf',
  'allowance',
  'owner',
  'getOwner',
  'paused',
  'getReserves',
  'token0',
  'token1',
  'factory',
  'WETH',
  'getPair',
  'allPairs',
  'allPairsLength',
  // ERC-721/1155
  'tokenURI',
  'ownerOf',
  'getApproved',
  'isApprovedForAll',
  'uri',
  // Common read methods
  'VERSION',
  'version',
]);

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`contract-interact:${clientIp}`, 30, 5);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    // Validate content type
    if (!isValidContentType(request)) {
      return NextResponse.json(
        { error: 'Invalid content type' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const config = loadConfig();
    const web3 = new Web3(config.web3Provider.url);

    const { contractAddress, abi, method, params, from } = await request.json();

    if (!contractAddress || !abi || !method) {
      return NextResponse.json(
        { error: 'Contract address, ABI, and method are required' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate contract address
    if (!isValidAddress(contractAddress)) {
      return NextResponse.json(
        { error: 'Invalid contract address format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate from address if provided
    if (from && !isValidAddress(from)) {
      return NextResponse.json(
        { error: 'Invalid from address format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate method name (prevent arbitrary method execution)
    if (typeof method !== 'string' || method.length > 100) {
      return NextResponse.json(
        { error: 'Invalid method name' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Check if method is allowed (only read methods)
    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { error: 'Method not allowed. Only read-only methods are supported.' },
        { status: 403, headers: getSecurityHeaders() }
      );
    }

    // Validate ABI structure
    if (!Array.isArray(abi) || abi.length > 500) {
      return NextResponse.json(
        { error: 'Invalid ABI format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate params
    if (params !== undefined && !Array.isArray(params)) {
      return NextResponse.json(
        { error: 'Invalid params format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Sanitize addresses
    const sanitizedContractAddress = sanitizeAddress(contractAddress);
    const sanitizedFrom = from ? sanitizeAddress(from) : undefined;

    const contract = new web3.eth.Contract(abi, sanitizedContractAddress!);

    let result;
    if (sanitizedFrom) {
      result = await contract.methods[method](...(params || [])).call({ from: sanitizedFrom });
    } else {
      result = await contract.methods[method](...(params || [])).call();
    }

    return NextResponse.json({ result }, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Contract interaction error:', error);
    return NextResponse.json(
      {
        error: 'Contract interaction failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}

// GET endpoint to get contract ABI and available methods
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`contract-info:${clientIp}`, 60, 20);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    const config = loadConfig();
    const web3 = new Web3(config.web3Provider.url);

    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get('address');
    const abiParam = searchParams.get('abi');

    if (!contractAddress) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate contract address
    if (!isValidAddress(contractAddress)) {
      return NextResponse.json(
        { error: 'Invalid contract address format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const sanitizedAddress = sanitizeAddress(contractAddress);

    // Check if contract exists
    const code = await web3.eth.getCode(sanitizedAddress!);
    if (code === '0x' || code === '0x0') {
      return NextResponse.json(
        { error: 'No contract found at this address' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    let abi;
    if (abiParam) {
      try {
        abi = JSON.parse(abiParam);
        if (!Array.isArray(abi) || abi.length > 500) {
          return NextResponse.json(
            { error: 'Invalid ABI format' },
            { status: 400, headers: getSecurityHeaders() }
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'Invalid ABI format' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
    } else {
      // Return basic contract info without ABI
      return NextResponse.json(
        {
          address: sanitizedAddress,
          hasCode: true,
          message: 'Contract found. Provide ABI to get available methods.',
        },
        { headers: getSecurityHeaders() }
      );
    }

    // Parse ABI and categorize methods
    const methods = abi
      .filter((item: { type: string }) => item.type === 'function')
      .map(
        (item: {
          name: string;
          stateMutability: string;
          inputs?: Array<{ name: string; type: string }>;
          outputs?: Array<{ name: string; type: string }>;
        }) => ({
          name: item.name,
          type:
            item.stateMutability === 'view' || item.stateMutability === 'pure' ? 'read' : 'write',
          inputs: item.inputs || [],
          outputs: item.outputs || [],
          stateMutability: item.stateMutability,
        })
      );

    const readMethods = methods.filter((m: { type: string }) => m.type === 'read');
    const writeMethods = methods.filter((m: { type: string }) => m.type === 'write');

    return NextResponse.json(
      {
        address: sanitizedAddress,
        hasCode: true,
        abi,
        methods: {
          read: readMethods,
          write: writeMethods,
          all: methods,
        },
      },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    console.error('Contract info error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
