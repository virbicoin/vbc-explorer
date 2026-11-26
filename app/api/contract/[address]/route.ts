import { NextRequest, NextResponse } from 'next/server';
import { Contract } from '@/lib/models';
import { connectToDatabase } from '@/lib/db';

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

// There is no POST handler. It stored the request body as a Contract record
// ($setOnInsert: { ...body }) without any check, so anyone could create a "verified" contract with
// any name and source for an address that had no record yet. Contract records are written by the
// sync tools and by the verification routes, which compile the source and match it on chain.
