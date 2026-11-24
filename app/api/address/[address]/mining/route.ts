import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block, Transaction } from '../../../../../models/index';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { validatePagination } from '@/lib/security/validation';
import { rejectDeepPagination } from '@/lib/security/pagination';
import {
  getBlockRewardForHeight,
  getBlockRewardWeiForHeight,
  getNephewRewardWei,
} from '@/lib/reward-schedule';

/** Wei as a decimal string with 8 fractional digits (truncated), the format this API returns. */
function toFixed8(wei: bigint): string {
  const scaled = wei / 10n ** 10n;
  const whole = scaled / 10n ** 8n;
  const fraction = (scaled % 10n ** 8n).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    await connectDB();
  } catch (dbError) {
    console.error('Database connection error:', dbError);
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
  }

  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const pagination = validatePagination(searchParams.get('page'), searchParams.get('limit'), 100, {
    defaultLimit: 50,
  });
  const tooDeep = rejectDeepPagination(pagination);
  if (tooDeep) return tooDeep;
  const { page, limit, skip } = pagination;

  try {
    // Get blocks with mining rewards
    const minedBlocks = await Block.find({
      miner: address.toLowerCase(),
    })
      .sort({ number: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const totalBlocks = await Block.countDocuments({
      miner: address.toLowerCase(),
    });

    const totalPages = Math.ceil(totalBlocks / limit);

    // Fees per block from the stored transactions (blocks do not carry gasUsed)
    const blockNumbers = minedBlocks.map((block) => block.number as number);
    const txs = (await Transaction.find({ blockNumber: { $in: blockNumbers } })
      .select('blockNumber gasUsed gasPrice')
      .lean()) as Array<{ blockNumber: number; gasUsed?: number; gasPrice?: string }>;
    const feesByBlock = new Map<number, bigint>();
    for (const tx of txs) {
      const fee = BigInt(tx.gasUsed ?? 0) * BigInt(tx.gasPrice || '0');
      feesByBlock.set(tx.blockNumber, (feesByBlock.get(tx.blockNumber) ?? 0n) + fee);
    }

    // What consensus credits the miner: block reward + fees + 1/32 of the reward per included uncle
    const miningRewards = minedBlocks.map((block) => {
      const number = block.number as number;
      const blockReward = BigInt(getBlockRewardWeiForHeight(number));
      const gasFees = feesByBlock.get(number) ?? 0n;
      const uncleInclusionReward =
        BigInt((block.uncles as string[] | undefined)?.length ?? 0) * getNephewRewardWei(number);
      const totalReward = blockReward + gasFees + uncleInclusionReward;
      return {
        hash: block.hash,
        from: '0x0000000000000000000000000000000000000000',
        to: address,
        value: toFixed8(totalReward),
        timestamp: block.timestamp,
        blockNumber: number,
        type: 'mining_reward',
        status: 'success',
        details: {
          blockReward: getBlockRewardForHeight(number),
          gasFees: toFixed8(gasFees),
          uncleInclusionReward: toFixed8(uncleInclusionReward),
          totalReward: toFixed8(totalReward),
        },
      };
    });

    return NextResponse.json({
      transactions: miningRewards,
      totalTransactions: totalBlocks,
      totalPages,
      currentPage: page,
      itemsPerPage: limit,
    });
  } catch (error) {
    console.error('Error fetching mining rewards:', error);
    return NextResponse.json({ error: 'Failed to fetch mining rewards' }, { status: 500 });
  }
}
