import { describe, it, expect } from 'vitest';
import {
  FIRST_REDUCTION_BLOCK,
  REWARD_REDUCTION_INTERVAL,
  REDUCTION_FORK_NAMES,
  getBlockRewardForHeight,
  getBlockRewardWeiForHeight,
  getNextRewardReductionBlock,
  calculateTotalMiningReward,
  getUncleRewardWei,
  getNephewRewardWei,
  calculateUncleIssuanceWei,
} from '@/lib/reward-schedule';

const coins = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
};

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
    expect(calculateTotalMiningReward(FIRST_REDUCTION_BLOCK - 1)).toBe(
      (FIRST_REDUCTION_BLOCK - 1) * 8
    );
  });

  it('pays the reduced reward on the reduction block itself', () => {
    const beforeReduction = (FIRST_REDUCTION_BLOCK - 1) * 8;
    expect(calculateTotalMiningReward(FIRST_REDUCTION_BLOCK)).toBe(beforeReduction + 7);
    expect(calculateTotalMiningReward(FIRST_REDUCTION_BLOCK + 10)).toBe(beforeReduction + 11 * 7);
  });

  it('equals the sum of the per-block rewards around every reduction', () => {
    const boundaries = [0, 1, 2, 3, 4, 5, 6].map(
      (k) => FIRST_REDUCTION_BLOCK + k * REWARD_REDUCTION_INTERVAL
    );
    for (const boundary of boundaries) {
      let expected = calculateTotalMiningReward(boundary - 3);
      for (let block = boundary - 2; block <= boundary + 2; block++) {
        expected += getBlockRewardForHeight(block);
        expect(calculateTotalMiningReward(block)).toBe(expected);
      }
    }
  });

  it('stays at the minimum reward after the last reduction', () => {
    const lastReduction = FIRST_REDUCTION_BLOCK + 6 * REWARD_REDUCTION_INTERVAL;
    expect(
      calculateTotalMiningReward(lastReduction + 1_000_000) -
        calculateTotalMiningReward(lastReduction)
    ).toBe(1_000_000);
  });
});

describe('uncle issuance', () => {
  it('pays (uncle + 8 - block) / 8 of the block reward to the uncle miner', () => {
    expect(getUncleRewardWei(99, 100)).toBe(coins('7'));
    expect(getUncleRewardWei(98, 100)).toBe(coins('6'));
    expect(getUncleRewardWei(94, 100)).toBe(coins('2'));
  });

  it('pays 1/32 of the block reward per uncle to the including miner', () => {
    expect(getNephewRewardWei(100)).toBe(coins('0.25'));
  });

  it('scales with the reduced reward of the including block', () => {
    // Quiche: 7 VBC per block
    expect(getUncleRewardWei(FIRST_REDUCTION_BLOCK - 1, FIRST_REDUCTION_BLOCK)).toBe(
      coins('6.125')
    );
    expect(getNephewRewardWei(FIRST_REDUCTION_BLOCK)).toBe(coins('0.21875'));
  });

  it('rejects heights a block cannot include as uncles', () => {
    expect(() => getUncleRewardWei(100, 100)).toThrow(RangeError);
    expect(() => getUncleRewardWei(92, 100)).toThrow(RangeError);
  });

  // Mainnet blocks whose miner balance changes were checked against these values
  it('matches the balance changes seen on mainnet', () => {
    // block 3397822: two uncles at 3397821 → 7 + 7 to the uncle miner, 2 × 0.25 to the block miner
    expect(calculateUncleIssuanceWei(3397822, [3397821, 3397821])).toBe(coins('14.5'));
    // block 3397819: two uncles at 3397816 → 5 + 5, plus 0.5
    expect(calculateUncleIssuanceWei(3397819, [3397816, 3397816])).toBe(coins('10.5'));
    // block 3397818: uncles at 3397815 and 3397816 → 5 + 6, plus 0.5
    expect(calculateUncleIssuanceWei(3397818, [3397815, 3397816])).toBe(coins('11.5'));
    expect(calculateUncleIssuanceWei(3397818, [])).toBe(0n);
  });
});
