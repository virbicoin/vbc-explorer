import { describe, it, expect } from 'vitest';
import { getTransactionType, getTransactionTypeGlobal, METHOD_IDS } from '@/lib/transaction-utils';

const ADDR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';

describe('getTransactionType (address context)', () => {
  it('classifies an outgoing native transfer as send', () => {
    const result = getTransactionType({ from: ADDR, to: OTHER, value: '1000', input: '0x' }, ADDR);
    expect(result).toEqual({ type: 'send', action: 'Send', direction: 'out' });
  });

  it('classifies an incoming native transfer as receive', () => {
    const result = getTransactionType({ from: OTHER, to: ADDR, value: '1000', input: '0x' }, ADDR);
    expect(result).toEqual({ type: 'receive', action: 'Receive', direction: 'in' });
  });

  it('overrides the self direction to "out" for native transfers (current behavior)', () => {
    // Note: the native-transfer branch hardcodes direction 'out', so a self
    // transfer is reported as 'out' rather than 'self'. Characterized as-is.
    const result = getTransactionType({ from: ADDR, to: ADDR, value: '1000', input: '0x' }, ADDR);
    expect(result.direction).toBe('out');
  });

  it('keeps the self direction for a self contract call (zero value)', () => {
    const result = getTransactionType({ from: ADDR, to: ADDR, value: '0', input: '0x' }, ADDR);
    expect(result.direction).toBe('self');
  });

  it('recognises an ERC20 transfer method id', () => {
    const result = getTransactionType(
      { from: ADDR, to: OTHER, value: '0', input: '0xa9059cbb0000' },
      ADDR
    );
    expect(result.type).toBe('token_transfer');
    expect(result.action).toBe('Transfer');
    expect(result.direction).toBe('out');
  });

  it('recognises a DEX swap method id', () => {
    const result = getTransactionType(
      { from: ADDR, to: OTHER, value: '0', input: '0x38ed1739abcd' },
      ADDR
    );
    expect(result.type).toBe('swap');
  });

  it('classifies contract creation when sender matches and there is no recipient', () => {
    const result = getTransactionType(
      { from: ADDR, to: null, value: '0', input: '0x60806040' },
      ADDR
    );
    expect(result).toEqual({
      type: 'contract_creation',
      action: 'Contract Deploy',
      direction: 'out',
    });
  });

  it('falls back to contract interaction for unknown method data', () => {
    const result = getTransactionType(
      { from: ADDR, to: OTHER, value: '0', input: '0xdeadbeef1234' },
      ADDR
    );
    expect(result.type).toBe('contract_interaction');
    expect(result.action).toBe('Contract Interaction');
  });

  it('falls back to a contract call for empty input and zero value', () => {
    const result = getTransactionType({ from: ADDR, to: OTHER, value: '0', input: '0x' }, ADDR);
    expect(result).toEqual({
      type: 'contract_interaction',
      action: 'Contract Call',
      direction: 'out',
    });
  });

  it('uses the token transfer fallback when the hash is a known token transfer', () => {
    const txHash = '0xabc';
    const result = getTransactionType(
      { from: ADDR, to: OTHER, value: '0', input: '0x' },
      ADDR,
      new Set([txHash]),
      txHash
    );
    expect(result.type).toBe('token_transfer');
    expect(result.action).toBe('Token Transfer');
  });
});

describe('getTransactionTypeGlobal (no address context)', () => {
  it('classifies contract creation for null recipient', () => {
    expect(getTransactionTypeGlobal({ from: ADDR, to: null, value: '0', input: '0x' })).toEqual({
      type: 'contract_creation',
      action: 'Contract Deploy',
    });
  });

  it('classifies contract creation for the zero recipient', () => {
    expect(getTransactionTypeGlobal({ from: ADDR, to: ZERO, value: '0', input: '0x' }).type).toBe(
      'contract_creation'
    );
  });

  it('classifies a native transfer as send', () => {
    expect(getTransactionTypeGlobal({ from: ADDR, to: OTHER, value: '500', input: '0x' })).toEqual({
      type: 'send',
      action: 'Transfer',
    });
  });

  it('recognises known method ids', () => {
    expect(
      getTransactionTypeGlobal({ from: ADDR, to: OTHER, value: '0', input: '0x095ea7b3' }).type
    ).toBe('approve');
  });

  it('does not carry a direction field', () => {
    const result = getTransactionTypeGlobal({ from: ADDR, to: OTHER, value: '500', input: '0x' });
    expect(result).not.toHaveProperty('direction');
  });
});

describe('METHOD_IDS map', () => {
  it('maps the canonical ERC20 transfer selector', () => {
    expect(METHOD_IDS['0xa9059cbb']).toEqual({ type: 'token_transfer', action: 'Transfer' });
  });
});
