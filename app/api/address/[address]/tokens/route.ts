import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../models/index';
import { getWeb3 } from '../../../../../lib/web3';
import {
  sanitizeAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../../lib/security';

// Get shared Web3 instance
const web3 = getWeb3();

// Launchpad V2 Token ABI for logoUrl
const LAUNCHPAD_V2_ABI = [
  {
    inputs: [],
    name: 'logoUrl',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Function to fetch logoUrl from Launchpad V2 token contract
async function fetchLaunchpadLogoUrl(tokenAddress: string): Promise<string | null> {
  try {
    const contract = new web3.eth.Contract(LAUNCHPAD_V2_ABI, tokenAddress);
    const logoUrl = await contract.methods.logoUrl().call();
    return logoUrl && logoUrl !== '' ? (logoUrl as string) : null;
  } catch {
    // Token doesn't have logoUrl method (not a Launchpad V2 token)
    return null;
  }
}

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
    logoUrl: String,
    metadata: {
      logoUrl: String,
      description: String,
      website: String,
    },
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

    // Build response with token details (fetch logoUrl from onchain if not in DB)
    const tokenHoldings = await Promise.all(
      nonZeroHoldings.map(async (holding) => {
        const tokenInfo = tokenMap.get(holding.tokenAddress.toLowerCase());
        // Get logo URL from token metadata or direct field
        let logoUrl = tokenInfo?.logoUrl || tokenInfo?.metadata?.logoUrl || null;

        // If no logoUrl in DB, try to fetch from onchain (Launchpad V2 token)
        if (!logoUrl) {
          try {
            const onchainLogoUrl = await fetchLaunchpadLogoUrl(holding.tokenAddress);
            if (onchainLogoUrl) {
              logoUrl = onchainLogoUrl;
            }
          } catch {
            // Ignore errors
          }
        }

        return {
          address: holding.tokenAddress,
          name: tokenInfo?.name || 'Unknown Token',
          symbol: tokenInfo?.symbol || '???',
          // Use nullish coalescing to handle decimals=0 correctly
          decimals: tokenInfo?.decimals ?? 18,
          balance: holding.balance,
          // Normalize token type display
          type:
            tokenInfo?.type === 'ERC20'
              ? 'VRC-20'
              : tokenInfo?.type === 'ERC721'
                ? 'VRC-721'
                : tokenInfo?.type || 'VRC-20',
          percentage: holding.percentage,
          rank: holding.rank,
          logoUrl: logoUrl,
        };
      })
    );

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
