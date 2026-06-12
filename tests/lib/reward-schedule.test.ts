import { describe, it, expect } from 'vitest';
import {
  FIRST_REDUCTION_BLOCK,
  REWARD_REDUCTION_INTERVAL,
  REDUCTION_FORK_NAMES,
  getBlockRewardForHeight,
  getBlockRewardWeiForHeight,
  getNextRewardReductionBlock,
  calculateTotalMiningReward,
} from '@/lib/reward-schedule';

describe('getBlockRewardForHeight', () => {
  it('returns the base reward before the first reduction', () => {
    expect(getBlockRewardForHeight(0)).toBe(8);
    expect(getBlockRewardForHeight(FIRST_REDUCTION_BLOCK - 1)).toBe(8);
  });

  it('reduces the reward by 1 VBC at each reduction block', () => {
    expect(getBlockRewardForHeight(FIRST_REDUCTION_BLOCK)).toBe(7);
    expect(getBlockRewardForHeight(FIRST_REDUCTION_BLOCK + REWARD_REDUCTION_INTERVAL)).toBe(6);
    expect(getBlockRewardForHeight(12_600_000)).toBe(3);
  });

  it('floors at the minimum reward', () => {
    expect(getBlockRewardForHeight(16_800_000)).toBe(1);
    expect(getBlockRewardForHeight(100_000_000)).toBe(1);
  });
});

describe('getBlockRewardWeiForHeight', () => {
  it('converts the reward to wei', () => {
    expect(getBlockRewardWeiForHeight(0)).toBe('8000000000000000000');
    expect(getBlockRewardWeiForHeight(16_800_000)).toBe('1000000000000000000');
  });
});

describe('getNextRewardReductionBlock', () => {
  it('returns the first reduction block before any reduction', () => {
    expect(getNextRewardReductionBlock(0)).toBe(FIRST_REDUCTION_BLOCK);
    expect(getNextRewardReductionBlock(FIRST_REDUCTION_BLOCK - 1)).toBe(FIRST_REDUCTION_BLOCK);
  });

  it('returns the following reduction block within an era', () => {
    expect(getNextRewardReductionBlock(FIRST_REDUCTION_BLOCK)).toBe(
      FIRST_REDUCTION_BLOCK + REWARD_REDUCTION_INTERVAL
    );
    expect(getNextRewardReductionBlock(16_799_999)).toBe(16_800_000);
  });

  it('returns null once the minimum reward is reached', () => {
    expect(getNextRewardReductionBlock(16_800_000)).toBeNull();
    expect(getNextRewardReductionBlock(100_000_000)).toBeNull();
  });

  it('always points at a block with a lower reward', () => {
    for (const block of [0, 1, 4_199_999, 4_200_000, 9_000_000, 16_799_999]) {
      const next = getNextRewardReductionBlock(block);
      expect(next).not.toBeNull();
      expect(next!).toBeGreaterThan(block);
      expect(getBlockRewardForHeight(next!)).toBe(getBlockRewardForHeight(block) - 1);
    }
  });
});

describe('REDUCTION_FORK_NAMES', () => {
  it('names every reduction block in the schedule', () => {
    let block: number | null = 0;
    const seen: string[] = [];
    while ((block = getNextRewardReductionBlock(block)) !== null) {
      expect(REDUCTION_FORK_NAMES[block]).toBeDefined();
      seen.push(REDUCTION_FORK_NAMES[block]);
    }
    expect(seen).toEqual(['Quiche', 'Miche', 'Rusk', 'Celestia', 'Mafuyu', 'Kipfel', 'Lumina']);
  });
});

describe('calculateTotalMiningReward', () => {
  it('returns 0 for the genesis block', () => {
    expect(calculateTotalMiningReward(0)).toBe(0);
  });

  it('accumulates 8 VBC per block in the first era', () => {
    expect(calculateTotalMiningReward(100)).toBe(800);
    expect(calculateTotalMiningReward(FIRST_REDUCTION_BLOCK)).toBe(FIRST_REDUCTION_BLOCK * 8);
  });

  it('accounts for reduced rewards after each reduction', () => {
    expect(calculateTotalMiningReward(FIRST_REDUCTION_BLOCK + 10)).toBe(
      FIRST_REDUCTION_BLOCK * 8 + 10 * 7
    );
  });
});
