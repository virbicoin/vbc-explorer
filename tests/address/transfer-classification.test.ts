import { describe, it, expect } from 'vitest';
import {
  isMintAddress,
  isBurnAddress,
  getTransferKind,
  ZERO_ADDRESS,
  DEAD_ADDRESS,
} from '@/lib/address/transfer-classification';

const NORMAL = '0x1234567890abcdef1234567890abcdef12345678';

describe('isMintAddress', () => {
  it('detects the zero address (any case) and the System sentinel', () => {
    expect(isMintAddress(ZERO_ADDRESS)).toBe(true);
    expect(isMintAddress(ZERO_ADDRESS.toUpperCase())).toBe(true);
    expect(isMintAddress('System')).toBe(true);
  });

  it('returns false for normal and empty senders', () => {
    expect(isMintAddress(NORMAL)).toBe(false);
    expect(isMintAddress('')).toBe(false);
    expect(isMintAddress(null)).toBe(false);
    expect(isMintAddress(undefined)).toBe(false);
  });
});

describe('isBurnAddress', () => {
  it('detects zero, dead and System recipients (any case)', () => {
    expect(isBurnAddress(ZERO_ADDRESS)).toBe(true);
    expect(isBurnAddress(DEAD_ADDRESS)).toBe(true);
    expect(isBurnAddress(DEAD_ADDRESS.toUpperCase())).toBe(true);
    expect(isBurnAddress('System')).toBe(true);
  });

  it('returns false for normal and empty recipients', () => {
    expect(isBurnAddress(NORMAL)).toBe(false);
    expect(isBurnAddress('')).toBe(false);
    expect(isBurnAddress(null)).toBe(false);
    expect(isBurnAddress(undefined)).toBe(false);
  });
});

describe('getTransferKind', () => {
  it('classifies mint, burn and transfer', () => {
    expect(getTransferKind(ZERO_ADDRESS, NORMAL)).toBe('mint');
    expect(getTransferKind(NORMAL, DEAD_ADDRESS)).toBe('burn');
    expect(getTransferKind(NORMAL, NORMAL)).toBe('transfer');
  });

  it('gives mint precedence over burn when both endpoints qualify', () => {
    expect(getTransferKind(ZERO_ADDRESS, ZERO_ADDRESS)).toBe('mint');
  });
});
