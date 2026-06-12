'use client';

import { useState, useEffect } from 'react';
import { ArrowTrendingDownIcon } from '@heroicons/react/24/outline';
import {
  FIRST_REDUCTION_BLOCK,
  REWARD_REDUCTION_INTERVAL,
  REDUCTION_FORK_NAMES,
  getBlockRewardForHeight,
  getNextRewardReductionBlock,
} from '@/lib/reward-schedule';

const DEFAULT_BLOCK_TIME = 12; // seconds (network target)

const pad2 = (value: number): string => String(value).padStart(2, '0');

interface TimerUnitsProps {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
}

function TimerUnits({ days, hours, minutes, seconds }: TimerUnitsProps) {
  const units = [
    { value: days, label: 'Days' },
    { value: hours, label: 'Hrs' },
    { value: minutes, label: 'Min' },
    { value: seconds, label: 'Sec' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3">
      {units.map((unit) => (
        <div key={unit.label} className="text-center p-3 bg-gray-700/50 rounded-lg min-w-16">
          <div className="text-2xl font-bold text-teal-400 tabular-nums">{unit.value}</div>
          <div className="text-xs text-gray-400 mt-1 uppercase tracking-wide">{unit.label}</div>
        </div>
      ))}
    </div>
  );
}

interface CountdownTimerProps {
  blocksRemaining: number;
  blockTime: number;
}

// Mounted with key={latestBlock} so the countdown re-anchors to the wall clock
// each time a new block arrives (state initializers run once per mount).
function CountdownTimer({ blocksRemaining, blockTime }: CountdownTimerProps) {
  const [targetTime] = useState<number>(() => Date.now() + blocksRemaining * blockTime * 1000);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingSec = Math.max(0, Math.floor((targetTime - now) / 1000));
  const estimatedDate = new Date(targetTime).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex flex-col items-center gap-2 lg:items-end">
      <TimerUnits
        days={pad2(Math.floor(remainingSec / 86400))}
        hours={pad2(Math.floor((remainingSec % 86400) / 3600))}
        minutes={pad2(Math.floor((remainingSec % 3600) / 60))}
        seconds={pad2(remainingSec % 60)}
      />
      <div className="text-xs text-gray-400">Est. {estimatedDate}</div>
    </div>
  );
}

interface HalvingCountdownProps {
  latestBlock?: number;
  avgBlockTime?: string;
}

export default function HalvingCountdown({ latestBlock, avgBlockTime }: HalvingCountdownProps) {
  const hasBlock = typeof latestBlock === 'number' && latestBlock > 0;
  const currentReward = hasBlock ? getBlockRewardForHeight(latestBlock) : null;
  const nextBlock = hasBlock ? getNextRewardReductionBlock(latestBlock) : null;
  const atMinimum = hasBlock && nextBlock === null;

  const parsedBlockTime = avgBlockTime !== undefined ? parseFloat(avgBlockTime) : NaN;
  const blockTime =
    !isNaN(parsedBlockTime) && parsedBlockTime > 0 ? parsedBlockTime : DEFAULT_BLOCK_TIME;

  const blocksRemaining = hasBlock && nextBlock !== null ? nextBlock - latestBlock : null;
  const eraStart =
    nextBlock !== null
      ? nextBlock === FIRST_REDUCTION_BLOCK
        ? 0
        : nextBlock - REWARD_REDUCTION_INTERVAL
      : null;
  const progress =
    hasBlock && nextBlock !== null && eraStart !== null
      ? Math.min(100, Math.max(0, ((latestBlock - eraStart) / (nextBlock - eraStart)) * 100))
      : null;
  const forkName = nextBlock !== null ? REDUCTION_FORK_NAMES[nextBlock] : undefined;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Reward transition */}
        <div className="flex items-center gap-3">
          <ArrowTrendingDownIcon className="w-8 h-8 text-teal-400" />
          <div>
            <div className="text-gray-400 text-sm">Block Reward</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              {currentReward !== null ? (
                atMinimum ? (
                  <span className="text-teal-400">{currentReward} VBC</span>
                ) : (
                  <>
                    <span className="text-gray-100">{currentReward} VBC</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-teal-400">{currentReward - 1} VBC</span>
                  </>
                )
              ) : (
                <span className="text-gray-100">N/A</span>
              )}
            </div>
            {forkName && nextBlock !== null && (
              <div className="text-xs text-gray-400 mt-1">
                Next reduction: {forkName} fork at block {nextBlock.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Countdown timer */}
        {atMinimum ? (
          <div className="text-lg font-semibold text-gray-400">
            Final reward era — no further reductions
          </div>
        ) : blocksRemaining !== null && hasBlock ? (
          <CountdownTimer
            key={latestBlock}
            blocksRemaining={blocksRemaining}
            blockTime={blockTime}
          />
        ) : (
          <TimerUnits days="--" hours="--" minutes="--" seconds="--" />
        )}
      </div>

      {/* Progress bar */}
      {!atMinimum && (
        <div className="mt-6">
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-teal-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress !== null ? progress.toFixed(2) : 0}%` }}
            ></div>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {hasBlock && nextBlock !== null
                ? `Block ${latestBlock.toLocaleString()} / ${nextBlock.toLocaleString()}`
                : 'N/A'}
              {progress !== null && ` (${progress.toFixed(1)}%)`}
            </span>
            <span>
              {blocksRemaining !== null && `${blocksRemaining.toLocaleString()} blocks remaining`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
