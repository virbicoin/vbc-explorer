import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../models/index';

// Format token amount with proper decimal handling
const formatTokenAmount = (amount: string, decimals: number = 18, isNFT: boolean = false) => {
  if (!amount || amount === 'N/A') return amount;

  try {
    const cleanAmount = amount.replace(/,/g, '');

    if (isNFT) {
      return cleanAmount;
    }

    if (cleanAmount.length > 15) {
      const value = BigInt(cleanAmount);
      const divisor = BigInt(10 ** decimals);
      const formatted = Number(value) / Number(divisor);
      return formatted.toLocaleString();
    }
    const numValue = parseFloat(cleanAmount);
    return numValue.toLocaleString();

  } catch {
    const numValue = parseFloat(amount.replace(/,/g, ''));
    return numValue.toLocaleString();
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    await connectDB();
    const { address } = await params;
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    // Get token info for decimals
    const token = await db.collection('tokens').findOne({
      address: { $regex: new RegExp(`^${address}$`, 'i') }
    });
    
    const decimals = token?.decimals || 18;
    const isNFT = token?.type === 'VRC-721' || token?.type === 'VRC-1155';

    // Find the holder in tokenholders collection
    const holder = await db.collection('tokenholders').findOne({
      tokenAddress: { $regex: new RegExp(`^${address}$`, 'i') },
      holderAddress: { $regex: new RegExp(`^${walletAddress}$`, 'i') }
    });

    if (holder) {
      return NextResponse.json({
        address: walletAddress,
        balance: formatTokenAmount(holder.balance as string, decimals, isNFT),
        balanceRaw: holder.balance,
        percentage: typeof holder.percentage === 'number' ? holder.percentage.toFixed(2) : '0.00',
        rank: holder.rank || null
      });
    }

    // If not found in holders, return 0 balance
    return NextResponse.json({
      address: walletAddress,
      balance: '0',
      balanceRaw: '0',
      percentage: '0.00',
      rank: null
    });

  } catch (error) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance' },
      { status: 500 }
    );
  }
}
