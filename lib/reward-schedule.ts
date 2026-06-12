/**
 * VirBiCoin block reward schedule (mirrors go-virbicoin
 * consensus/ethash/consensus.go and params/config.go).
 *
 * Pure module with no server-side imports so it can be used from both
 * API handlers and client components.
 */

export const FIRST_REDUCTION_BLOCK = 4_200_000;
export const REWARD_REDUCTION_INTERVAL = 2_100_000;
export const BASE_REWARD = 8;
export const MIN_REWARD = 1;

/** Fork names for each reward reduction block (go-virbicoin params/config.go). */
export const REDUCTION_FORK_NAMES: Record<number, string> = {
  4_200_000: 'Quiche',
  6_300_000: 'Miche',
  8_400_000: 'Rusk',
  10_500_000: 'Celestia',
  12_600_000: 'Mafuyu',
  14_700_000: 'Kipfel',
  16_800_000: 'Lumina',
};

/**
 * Returns the block reward in VBC for a given block number.
 * First reduction at block 4,200,000, then every 2,100,000 blocks.
 * Schedule: 8 -> 7 -> 6 -> 5 -> 4 -> 3 -> 2 -> 1 VBC
 */
export function getBlockRewardForHeight(blockNumber: number): number {
  if (blockNumber < FIRST_REDUCTION_BLOCK) return BASE_REWARD;
  const reductions =
    Math.floor((blockNumber - FIRST_REDUCTION_BLOCK) / REWARD_REDUCTION_INTERVAL) + 1;
  if (reductions >= 7) return MIN_REWARD;
  return BASE_REWARD - reductions;
}

/**
 * Returns the block reward in wei (string) for API responses.
 */
export function getBlockRewardWeiForHeight(blockNumber: number): string {
  return (BigInt(getBlockRewardForHeight(blockNumber)) * BigInt(10 ** 18)).toString();
}

/**
 * Returns the next block at which the reward decreases,
 * or null once the minimum reward has been reached.
 */
export function getNextRewardReductionBlock(blockNumber: number): number | null {
  if (getBlockRewardForHeight(blockNumber) <= MIN_REWARD) return null;
  if (blockNumber < FIRST_REDUCTION_BLOCK) return FIRST_REDUCTION_BLOCK;
  const k = Math.floor((blockNumber - FIRST_REDUCTION_BLOCK) / REWARD_REDUCTION_INTERVAL) + 1;
  return FIRST_REDUCTION_BLOCK + k * REWARD_REDUCTION_INTERVAL;
}

/**
 * Calculates cumulative mining reward from block 0 to the given block number,
 * accounting for the gradual reward reduction schedule.
 */
export function calculateTotalMiningReward(blockNumber: number): number {
  if (blockNumber <= 0) return 0;

  let total = 0;

  // First epoch: block 0 to FIRST_REDUCTION_BLOCK (reward = 8 VBC)
  const firstEpochBlocks = Math.min(blockNumber, FIRST_REDUCTION_BLOCK);
  total += firstEpochBlocks * BASE_REWARD;

  let remaining = blockNumber - firstEpochBlocks;
  let currentReward = BASE_REWARD - 1;

  // Subsequent epochs: each REWARD_REDUCTION_INTERVAL blocks
  while (remaining > 0 && currentReward >= MIN_REWARD) {
    const blocksInEpoch = Math.min(remaining, REWARD_REDUCTION_INTERVAL);
    total += blocksInEpoch * currentReward;
    remaining -= blocksInEpoch;
    currentReward--;
  }

  if (remaining > 0) {
    total += remaining * MIN_REWARD;
  }

  return total;
}
