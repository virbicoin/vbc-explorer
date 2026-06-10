import { describe, it, expect } from 'vitest';
import {
  calculateNftOwnership,
  groupTokensByHolder,
  paginateNftItems,
  ZERO_ADDR,
  DEAD_ADDR,
  type TokenTransfer,
} from '@/lib/services/nft.service';

const TOKEN = '0xtoken';
const ALICE = '0xAAAa000000000000000000000000000000000001';
const BOB = '0xBBBb000000000000000000000000000000000002';

function transfer(
  partial: Partial<TokenTransfer> & { tokenId: number; to: string }
): TokenTransfer {
  return {
    from: ZERO_ADDR,
    blockNumber: 1,
    transactionHash: '0xhash',
    timestamp: new Date(),
    value: '1',
    tokenAddress: TOKEN,
    ...partial,
  };
}

describe('calculateNftOwnership', () => {
  it('returns an empty result for no transfers', () => {
    const result = calculateNftOwnership([]);
    expect(result.totalSupply).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.ownership.size).toBe(0);
  });

  it('assigns ownership to the latest recipient (lowercased)', () => {
    const result = calculateNftOwnership([
      transfer({ tokenId: 1, from: ZERO_ADDR, to: ALICE }),
      transfer({ tokenId: 1, from: ALICE, to: BOB }),
    ]);
    expect(result.totalSupply).toBe(1);
    expect(result.ownership.get(1)).toBe(BOB.toLowerCase());
  });

  it('removes a token from supply when burned to the zero address', () => {
    const result = calculateNftOwnership([
      transfer({ tokenId: 7, to: ALICE }),
      transfer({ tokenId: 7, from: ALICE, to: ZERO_ADDR }),
    ]);
    expect(result.totalSupply).toBe(0);
    expect(result.ownership.has(7)).toBe(false);
  });

  it('treats the dead address as a burn', () => {
    const result = calculateNftOwnership([
      transfer({ tokenId: 9, to: ALICE }),
      transfer({ tokenId: 9, from: ALICE, to: DEAD_ADDR }),
    ]);
    expect(result.totalSupply).toBe(0);
  });

  it('handles batch mints producing multiple distinct token ids', () => {
    const result = calculateNftOwnership([
      transfer({ tokenId: 1, to: ALICE }),
      transfer({ tokenId: 2, to: ALICE }),
      transfer({ tokenId: 3, to: BOB }),
    ]);
    expect(result.totalSupply).toBe(3);
    // items are sorted by tokenId descending
    expect(result.items.map((i) => i.tokenId)).toEqual([3, 2, 1]);
  });

  it('skips transfers without a token id', () => {
    const result = calculateNftOwnership([
      transfer({ tokenId: undefined as unknown as number, to: ALICE }),
      transfer({ tokenId: 5, to: BOB }),
    ]);
    expect(result.totalSupply).toBe(1);
    expect(result.ownership.get(5)).toBe(BOB.toLowerCase());
  });
});

describe('groupTokensByHolder', () => {
  it('groups token ids per holder and sorts them ascending', () => {
    const ownership = new Map<number, string>([
      [3, ALICE.toLowerCase()],
      [1, ALICE.toLowerCase()],
      [2, BOB.toLowerCase()],
    ]);
    const { holderTokens } = groupTokensByHolder(ownership);
    expect(holderTokens.get(ALICE.toLowerCase())).toEqual([1, 3]);
    expect(holderTokens.get(BOB.toLowerCase())).toEqual([2]);
  });

  it('returns an empty map for empty ownership', () => {
    const { holderTokens } = groupTokensByHolder(new Map());
    expect(holderTokens.size).toBe(0);
  });
});

describe('paginateNftItems', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ tokenId: i + 1, owner: ALICE }));

  it('returns the requested page slice', () => {
    const result = paginateNftItems(items, 1, 10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0].tokenId).toBe(1);
    expect(result.pagination).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3 });
  });

  it('returns the final partial page', () => {
    const result = paginateNftItems(items, 3, 10);
    expect(result.items).toHaveLength(5);
    expect(result.items[0].tokenId).toBe(21);
  });

  it('returns an empty slice for out-of-range pages', () => {
    const result = paginateNftItems(items, 99, 10);
    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(25);
  });
});
