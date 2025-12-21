import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';
import { getTransactionTypeGlobal } from '../../../../lib/transaction-utils';
import Web3 from 'web3';

// Utility: recursively converts BigInt values inside unknown structures to string while preserving shape
function convertBigIntToString(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  }
  
  if (typeof obj === 'object') {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      converted[key] = convertBigIntToString(value);
    }
    return converted;
  }
  
  return obj;
}

// Minimum subset of transaction fields we care about for formatting
interface EthTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: bigint | string | number;
  gas: number | string | bigint;
  gasPrice: bigint | string | number;
  nonce: number;
  input?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const config = loadConfig();
    const web3 = new Web3(config.web3Provider.url);
    
    const resolvedParams = await params;
    const blockNumber = resolvedParams.number;
    
    // Get block information
    const block = await web3.eth.getBlock(blockNumber, true);
    
    if (!block) {
      return NextResponse.json({ 
        error: 'Block not found' 
      }, { status: 404 });
    }
    
    // Get transactions for this block
    const transactions = block.transactions || [];
    
    // Format block data - convert BigInt to string
    const blockData = {
      number: Number(block.number),
      hash: block.hash,
      parentHash: block.parentHash,
      nonce: block.nonce,
      sha3Uncles: block.sha3Uncles,
      logsBloom: block.logsBloom,
      transactionsRoot: block.transactionsRoot,
      stateRoot: block.stateRoot,
      receiptsRoot: block.receiptsRoot,
      miner: block.miner,
      difficulty: block.difficulty ? block.difficulty.toString() : null,
      totalDifficulty: block.totalDifficulty ? block.totalDifficulty.toString() : null,
      extraData: block.extraData,
      size: Number(block.size),
      gasLimit: Number(block.gasLimit),
      gasUsed: Number(block.gasUsed),
      timestamp: Number(block.timestamp),
      transactions: transactions.length,
      uncles: block.uncles || []
    };
    
    // Format transactions data - convert BigInt to string
    const formattedTransactions = await Promise.all((transactions as unknown as EthTransaction[]).map(async (tx, index: number) => {
      // Get transaction receipt for status
      let status = 1; // Default to success
      try {
        const receipt = await web3.eth.getTransactionReceipt(tx.hash);
        status = receipt ? Number(receipt.status) : 1;
      } catch (error) {
        console.warn(`Failed to get receipt for tx ${tx.hash}:`, error);
        status = 1; // Default to success if receipt fetch fails
      }
      
      // Determine transaction type
      const typeInfo = getTransactionTypeGlobal({
        from: tx.from,
        to: tx.to,
        value: tx.value ? tx.value.toString() : '0',
        input: tx.input,
        status: status
      });
      
      return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value ? tx.value.toString() : '0',
      gas: Number(tx.gas),
      gasPrice: tx.gasPrice ? tx.gasPrice.toString() : '0',
      nonce: Number(tx.nonce),
      transactionIndex: index,
      blockNumber: Number(block.number),
      blockHash: block.hash,
        timestamp: Number(block.timestamp),
        status: status,
        type: typeInfo.type,
        action: typeInfo.action
      };
    }));
    
    // Convert any remaining BigInt values
    const responseData = {
      block: convertBigIntToString(blockData),
      transactions: convertBigIntToString(formattedTransactions)
    };
    
    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching block data:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch block data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 