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

const WEI_PER_COIN = 10n ** 18n;

function blockRewardWei(blockNumber: number): bigint {
  return BigInt(getBlockRewardForHeight(blockNumber)) * WEI_PER_COIN;
}

/**
 * Returns the block reward in wei (string) for API responses.
 */
export function getBlockRewardWeiForHeight(blockNumber: number): string {
  return blockRewardWei(blockNumber).toString();
}

/**
 * Reward paid to the miner of uncle `uncleNumber` when block `blockNumber`
 * includes it: (uncle + 8 - block) / 8 of the including block's reward
 * (go-virbicoin consensus/ethash accumulateRewards).
 */
export function getUncleRewardWei(uncleNumber: number, blockNumber: number): bigint {
  const depth = blockNumber - uncleNumber;
  // Consensus keeps uncles within six generations; the formula is defined for 1..7.
  if (!Number.isInteger(depth) || depth < 1 || depth > 7) {
    throw new RangeError(`block ${blockNumber} cannot include an uncle at height ${uncleNumber}`);
  }
  return (BigInt(8 - depth) * blockRewardWei(blockNumber)) / 8n;
}

/** Extra reward the including block's miner receives per uncle: 1/32 of the block reward. */
export function getNephewRewardWei(blockNumber: number): bigint {
  return blockRewardWei(blockNumber) / 32n;
}

/**
 * Coins created for the uncles of one block: each uncle's reward plus the
 * nephew reward for including it. This issuance comes on top of the block
 * reward schedule and is the only other way new coins are created.
 */
export function calculateUncleIssuanceWei(
  blockNumber: number,
  uncleNumbers: readonly number[]
): bigint {
  return uncleNumbers.reduce(
    (total, uncle) =>
      total + getUncleRewardWei(uncle, blockNumber) + getNephewRewardWei(blockNumber),
    0n
  );
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
 * Calculates the cumulative block reward of blocks 1..blockNumber (the genesis
 * block pays nothing), i.e. the sum of getBlockRewardForHeight over that range.
 *
 * Uncle rewards are not included: they depend on which uncles each block
 * included and cannot be derived from the height alone.
 */
export function calculateTotalMiningReward(blockNumber: number): number {
  if (blockNumber <= 0) return 0;

  // Blocks below the first reduction pay the base reward.
  let total = Math.min(blockNumber, FIRST_REDUCTION_BLOCK - 1) * BASE_REWARD;

  // Each era starts on a reduction block, which already pays the reduced reward.
  for (
    let eraStart = FIRST_REDUCTION_BLOCK;
    eraStart <= blockNumber;
    eraStart += REWARD_REDUCTION_INTERVAL
  ) {
    const reward = getBlockRewardForHeight(eraStart);
    if (reward <= MIN_REWARD) {
      total += (blockNumber - eraStart + 1) * MIN_REWARD;
      break;
    }
    const eraEnd = Math.min(blockNumber, eraStart + REWARD_REDUCTION_INTERVAL - 1);
    total += (eraEnd - eraStart + 1) * reward;
  }

  return total;
}
