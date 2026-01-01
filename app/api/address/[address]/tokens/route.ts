import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../models/index';
import {
  sanitizeAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../../lib/security';

// Token holder schema
const tokenHolderSchema = new mongoose.Schema(
  {
    tokenAddress: String,
    holderAddress: String,
    balance: String,
    percentage: Number,
    rank: Number,
  },
  { collection: 'tokenholders' }
);

const TokenHolder = mongoose.models.TokenHolder || mongoose.model('TokenHolder', tokenHolderSchema);

// Token schema
const tokenSchema = new mongoose.Schema(
  {
    address: String,
    name: String,
    symbol: String,
    decimals: Number,
    totalSupply: String,
    holders: Number,
    type: String,
  },
  { collection: 'tokens' }
);

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`address-tokens:${clientIp}`, 60, 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
        {
          status: 429,
          headers: { ...getSecurityHeaders(), 'Retry-After': String(rateLimit.resetIn) },
        }
      );
    }

    const { address: rawAddress } = await params;

    // Validate address
    const address = sanitizeAddress(rawAddress);
    if (!address) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Find all token holdings for this address
    const holdings = await TokenHolder.find({
      holderAddress: { $regex: new RegExp(`^${address}$`, 'i') },
      balance: { $ne: '0', $exists: true },
    }).lean();

    // Filter out zero balances
    const nonZeroHoldings = holdings.filter((h) => {
      const balance = BigInt(h.balance || '0');
      return balance > 0n;
    });

    // Get token info for each holding
    const tokenAddresses = nonZeroHoldings.map((h) => h.tokenAddress);
    const tokens = await Token.find({
      address: { $in: tokenAddresses.map((a) => new RegExp(`^${a}$`, 'i')) },
    }).lean();

    // Create token info map
    const tokenMap = new Map<string, (typeof tokens)[0]>();
    for (const token of tokens) {
      tokenMap.set(token.address.toLowerCase(), token);
    }

    // Build response with token details
    const tokenHoldings = nonZeroHoldings.map((holding) => {
      const tokenInfo = tokenMap.get(holding.tokenAddress.toLowerCase());
      return {
        address: holding.tokenAddress,
        name: tokenInfo?.name || 'Unknown Token',
        symbol: tokenInfo?.symbol || '???',
        decimals: tokenInfo?.decimals || 18,
        balance: holding.balance,
        type: tokenInfo?.type || 'VRC-20',
        percentage: holding.percentage,
        rank: holding.rank,
      };
    });

    // Sort by balance (converted to number for comparison)
    tokenHoldings.sort((a, b) => {
      const balA = BigInt(a.balance || '0');
      const balB = BigInt(b.balance || '0');
      if (balB > balA) return 1;
      if (balB < balA) return -1;
      return 0;
    });

    return NextResponse.json(
      {
        address,
        tokens: tokenHoldings,
        totalTokens: tokenHoldings.length,
      },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    console.error('Error fetching address tokens:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
