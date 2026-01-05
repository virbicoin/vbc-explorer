import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Lightweight API to check address type (contract, token, or wallet)
export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;

    if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
      return NextResponse.json({ type: 'invalid' }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();
    const db = await getDb();

    // Check if it's a registered token first (fastest check)
    const token = await db
      .collection('tokens')
      .findOne(
        { address: { $regex: new RegExp(`^${normalizedAddress}$`, 'i') } },
        { projection: { type: 1 } }
      );

    if (token) {
      const tokenType = token.type || 'VRC-20';
      if (['VRC-20', 'VRC-721', 'VRC-1155', 'ERC20', 'ERC721', 'ERC1155'].includes(tokenType)) {
        return NextResponse.json(
          { type: 'token', tokenType },
          {
            headers: {
              'Cache-Control': 'public, max-age=60',
            },
          }
        );
      }
    }

    // Check if it's a contract
    const contract = await db
      .collection('contracts')
      .findOne(
        { address: { $regex: new RegExp(`^${normalizedAddress}$`, 'i') } },
        { projection: { isContract: 1, type: 1 } }
      );

    if (contract?.isContract) {
      return NextResponse.json(
        { type: 'contract', contractType: contract.type },
        {
          headers: {
            'Cache-Control': 'public, max-age=60',
          },
        }
      );
    }

    // It's a regular wallet address
    return NextResponse.json(
      { type: 'wallet' },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  } catch (error) {
    console.error('Error checking address type:', error);
    return NextResponse.json({ type: 'unknown' }, { status: 500 });
  }
}
