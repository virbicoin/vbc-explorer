/**
 * Block reward schedule: what a chain pays for blocks and uncles.
 *
 * Nothing here is tied to one chain. The schedule comes from the `rewards` section of
 * config.json (on the server through `getRewardSchedule()` in lib/config.ts, in the browser
 * through `/api/config/client`):
 * - `blockReward`: the reward keyed by the first block it applies to, the same shape as the
 *   `blockReward` map of an OpenEthereum chainspec. Keys are decimal or 0x-hex block numbers;
 *   values are coins as a decimal string or number ("5", "3.2") or wei as a 0x-hex string.
 * - `flatUncleRewardFrom`: from this block on an uncle earns 1/32 of the block reward whatever
 *   its depth (Ethereum Classic's ECIP-1017 from era 2, block 5,000,001). Before it, or when it
 *   is not set, an uncle earns (uncle + 8 - block) / 8 of the reward (Ethash).
 * - `forkNames`: optional names for the blocks where the reward changes.
 * The miner of a block that includes uncles gets 1/32 of the block reward per uncle on top.
 * Without a `rewards` section the schedule is Ethereum's proof-of-work one (ETHEREUM_REWARDS).
 *
 * Pure module with no server-side imports, so client components can use it too.
 */

export interface RewardScheduleConfig {
  blockReward?: Record<string, string | number>;
  flatUncleRewardFrom?: number | string | null;
  forkNames?: Record<string, string>;
}

export interface RewardStep {
  /** First block that pays this reward. */
  from: number;
  /** Reward in wei. */
  reward: bigint;
}

export interface RewardSchedule {
  /** Ascending by `from`; the first step starts at block 0. */
  steps: readonly RewardStep[];
  flatUncleRewardFrom: number | null;
  forkNames: Readonly<Record<number, string>>;
}

/** Ethereum: 5 coins from Frontier, 3 from Byzantium, 2 from Constantinople, none after the Merge. */
export const ETHEREUM_REWARDS: RewardScheduleConfig = {
  blockReward: { '0': '5', '4370000': '3', '7280000': '2', '15537394': '0' },
  forkNames: { '4370000': 'Byzantium', '7280000': 'Constantinople', '15537394': 'Paris' },
};

const WEI_PER_COIN = 10n ** 18n;

export class RewardScheduleError extends Error {
  constructor(message: string) {
    super(`config.json rewards: ${message}`);
    this.name = 'RewardScheduleError';
  }
}

function parseBlockNumber(value: string | number): number {
  const text = String(value).trim();
  const parsed = /^0x[0-9a-f]+$/i.test(text)
    ? Number.parseInt(text, 16)
    : /^\d+$/.test(text)
      ? Number(text)
      : NaN;
  if (!Number.isSafeInteger(parsed)) throw new RewardScheduleError(`bad block number "${text}"`);
  return parsed;
}

/** Coins ("5", "3.2", 2.048) or 0x-hex wei → wei. */
function parseReward(value: string | number): bigint {
  const text = String(value).trim();
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text);
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text);
  if (!match) throw new RewardScheduleError(`bad reward "${text}"`);
  return BigInt(match[1]) * WEI_PER_COIN + BigInt((match[2] ?? '').padEnd(18, '0') || '0');
}

/** Builds the schedule from config.json's `rewards`; Ethereum's when the section is missing. */
export function parseRewardSchedule(config?: RewardScheduleConfig | null): RewardSchedule {
  const source =
    config?.blockReward && Object.keys(config.blockReward).length > 0 ? config : ETHEREUM_REWARDS;
  const steps = Object.entries(source.blockReward ?? {})
    .map(([block, reward]) => ({ from: parseBlockNumber(block), reward: parseReward(reward) }))
    .sort((a, b) => a.from - b.from);
  if (steps[0]?.from !== 0) throw new RewardScheduleError('blockReward needs an entry for block 0');
  if (new Set(steps.map((step) => step.from)).size !== steps.length) {
    throw new RewardScheduleError('blockReward lists the same block twice');
  }
  const flat = source.flatUncleRewardFrom;
  const forkNames: Record<number, string> = {};
  for (const [block, name] of Object.entries(source.forkNames ?? {})) {
    forkNames[parseBlockNumber(block)] = String(name);
  }
  return {
    steps,
    flatUncleRewardFrom:
      flat === undefined || flat === null || flat === '' ? null : parseBlockNumber(flat),
    forkNames,
  };
}

/** Block reward in wei at a height. */
export function blockRewardWei(schedule: RewardSchedule, blockNumber: number): bigint {
  let reward = 0n;
  for (const step of schedule.steps) {
    if (step.from > blockNumber) break;
    reward = step.reward;
  }
  return reward;
}

/** Wei as a plain decimal coin amount without trailing zeros ("8", "3.2"). */
export function formatCoins(wei: bigint): string {
  const whole = wei / WEI_PER_COIN;
  const fraction = (wei % WEI_PER_COIN).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Block reward in coins at a height, as a number (API fields and display). */
export function getBlockRewardForHeight(schedule: RewardSchedule, blockNumber: number): number {
  return Number(formatCoins(blockRewardWei(schedule, blockNumber)));
}

/** Block reward in wei at a height, as a decimal string (API fields). */
export function getBlockRewardWeiForHeight(schedule: RewardSchedule, blockNumber: number): string {
  return blockRewardWei(schedule, blockNumber).toString();
}

/**
 * Reward paid to the miner of uncle `uncleNumber` when block `blockNumber` includes it:
 * (uncle + 8 - block) / 8 of the including block's reward (Ethash), or 1/32 of it from
 * `flatUncleRewardFrom` on (ECIP-1017).
 */
export function getUncleRewardWei(
  schedule: RewardSchedule,
  uncleNumber: number,
  blockNumber: number
): bigint {
  const depth = blockNumber - uncleNumber;
  // Consensus keeps uncles within six generations; the formula is defined for 1..7.
  if (!Number.isInteger(depth) || depth < 1 || depth > 7) {
    throw new RangeError(`block ${blockNumber} cannot include an uncle at height ${uncleNumber}`);
  }
  const reward = blockRewardWei(schedule, blockNumber);
  if (schedule.flatUncleRewardFrom !== null && blockNumber >= schedule.flatUncleRewardFrom) {
    return reward / 32n;
  }
  return (BigInt(8 - depth) * reward) / 8n;
}

/** Extra reward the including block's miner receives per uncle: 1/32 of the block reward. */
export function getNephewRewardWei(schedule: RewardSchedule, blockNumber: number): bigint {
  return blockRewardWei(schedule, blockNumber) / 32n;
}

/** Sum of gasUsed × gasPrice over a block's transactions, in wei. */
export function transactionFeesWei(
  transactions: ReadonlyArray<{ gasUsed?: number | string | null; gasPrice?: string | null }>
): bigint {
  return transactions.reduce(
    (total, tx) => total + BigInt(tx.gasUsed ?? 0) * BigInt(tx.gasPrice || '0'),
    0n
  );
}

export interface MinerReward {
  blockReward: bigint;
  fees: bigint;
  uncleInclusionReward: bigint;
  total: bigint;
}

/**
 * What consensus credits the miner of a block: the block reward, the block's transaction fees
 * and 1/32 of the reward for each uncle it includes.
 */
export function minerRewardWei(
  schedule: RewardSchedule,
  blockNumber: number,
  uncleCount: number,
  fees: bigint
): MinerReward {
  const blockReward = blockRewardWei(schedule, blockNumber);
  const uncleInclusionReward = BigInt(uncleCount) * getNephewRewardWei(schedule, blockNumber);
  return {
    blockReward,
    fees,
    uncleInclusionReward,
    total: blockReward + fees + uncleInclusionReward,
  };
}

/**
 * Coins created for the uncles of one block: each uncle's reward plus the nephew reward for
 * including it. This issuance comes on top of the block rewards and is the only other way new
 * coins are created.
 */
export function calculateUncleIssuanceWei(
  schedule: RewardSchedule,
  blockNumber: number,
  uncleNumbers: readonly number[]
): bigint {
  return uncleNumbers.reduce(
    (total, uncle) =>
      total +
      getUncleRewardWei(schedule, uncle, blockNumber) +
      getNephewRewardWei(schedule, blockNumber),
    0n
  );
}

export interface RewardChange {
  /** Block where the reward changes. */
  block: number;
  /** First block of the period that ends there (for progress bars). */
  periodStart: number;
  /** Reward until then and from then on, in wei. */
  currentReward: bigint;
  nextReward: bigint;
  /** Name of the fork at that block, when config.json gives one. */
  name?: string;
}

/** The next block after `blockNumber` where the reward changes, or null when none is scheduled. */
export function getNextRewardChange(
  schedule: RewardSchedule,
  blockNumber: number
): RewardChange | null {
  const currentReward = blockRewardWei(schedule, blockNumber);
  // The current period starts where the reward last changed (steps that repeat it do not count)
  let periodStart = 0;
  let previous: bigint | null = null;
  for (const step of schedule.steps) {
    if (step.from > blockNumber) break;
    if (step.reward !== previous) periodStart = step.from;
    previous = step.reward;
  }
  for (const step of schedule.steps) {
    if (step.from <= blockNumber || step.reward === currentReward) continue;
    return {
      block: step.from,
      periodStart,
      currentReward,
      nextReward: step.reward,
      name: schedule.forkNames[step.from],
    };
  }
  return null;
}

/**
 * Total block reward of blocks 1..blockNumber in wei (the genesis block pays nothing).
 *
 * Uncle rewards are not included: they depend on which uncles each block included and cannot be
 * derived from the height alone.
 */
export function calculateTotalMiningRewardWei(
  schedule: RewardSchedule,
  blockNumber: number
): bigint {
  let total = 0n;
  schedule.steps.forEach((step, index) => {
    const first = Math.max(step.from, 1);
    const next = schedule.steps[index + 1]?.from ?? Infinity;
    const last = Math.min(blockNumber, next - 1);
    if (last >= first) total += BigInt(last - first + 1) * step.reward;
  });
  return total;
}
