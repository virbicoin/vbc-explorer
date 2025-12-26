import { NextResponse } from 'next/server';
import { getWeb3 } from '../../../lib/web3';
import { apiCache, CACHE_TTL } from '../../../lib/cache';

export async function GET() {
  try {
    // Cache block height for 5 seconds
    const blockNumber = await apiCache.getOrSet(
      'blockheight',
      async () => {
        const web3 = getWeb3();
        return (await web3.eth.getBlockNumber()).toString();
      },
      CACHE_TTL.SHORT / 2 // 5 seconds
    );
    
    return NextResponse.json({
      blockHeight: blockNumber,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching block height:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch block height',
      blockHeight: '0',
      timestamp: Date.now()
    }, { status: 500 });
  }
}