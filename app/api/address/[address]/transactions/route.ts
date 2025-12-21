import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../models/index';

// Transaction schema - 正しいコレクション名を使用
const transactionSchema = new mongoose.Schema({
  hash: String,
  from: String,
  to: String,
  value: String,
  timestamp: Number,
  blockNumber: Number,
  input: String,
  gasUsed: Number,
  gasPrice: String,
  status: Number,
  nonce: Number
}, { collection: 'Transaction' });

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

// MetaMask準拠のトランザクションタイプを判定
const METHOD_IDS: Record<string, { type: string; action: string }> = {
  // ERC20
  '0xa9059cbb': { type: 'token_transfer', action: 'Transfer' },
  '0x23b872dd': { type: 'token_transfer', action: 'Transfer From' },
  '0x095ea7b3': { type: 'approve', action: 'Approve' },
  '0x39509351': { type: 'approve', action: 'Increase Allowance' },
  '0xa457c2d7': { type: 'approve', action: 'Decrease Allowance' },
  // ERC721/1155
  '0x42842e0e': { type: 'nft_transfer', action: 'Safe Transfer' },
  '0xb88d4fde': { type: 'nft_transfer', action: 'Safe Transfer' },
  '0xf242432a': { type: 'nft_transfer', action: 'Safe Transfer (ERC1155)' },
  '0x2eb2c2d6': { type: 'nft_transfer', action: 'Batch Transfer (ERC1155)' },
  '0xa22cb465': { type: 'approve', action: 'Set Approval For All' },
  '0xeacabe14': { type: 'mint', action: 'Mint NFT' },
  '0x40c10f19': { type: 'mint', action: 'Mint' },
  '0x6a627842': { type: 'mint', action: 'Mint' },
  // DEX
  '0x7ff36ab5': { type: 'swap', action: 'Swap ETH for Tokens' },
  '0x18cbafe5': { type: 'swap', action: 'Swap Tokens for ETH' },
  '0x38ed1739': { type: 'swap', action: 'Swap Tokens for Tokens' },
  '0xfb3bdb41': { type: 'swap', action: 'Swap ETH for Exact Tokens' },
  '0x4a25d94a': { type: 'swap', action: 'Swap Tokens for Exact ETH' },
  '0x8803dbee': { type: 'swap', action: 'Swap Tokens for Exact Tokens' },
  '0x5c11d795': { type: 'swap', action: 'Swap Exact Tokens' },
  '0xe8e33700': { type: 'liquidity', action: 'Add Liquidity' },
  '0xf305d719': { type: 'liquidity', action: 'Add Liquidity ETH' },
  '0xbaa2abde': { type: 'liquidity', action: 'Remove Liquidity' },
  '0x02751cec': { type: 'liquidity', action: 'Remove Liquidity ETH' },
  '0xaf2979eb': { type: 'liquidity', action: 'Remove Liquidity ETH Permit' },
  // MasterChef / Staking
  '0xe2bbb158': { type: 'stake', action: 'Deposit (Stake)' },
  '0x441a3e70': { type: 'unstake', action: 'Withdraw (Unstake)' },
  '0x1058d281': { type: 'harvest', action: 'Harvest' },
  '0xddc63262': { type: 'harvest', action: 'Harvest All' },
  '0xfb12a6f5': { type: 'harvest', action: 'Harvest (Enter Staking)' },
  '0x8dbdbe6d': { type: 'harvest', action: 'Deposit' },
  '0x5312ea8e': { type: 'unstake', action: 'Emergency Withdraw' },
  // Burn
  '0x42966c68': { type: 'burn', action: 'Burn' },
  '0x79cc6790': { type: 'burn', action: 'Burn From' },
  '0x9dc29fac': { type: 'burn', action: 'Burn' },
};

function getTransactionType(
  tx: { from: string; to: string | null; value: string; input?: string },
  address: string,
  tokenTxHashes: Set<string>,
  txHash?: string
): { type: string; action: string; direction: 'in' | 'out' | 'self' } {
  const input = tx.input || '0x';
  const methodId = input.slice(0, 10).toLowerCase();
  const isFromAddress = tx.from.toLowerCase() === address.toLowerCase();
  const isToAddress = tx.to?.toLowerCase() === address.toLowerCase();
  
  let direction: 'in' | 'out' | 'self' = 'out';
  if (isFromAddress && isToAddress) direction = 'self';
  else if (isToAddress) direction = 'in';
  
  // Contract creation
  if (!tx.to || tx.to === '0x0000000000000000000000000000000000000000') {
    if (isFromAddress) {
      return { type: 'contract_creation', action: 'Contract Deploy', direction: 'out' };
    }
  }
  
  // Token transfer check
  if (txHash && tokenTxHashes.has(txHash.toLowerCase())) {
    const method = METHOD_IDS[methodId];
    if (method) return { ...method, direction };
    return { type: 'token_transfer', action: 'Token Transfer', direction };
  }
  
  // Method ID check
  const method = METHOD_IDS[methodId];
  if (method) return { ...method, direction };
  
  // Contract interaction
  if (input && input !== '0x' && input.length > 2) {
    return { type: 'contract_interaction', action: 'Contract Interaction', direction };
  }
  
  // Native transfer
  const value = BigInt(tx.value || '0');
  if (value > 0n) {
    return direction === 'in' 
      ? { type: 'receive', action: 'Receive', direction }
      : { type: 'send', action: 'Send', direction };
  }
  
  return { type: 'unknown', action: 'Unknown', direction };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    await connectDB();
  } catch (dbError) {
    console.error('Database connection error:', dbError);
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
  }
  
  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const skip = (page - 1) * limit;

  try {
    const db = mongoose.connection.db;
    
    // 通常のトランザクションを取得
    const transactions = await Transaction.find({
      $or: [
        { from: { $regex: new RegExp(`^${address}$`, 'i') } },
        { to: { $regex: new RegExp(`^${address}$`, 'i') } }
      ]
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    // 総件数を取得
    const totalTransactions = await Transaction.countDocuments({
      $or: [
        { from: { $regex: new RegExp(`^${address}$`, 'i') } },
        { to: { $regex: new RegExp(`^${address}$`, 'i') } }
      ]
    });

    // トークン転送を取得
    const tokenTransfers = db ? await db.collection('tokentransfers').find({
      $or: [
        { from: { $regex: new RegExp(`^${address}$`, 'i') } },
        { to: { $regex: new RegExp(`^${address}$`, 'i') } }
      ]
    }).toArray() : [];
    
    const tokenTxHashes = new Set(tokenTransfers.map(t => String((t as Record<string, unknown>).transactionHash || '').toLowerCase()));
    
    // トークン情報を取得
    const tokenAddresses = [...new Set(tokenTransfers.map(t => (t as Record<string, unknown>).tokenAddress as string))].filter(Boolean);
    const tokenInfoMap = new Map<string, { name: string; symbol: string; decimals: number; type: string }>();
    
    if (db && tokenAddresses.length > 0) {
      const tokens = await db.collection('tokens').find({
        address: { $in: tokenAddresses.map(a => new RegExp(`^${a}$`, 'i')) }
      }).toArray();
      
      for (const token of tokens) {
        const t = token as Record<string, unknown>;
        const addr = (t.address as string || '').toLowerCase();
        if (addr) {
          tokenInfoMap.set(addr, {
            name: t.name as string || 'Unknown Token',
            symbol: t.symbol as string || '???',
            decimals: t.decimals as number || 18,
            type: t.type as string || 'VRC-20'
          });
        }
      }
    }
    
    // トークン転送をハッシュでマップ化
    const tokenTransferMap = new Map<string, Record<string, unknown>[]>();
    for (const tt of tokenTransfers) {
      const t = tt as Record<string, unknown>;
      const hash = String(t.transactionHash || '').toLowerCase();
      if (!tokenTransferMap.has(hash)) {
        tokenTransferMap.set(hash, []);
      }
      tokenTransferMap.get(hash)!.push(t);
    }

    const totalPages = Math.ceil(totalTransactions / limit);

    // トランザクションデータをフォーマット
    const formattedTransactions = transactions.map(tx => {
      const txData = tx as unknown as Record<string, unknown>;
      const hash = String(txData.hash || '').toLowerCase();
      
      const txType = getTransactionType(
        {
          from: txData.from as string,
          to: txData.to as string | null,
          value: txData.value as string,
          input: txData.input as string | undefined
        },
        address,
        tokenTxHashes,
        hash
      );
      
      const result: Record<string, unknown> = {
        hash: txData.hash,
        from: txData.from,
        to: txData.to,
        value: txData.value,
        timestamp: txData.timestamp,
        blockNumber: txData.blockNumber,
        type: txType.type,
        action: txType.action,
        direction: txType.direction,
        status: (txData.status as number) === 1 ? 'success' : 'failed',
        gasUsed: txData.gasUsed,
        gasPrice: txData.gasPrice
      };
      
      // トークン情報を追加
      const tokenTransfersForTx = tokenTransferMap.get(hash);
      if (tokenTransfersForTx && tokenTransfersForTx.length > 0) {
        const tt = tokenTransfersForTx[0];
        const tokenAddr = (tt.tokenAddress as string).toLowerCase();
        const tokenInfo = tokenInfoMap.get(tokenAddr);
        
        result.tokenInfo = {
          address: tt.tokenAddress,
          name: tokenInfo?.name || 'Unknown Token',
          symbol: tokenInfo?.symbol || '???',
          decimals: tokenInfo?.decimals || 18,
          type: tokenInfo?.type || 'VRC-20',
          value: tt.value,
          tokenId: tt.tokenId
        };
        
        // NFTの場合
        if (tt.tokenId !== undefined && tt.tokenId !== null) {
          result.nftInfo = {
            tokenId: tt.tokenId,
            tokenAddress: tt.tokenAddress
          };
          result.type = 'nft_transfer';
          result.action = txType.action === 'Transfer' ? 'NFT Transfer' : txType.action;
        }
      }
      
      return result;
    });

    return NextResponse.json({
      transactions: formattedTransactions,
      totalTransactions,
      totalPages,
      currentPage: page,
      itemsPerPage: limit
    });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
