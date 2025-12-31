import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';
import Web3 from 'web3';

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const web3 = new Web3(config.web3Provider.url);

    const { contractAddress, abi, method, params, from } = await request.json();

    if (!contractAddress || !abi || !method) {
      return NextResponse.json(
        {
          error: 'Contract address, ABI, and method are required',
        },
        { status: 400 }
      );
    }

    const contract = new web3.eth.Contract(abi, contractAddress);

    let result;
    if (from) {
      // Call with specific sender address
      result = await contract.methods[method](...params).call({ from });
    } else {
      // Call without specific sender
      result = await contract.methods[method](...params).call();
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error('Contract interaction error:', error);
    return NextResponse.json(
      {
        error: 'Contract interaction failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET endpoint to get contract ABI and available methods
export async function GET(request: NextRequest) {
  try {
    const config = loadConfig();
    const web3 = new Web3(config.web3Provider.url);

    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get('address');
    const abiParam = searchParams.get('abi');

    if (!contractAddress) {
      return NextResponse.json({ error: 'Contract address is required' }, { status: 400 });
    }

    // Check if contract exists
    const code = await web3.eth.getCode(contractAddress);
    if (code === '0x' || code === '0x0') {
      return NextResponse.json({ error: 'No contract found at this address' }, { status: 404 });
    }

    let abi;
    if (abiParam) {
      try {
        abi = JSON.parse(abiParam);
      } catch {
        return NextResponse.json({ error: 'Invalid ABI format' }, { status: 400 });
      }
    } else {
      // Return basic contract info without ABI
      return NextResponse.json({
        address: contractAddress,
        hasCode: true,
        message: 'Contract found. Provide ABI to get available methods.',
      });
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

    return NextResponse.json({
      address: contractAddress,
      hasCode: true,
      abi,
      methods: {
        read: readMethods,
        write: writeMethods,
        all: methods,
      },
    });
  } catch (error) {
    console.error('Contract info error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
