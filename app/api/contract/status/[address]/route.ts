import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '../../../../../models/index';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    await connectDB();
    const { address } = await params;

    if (!address) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    // Find contract in database (case-insensitive search)
    const contract = await Contract.findOne({ 
      address: { $regex: new RegExp(`^${address}$`, 'i') }
    }).lean();

    const contractDoc = Array.isArray(contract) ? contract[0] : contract;

    if (!contractDoc) {
      return NextResponse.json({
        verified: false,
        message: 'Contract not found in database',
        address: address
      });
    }

    return NextResponse.json({
      verified: contractDoc.verified || false,
      contractName: contractDoc.contractName,
      compilerVersion: contractDoc.compilerVersion,
      optimization: contractDoc.optimization,
      verifiedAt: contractDoc.verifiedAt,
      hasSourceCode: !!contractDoc.sourceCode,
      hasABI: !!contractDoc.abi,
      address: contractDoc.address,
      sourceCode: contractDoc.sourceCode || null,
      abi: contractDoc.abi || null,
      byteCode: contractDoc.byteCode || null,
      message: contractDoc.verified ? 'Contract is verified' : 'Contract is not verified'
    });

  } catch (error) {
    console.error('Contract status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 