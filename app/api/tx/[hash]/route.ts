import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Transaction, Block, connectDB } from '../../../../models/index';
import { getTransactionTypeGlobal } from '../../../../lib/transaction-utils';
import {
  sanitizeHash,
  isValidHash,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../lib/security';
// import { loadConfig } from '../../../../lib/config';

// Load configuration (unused but kept for future use)
// const config = loadConfig();

// Transaction interface for type safety
interface TransactionDocument {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: Date;
  blockNumber: number;
  gas?: string;
  status: number;
  input?: string;
}

// Block interface for type safety
interface BlockDocument {
  number: number;
  hash: string;
  timestamp: Date;
  miner: string;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`tx:${clientIp}`, 60, 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    const { hash: rawHash } = await params;
    if (!rawHash) {
      return NextResponse.json(
        { error: 'Transaction hash is required' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate and sanitize hash
    if (!isValidHash(rawHash)) {
      return NextResponse.json(
        { error: 'Invalid transaction hash format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const hash = sanitizeHash(rawHash);
    if (!hash) {
      return NextResponse.json(
        { error: 'Invalid transaction hash' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Connect to database with better error handling
    try {
      await connectDB();
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500, headers: getSecurityHeaders() }
      );
    }

    // Find the transaction by hash
    const transaction = (await Transaction.findOne({
      hash: hash,
    }).lean()) as TransactionDocument | null;

    if (!transaction) {
      // --- Mining Reward Transaction fallback ---
      // Try to find a block with this hash (for mining reward tx)
      const block = (await Block.findOne({ hash: hash }).lean()) as BlockDocument | null;
      if (block) {
        // Generate a pseudo-transaction for mining reward
        const miningRewardTx = {
          hash: block.hash,
          from: '0x0000000000000000000000000000000000000000',
          to: block.miner,
          value: (8n * 10n ** 18n).toString(), // 8 VBC in Wei
          timestamp: block.timestamp,
          blockNumber: block.number,
          gas: '0',
          gasUsed: 0,
          gasPrice: '0',
          gasLimit: '0',
          nonce: 0,
          transactionIndex: 0,
          status: 'success',
          input: '',
          inputData: '0x',
          isContractCreation: false,
          logs: [],
          internalTransactions: [],
          blockHash: block.hash,
          cumulativeGasUsed: 0,
          effectiveGasPrice: '0',
          maxFeePerGas: '0',
          maxPriorityFeePerGas: '0',
          type: 0,
          accessList: [],
          v: '0x0',
          r: '0x0',
          s: '0x0',
          isMiningReward: true,
          txType: 'mining_reward',
          txAction: 'Mining Reward',
          block: {
            number: block.number,
            hash: block.hash,
            timestamp: block.timestamp,
            miner: block.miner,
          },
        };
        return NextResponse.json(miningRewardTx, { headers: getSecurityHeaders() });
      }
      // --- End mining reward fallback ---
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    // Get the actual transaction object (handle both array and single object cases)
    const actualTransaction = Array.isArray(transaction) ? transaction[0] : transaction;

    // Find the block that contains this transaction
    const block = (await Block.findOne({
      number: actualTransaction.blockNumber,
    }).lean()) as BlockDocument | null;

    // Determine transaction type
    const typeInfo = getTransactionTypeGlobal({
      from: actualTransaction.from,
      to: actualTransaction.to,
      value: actualTransaction.value || '0',
      input: actualTransaction.input,
      status: actualTransaction.status,
    });

    // トークン転送情報を取得
    const db = mongoose.connection.db;
    let tokenTransfers: Array<Record<string, unknown>> = [];
    
    if (db) {
      const transfers = await db
        .collection('tokentransfers')
        .find({ transactionHash: hash })
        .toArray();
      
      if (transfers.length > 0) {
        // トークン情報を取得
        const tokenAddresses = [...new Set(transfers.map((t) => t.tokenAddress as string))].filter(Boolean);
        const tokenInfoMap = new Map<string, { name: string; symbol: string; decimals: number; type: string }>();
        
        if (tokenAddresses.length > 0) {
          const tokens = await db
            .collection('tokens')
            .find({
              address: { $in: tokenAddresses.map((a) => new RegExp(`^${a}$`, 'i')) },
            })
            .toArray();

          for (const token of tokens) {
            const addr = ((token.address as string) || '').toLowerCase();
            if (addr) {
              tokenInfoMap.set(addr, {
                name: (token.name as string) || 'Unknown Token',
                symbol: (token.symbol as string) || '???',
                decimals: (token.decimals as number) || 18,
                type: (token.type as string) || 'VRC-20',
              });
            }
          }
        }

        // トークン転送をフォーマット
        tokenTransfers = transfers.map((t) => {
          const tokenAddr = ((t.tokenAddress as string) || '').toLowerCase();
          const info = tokenInfoMap.get(tokenAddr);
          return {
            from: t.from,
            to: t.to,
            tokenAddress: t.tokenAddress,
            value: t.value,
            tokenId: t.tokenId,
            name: info?.name || 'Unknown Token',
            symbol: info?.symbol || '???',
            decimals: info?.decimals || 18,
            type: info?.type || 'VRC-20',
          };
        });
      }
    }

    // Transform the transaction data for frontend
    const transformedTransaction = {
      ...actualTransaction,
      // Convert numeric status to string
      status: actualTransaction.status === 1 ? 'success' : 'failed',
      // Add additional fields expected by frontend
      gasLimit: actualTransaction.gas || 'N/A',
      isContractCreation: !actualTransaction.to,
      inputData: actualTransaction.input || '0x',
      logs: [], // Empty array for now, can be populated later if needed
      internalTransactions: [], // Empty array for now, can be populated later if needed
      // MetaMask compliant type info
      txType: typeInfo.type,
      txAction: typeInfo.action,
      // トークン転送情報
      tokenTransfers: tokenTransfers,
      block: block
        ? {
            number: block.number,
            hash: block.hash,
            timestamp: block.timestamp,
            miner: block.miner,
          }
        : null,
    };

    return NextResponse.json(transformedTransaction, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
