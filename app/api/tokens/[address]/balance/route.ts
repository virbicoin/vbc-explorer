import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../models/index';
import { requireDb } from '../../../../../lib/db/get-db';
import {
  sanitizeAddress,
  isValidAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../../lib/security';

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
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`token-balance:${clientIp}`, 60, 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    await connectDB();
    const { address } = await params;
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate and sanitize both addresses
    if (!isValidAddress(address) || !isValidAddress(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const sanitizedTokenAddress = sanitizeAddress(address);
    const sanitizedWalletAddress = sanitizeAddress(walletAddress);

    if (!sanitizedTokenAddress || !sanitizedWalletAddress) {
      return NextResponse.json(
        { error: 'Invalid address' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const db = requireDb();

    // Get token info for decimals (using sanitized lowercase address)
    const token = await db.collection('tokens').findOne({
      address: sanitizedTokenAddress,
    });

    const decimals = token?.decimals || 18;
    const isNFT = token?.type === 'VRC-721' || token?.type === 'VRC-1155';

    // Find the holder in tokenholders collection (using sanitized lowercase addresses)
    const holder = await db.collection('tokenholders').findOne({
      tokenAddress: sanitizedTokenAddress,
      holderAddress: sanitizedWalletAddress,
    });

    if (holder) {
      return NextResponse.json(
        {
          address: walletAddress,
          balance: formatTokenAmount(holder.balance as string, decimals, isNFT),
          balanceRaw: holder.balance,
          percentage: typeof holder.percentage === 'number' ? holder.percentage.toFixed(2) : '0.00',
          rank: holder.rank || null,
        },
        { headers: getSecurityHeaders() }
      );
    }

    // If not found in holders, return 0 balance
    return NextResponse.json(
      {
        address: walletAddress,
        balance: '0',
        balanceRaw: '0',
        percentage: '0.00',
        rank: null,
      },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
