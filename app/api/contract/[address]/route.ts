import { NextRequest, NextResponse } from 'next/server';
import { Contract } from '@/lib/models';
import { connectToDatabase } from '@/lib/db';
import { isValidAddress, checkRateLimit, getClientIp } from '@/lib/security/validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    await connectToDatabase();

    const { address } = await params;
    const addressLower = address.toLowerCase();
    const doc = await Contract.findOne({ address: addressLower }).lean(true);

    // Type guard function to check for the sourceCode property
    const hasSourceCode = (d: unknown): d is { sourceCode: string } =>
      typeof d === 'object' &&
      d !== null &&
      'sourceCode' in d &&
      typeof (d as { sourceCode?: unknown }).sourceCode === 'string';

    if (!hasSourceCode(doc)) {
      return NextResponse.json({ valid: false });
    }

    const data = { ...doc, valid: true };
    return NextResponse.json(data);
  } catch (err) {
    console.error(`ContractFind error: ${err}`);
    console.error(`bad address: ${(await params).address}`);
    return NextResponse.json({ error: true, valid: false });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting - 10 requests per minute
    const clientIp = getClientIp(request);
    const rateLimitResult = checkRateLimit(`contract:post:${clientIp}`, 10, 0.17);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimitResult.resetIn },
        { status: 429 }
      );
    }

    await connectToDatabase();

    const contract = await request.json();

    // Validate required fields
    if (!contract || typeof contract !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!contract.address || !isValidAddress(contract.address)) {
      return NextResponse.json({ error: 'Invalid contract address' }, { status: 400 });
    }

    // Normalize address
    const normalizedAddress = contract.address.toLowerCase();

    await Contract.updateOne(
      { address: normalizedAddress },
      { $setOnInsert: { ...contract, address: normalizedAddress } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`ContractAdd error: ${err}`);
    return NextResponse.json({ error: true }, { status: 500 });
  }
}
