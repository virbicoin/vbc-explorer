import { describe, it, expect } from 'vitest';
import {
  ETHEREUM_REWARDS,
  RewardScheduleError,
  blockRewardWei,
  calculateTotalMiningRewardWei,
  calculateUncleIssuanceWei,
  formatCoins,
  getBlockRewardForHeight,
  getBlockRewardWeiForHeight,
  getNephewRewardWei,
  getNextRewardChange,
  getUncleRewardWei,
  minerRewardWei,
  parseRewardSchedule,
  transactionFeesWei,
} from '@/lib/reward-schedule';

const coins = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
};

// A chain that starts at 8 coins and loses 1 coin every 2,100,000 blocks from 4,200,000, down to
// 1 coin. Written like an OpenEthereum chainspec for some entries (hex block, hex wei).
const STEPPED = parseRewardSchedule({
  blockReward: {
    '0': '8',
    '0x401640': '0x6124fee993bc0000', // 4,200,000: 7 coins in wei
    '6300000': 6,
    '8400000': '5',
    '10500000': '4',
    '12600000': '3',
    '14700000': '2',
    '16800000': '1',
  },
  forkNames: { '4200000': 'First', '0x602160': 'Second' },
});
const FIRST = 4_200_000;
const INTERVAL = 2_100_000;

// Era-based schedule with a flat uncle reward from era 2 (ECIP-1017 style)
const ERAS = parseRewardSchedule({
  blockReward: {
    '0': '5',
    '5000001': '4',
    '10000001': '3.2',
    '15000001': '2.56',
    '20000001': '2.048',
  },
  flatUncleRewardFrom: 5000001,
});

const ETHEREUM = parseRewardSchedule(null);

describe('parseRewardSchedule', () => {
  it("uses Ethereum's schedule without a blockReward map", () => {
    expect(parseRewardSchedule(undefined)).toEqual(parseRewardSchedule(ETHEREUM_REWARDS));
    expect(parseRewardSchedule({ blockReward: {} })).toEqual(ETHEREUM);
    expect(ETHEREUM.steps.map((step) => [step.from, formatCoins(step.reward)])).toEqual([
      [0, '5'],
      [4_370_000, '3'],
      [7_280_000, '2'],
      [15_537_394, '0'],
    ]);
  });

  it('reads decimal and hex blocks, coin amounts and hex wei', () => {
    expect(blockRewardWei(STEPPED, FIRST)).toBe(coins('7'));
    expect(blockRewardWei(STEPPED, 6_300_000)).toBe(coins('6'));
    expect(blockRewardWei(ERAS, 10_000_001)).toBe(coins('3.2'));
    expect(STEPPED.forkNames).toEqual({ 4_200_000: 'First', 6_300_000: 'Second' });
    expect(STEPPED.flatUncleRewardFrom).toBeNull();
    expect(ERAS.flatUncleRewardFrom).toBe(5_000_001);
  });

  it('rejects schedules it cannot use', () => {
    expect(() => parseRewardSchedule({ blockReward: { '10': '5' } })).toThrow(RewardScheduleError);
    expect(() => parseRewardSchedule({ blockReward: { '0': '5', '0x0': '4' } })).toThrow(
      RewardScheduleError
    );
    expect(() => parseRewardSchedule({ blockReward: { '0': 'five' } })).toThrow(
      RewardScheduleError
    );
    expect(() => parseRewardSchedule({ blockReward: { '0': '1e18' } })).toThrow(
      RewardScheduleError
    );
    expect(() => parseRewardSchedule({ blockReward: { x: '5' } })).toThrow(RewardScheduleError);
  });
});

describe('block reward at a height', () => {
  it('pays the reward of the last step at or below the height', () => {
    expect(getBlockRewardForHeight(STEPPED, 0)).toBe(8);
    expect(getBlockRewardForHeight(STEPPED, FIRST - 1)).toBe(8);
    expect(getBlockRewardForHeight(STEPPED, FIRST)).toBe(7);
    expect(getBlockRewardForHeight(STEPPED, FIRST + INTERVAL)).toBe(6);
    expect(getBlockRewardForHeight(STEPPED, 12_600_000)).toBe(3);
    expect(getBlockRewardForHeight(STEPPED, 100_000_000)).toBe(1);
    expect(getBlockRewardForHeight(ERAS, 12_000_000)).toBe(3.2);
    expect(getBlockRewardForHeight(ETHEREUM, 20_000_000)).toBe(0);
  });

  it('gives the reward in wei', () => {
    expect(getBlockRewardWeiForHeight(STEPPED, 0)).toBe('8000000000000000000');
    expect(getBlockRewardWeiForHeight(STEPPED, 16_800_000)).toBe('1000000000000000000');
    expect(getBlockRewardWeiForHeight(ERAS, 20_000_001)).toBe('2048000000000000000');
  });

  it('formats coins without trailing zeros', () => {
    expect(formatCoins(coins('8'))).toBe('8');
    expect(formatCoins(coins('2.048'))).toBe('2.048');
    expect(formatCoins(0n)).toBe('0');
    expect(formatCoins(1n)).toBe('0.000000000000000001');
  });
});

describe('getNextRewardChange', () => {
  it('finds the next block where the reward changes', () => {
    expect(getNextRewardChange(STEPPED, 0)).toEqual({
      block: FIRST,
      periodStart: 0,
      currentReward: coins('8'),
      nextReward: coins('7'),
      name: 'First',
    });
    expect(getNextRewardChange(STEPPED, FIRST)).toMatchObject({
      block: FIRST + INTERVAL,
      periodStart: FIRST,
      nextReward: coins('6'),
      name: 'Second',
    });
    expect(getNextRewardChange(STEPPED, 16_799_999)?.block).toBe(16_800_000);
    // unnamed change
    expect(getNextRewardChange(STEPPED, 9_000_000)?.name).toBeUndefined();
  });

  it('is null when nothing else is scheduled', () => {
    expect(getNextRewardChange(STEPPED, 16_800_000)).toBeNull();
    expect(getNextRewardChange(ETHEREUM, 15_537_394)).toBeNull();
  });

  it('skips steps that repeat the current reward', () => {
    const repeated = parseRewardSchedule({ blockReward: { '0': '2', '100': '2', '200': '1' } });
    expect(getNextRewardChange(repeated, 150)).toMatchObject({ block: 200, periodStart: 0 });
  });

  it('always points at a block with a different reward', () => {
    for (const block of [0, 1, 4_199_999, 4_200_000, 9_000_000, 16_799_999]) {
      const next = getNextRewardChange(STEPPED, block);
      expect(next).not.toBeNull();
      expect(next!.block).toBeGreaterThan(block);
      expect(getBlockRewardForHeight(STEPPED, next!.block)).toBe(
        getBlockRewardForHeight(STEPPED, block) - 1
      );
    }
  });
});

describe('calculateTotalMiningRewardWei', () => {
  const total = (schedule: typeof STEPPED, block: number) =>
    calculateTotalMiningRewardWei(schedule, block);

  it('is 0 up to the genesis block', () => {
    expect(total(STEPPED, 0)).toBe(0n);
    expect(total(STEPPED, -5)).toBe(0n);
  });

  it('pays the first step for blocks 1..n', () => {
    expect(total(STEPPED, 100)).toBe(coins('800'));
    expect(total(STEPPED, FIRST - 1)).toBe(BigInt(FIRST - 1) * coins('8'));
  });

  it('pays the new reward on the block where it changes', () => {
    const before = BigInt(FIRST - 1) * coins('8');
    expect(total(STEPPED, FIRST)).toBe(before + coins('7'));
    expect(total(STEPPED, FIRST + 10)).toBe(before + 11n * coins('7'));
  });

  it('equals the sum of the per-block rewards around every change', () => {
    for (const schedule of [STEPPED, ERAS, ETHEREUM]) {
      for (const { from } of schedule.steps.slice(1)) {
        let expected = total(schedule, from - 3);
        for (let block = from - 2; block <= from + 2; block++) {
          expected += blockRewardWei(schedule, block);
          expect(total(schedule, block)).toBe(expected);
        }
      }
    }
  });

  it('keeps paying the last step', () => {
    expect(total(STEPPED, 17_800_000) - total(STEPPED, 16_800_000)).toBe(coins('1000000'));
    expect(total(ETHEREUM, 20_000_000)).toBe(total(ETHEREUM, 15_537_393));
  });

  it("adds up Ethereum's proof-of-work issuance", () => {
    expect(total(ETHEREUM, 15_537_393)).toBe(
      4_369_999n * coins('5') + 2_910_000n * coins('3') + 8_257_394n * coins('2')
    );
  });
});

describe('uncle issuance', () => {
  it('pays (uncle + 8 - block) / 8 of the block reward to the uncle miner', () => {
    expect(getUncleRewardWei(STEPPED, 99, 100)).toBe(coins('7'));
    expect(getUncleRewardWei(STEPPED, 98, 100)).toBe(coins('6'));
    expect(getUncleRewardWei(STEPPED, 94, 100)).toBe(coins('2'));
  });

  it('pays 1/32 of the block reward per uncle to the including miner', () => {
    expect(getNephewRewardWei(STEPPED, 100)).toBe(coins('0.25'));
  });

  it('scales with the reward of the including block', () => {
    expect(getUncleRewardWei(STEPPED, FIRST - 1, FIRST)).toBe(coins('6.125'));
    expect(getNephewRewardWei(STEPPED, FIRST)).toBe(coins('0.21875'));
  });

  it('pays a flat 1/32 to uncles from flatUncleRewardFrom on', () => {
    // era 1: depth-based
    expect(getUncleRewardWei(ERAS, 4_999_999, 5_000_000)).toBe(coins('4.375'));
    // era 2 onward: 1/32 of the block reward at any depth
    expect(getUncleRewardWei(ERAS, 5_000_000, 5_000_001)).toBe(coins('0.125'));
    expect(getUncleRewardWei(ERAS, 9_999_995, 10_000_001)).toBe(coins('0.1'));
    expect(getNephewRewardWei(ERAS, 10_000_001)).toBe(coins('0.1'));
  });

  it('rejects heights a block cannot include as uncles', () => {
    expect(() => getUncleRewardWei(STEPPED, 100, 100)).toThrow(RangeError);
    expect(() => getUncleRewardWei(STEPPED, 92, 100)).toThrow(RangeError);
  });

  // Blocks of a live chain with an 8-coin reward whose miner balance changes were checked
  it('matches balance changes seen on chain', () => {
    // two uncles one block back → 7 + 7 to the uncle miners, 2 × 0.25 to the block miner
    expect(calculateUncleIssuanceWei(STEPPED, 3397822, [3397821, 3397821])).toBe(coins('14.5'));
    // two uncles three blocks back → 5 + 5, plus 0.5
    expect(calculateUncleIssuanceWei(STEPPED, 3397819, [3397816, 3397816])).toBe(coins('10.5'));
    // uncles three and two blocks back → 5 + 6, plus 0.5
    expect(calculateUncleIssuanceWei(STEPPED, 3397818, [3397815, 3397816])).toBe(coins('11.5'));
    expect(calculateUncleIssuanceWei(STEPPED, 3397818, [])).toBe(0n);
  });
});

describe('miner reward', () => {
  it('sums gasUsed × gasPrice over the transactions', () => {
    expect(
      transactionFeesWei([
        { gasUsed: 21000, gasPrice: '1000000000' },
        { gasUsed: '50000', gasPrice: '2000000000' },
        { gasUsed: undefined, gasPrice: null },
      ])
    ).toBe(21000n * 10n ** 9n + 50000n * 2n * 10n ** 9n);
    expect(transactionFeesWei([])).toBe(0n);
  });

  it('is the reward at the height plus fees plus 1/32 of it per included uncle', () => {
    const fees = 21000n * 10n ** 9n;
    expect(minerRewardWei(STEPPED, 100, 0, 0n).total).toBe(coins('8'));
    expect(minerRewardWei(STEPPED, 3397818, 2, fees)).toEqual({
      blockReward: coins('8'),
      fees,
      uncleInclusionReward: coins('0.5'),
      total: coins('8.5') + fees,
    });
    // after a change the reward follows the schedule, not the first value
    expect(minerRewardWei(STEPPED, FIRST, 1, 0n).total).toBe(coins('7') + coins('7') / 32n);
    expect(minerRewardWei(ETHEREUM, 16_000_000, 0, fees).total).toBe(fees);
  });
});
