import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Contract } from '../../../../../models/index';
import Web3 from 'web3';
import mongoose from 'mongoose';
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
  
  return {
    nodeAddr: 'localhost',
    port: 8329
  };
};

// Transaction schema for querying creation tx
const transactionSchema = new mongoose.Schema({
  hash: String,
  from: String,
  to: String,
  creates: String,
  blockNumber: Number,
  timestamp: Number
}, { collection: 'Transaction' });

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

const config = readConfig();
const web3 = new Web3(new Web3.providers.HttpProvider(`http://${config.nodeAddr}:${config.port}`));

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

    // Get bytecode from blockchain
    let bytecode = '';
    try {
      bytecode = await web3.eth.getCode(address);
    } catch {
      // ignore
    }

    // Find contract creation transaction from Transaction collection
    let creationTxData: { hash?: string; from?: string; blockNumber?: number } | null = null;
    try {
      const creationTx = await Transaction.findOne({
        creates: { $regex: new RegExp(`^${address}$`, 'i') }
      }).lean();
      
      if (creationTx) {
        const txDoc = Array.isArray(creationTx) ? creationTx[0] : creationTx;
        creationTxData = {
          hash: (txDoc as Record<string, unknown>).hash as string,
          from: (txDoc as Record<string, unknown>).from as string,
          blockNumber: (txDoc as Record<string, unknown>).blockNumber as number
        };
      }
    } catch {
      // ignore
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
        address: address,
        byteCode: bytecode || null,
        // Include creation info from transaction if available
        creationTransaction: creationTxData?.hash || null,
        creator: creationTxData?.from || null,
        blockNumber: creationTxData?.blockNumber || null
      });
    }

    return NextResponse.json({
      verified: contractDoc.verified || false,
      contractName: contractDoc.contractName,
      compilerVersion: contractDoc.compilerVersion,
      optimization: contractDoc.optimization,
      optimizationRuns: (contractDoc as Record<string, unknown>).optimizationRuns || 200,
      evmVersion: (contractDoc as Record<string, unknown>).evmVersion || 'default',
      license: (contractDoc as Record<string, unknown>).license || 'None',
      verifiedAt: contractDoc.verifiedAt,
      hasSourceCode: !!contractDoc.sourceCode,
      hasABI: !!contractDoc.abi,
      address: contractDoc.address,
      sourceCode: contractDoc.sourceCode || null,
      abi: contractDoc.abi || null,
      byteCode: contractDoc.byteCode || bytecode || null,
      blockNumber: contractDoc.blockNumber || creationTxData?.blockNumber || null,
      creationTransaction: contractDoc.creationTransaction || creationTxData?.hash || null,
      owner: contractDoc.owner || creationTxData?.from || null,
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