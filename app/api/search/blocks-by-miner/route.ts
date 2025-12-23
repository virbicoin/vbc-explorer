import { NextResponse } from 'next/server';
import { connectDB, Block } from '../../../../models/index';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const miner = searchParams.get('miner');

    if (!miner) {
      return NextResponse.json({ error: 'Miner parameter is required' }, { status: 400 });
    }

    await connectDB();

    // Get blocks mined by this address
    const blocks = await Block.find({
      miner: { $regex: new RegExp(`^${miner}$`, 'i') }
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
      gasLimit: block.gasLimit
    }));

    return NextResponse.json(formattedBlocks);
  } catch (error) {
    console.error('Blocks by miner search API error:', error);
    return NextResponse.json({ error: 'Failed to search blocks' }, { status: 500 });
  }
}
