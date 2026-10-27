import { NextResponse } from 'next/server';
import { connectDB, Block } from '../../../../models/index';
import {
  sanitizeAddress,
  isValidAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../lib/security';
import { enforceRateLimit } from '@/lib/security/rate-limits';

export async function GET(request: Request) {
  try {
    const limited = enforceRateLimit(request, 'api');
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const miner = searchParams.get('miner');

    if (!miner) {
      return NextResponse.json(
        { error: 'Miner parameter is required' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate and sanitize address
    if (!isValidAddress(miner)) {
      return NextResponse.json(
        { error: 'Invalid miner address format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const sanitizedMiner = sanitizeAddress(miner);
    if (!sanitizedMiner) {
      return NextResponse.json(
        { error: 'Invalid miner address' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Get blocks mined by this address (using sanitized lowercase address)
    const blocks = await Block.find({
      miner: sanitizedMiner,
    })
      .sort({ number: -1 })
      .limit(50)
      .lean();

    const formattedBlocks = blocks.map((block: any) => ({
      number: block.number,
      hash: block.hash,
      miner: block.miner,
      timestamp: block.timestamp,
      transactionCount: block.transactionCount || 0,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
    }));

    return NextResponse.json(formattedBlocks, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Blocks by miner search API error:', error);
    return NextResponse.json(
      { error: 'Failed to search blocks' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
