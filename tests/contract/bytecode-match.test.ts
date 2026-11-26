import { describe, expect, it } from 'vitest';
import { matchRuntimeBytecode, metadataHexLength } from '@/lib/contract/bytecode-match';

// CBOR metadata as solc appends it: a2 64 'ipfs' 58 22 <34 bytes> 64 'solc' 43 <3 bytes> 0033
const metadata = (fill: string) =>
  'a2646970667358221220' + fill.repeat(64).slice(0, 64) + '64736f6c63430008140033';
const BODY = '6080604052348015600f57600080fd5b50600436106028576000357c0100';

describe('metadataHexLength', () => {
  it('measures the CBOR section from the length in the last two bytes', () => {
    expect(metadataHexLength(BODY + metadata('a'))).toBe(metadata('a').length);
    expect(metadataHexLength('0x' + BODY + metadata('a'))).toBe(metadata('a').length);
  });

  it('is 0 when the code does not end with metadata', () => {
    expect(metadataHexLength(BODY)).toBe(0);
    expect(metadataHexLength('')).toBe(0);
    expect(metadataHexLength('0033')).toBe(0);
  });
});

describe('matchRuntimeBytecode', () => {
  it('is a full match when the code is identical', () => {
    const code = BODY + metadata('a');
    expect(matchRuntimeBytecode('0x' + code, { object: code })).toBe('full');
  });

  it('is a partial match when only the metadata differs', () => {
    expect(matchRuntimeBytecode(BODY + metadata('a'), { object: BODY + metadata('b') })).toBe(
      'partial'
    );
  });

  it('rejects code that differs anywhere before the metadata', () => {
    const changed = BODY.slice(0, -2) + 'ff';
    expect(matchRuntimeBytecode(BODY + metadata('a'), { object: changed + metadata('a') })).toBe(
      null
    );
  });

  it('rejects the shortcuts the old matching accepted', () => {
    const onchain = BODY + metadata('a');
    // a prefix of the on-chain code (old "includes" / common-prefix checks)
    expect(matchRuntimeBytecode(onchain, { object: BODY.slice(0, 20) })).toBe(null);
    // compiled code that contains the on-chain code
    expect(matchRuntimeBytecode(onchain, { object: '00' + onchain + '00' })).toBe(null);
    // same first 80 %, different tail
    const tailChanged = BODY.slice(0, 50) + 'ffffffffffff';
    expect(matchRuntimeBytecode(BODY, { object: tailChanged })).toBe(null);
  });

  it('masks immutables at the positions the compiler reports', () => {
    const compiled = BODY.slice(0, 10) + '00'.repeat(4) + BODY.slice(18) + metadata('a');
    const onchain = BODY.slice(0, 10) + 'deadbeef' + BODY.slice(18) + metadata('a');
    expect(matchRuntimeBytecode(onchain, { object: compiled })).toBe(null);
    expect(
      matchRuntimeBytecode(onchain, {
        object: compiled,
        immutableReferences: { '7': [{ start: 5, length: 4 }] },
      })
    ).toBe('full');
  });

  it('takes linked library addresses from the chain', () => {
    const address = '11'.repeat(20);
    const placeholder = '__$' + 'a'.repeat(34) + '$__';
    const compiled = '73' + placeholder + BODY;
    expect(
      matchRuntimeBytecode('73' + address + BODY, {
        object: compiled,
        linkReferences: { 'Lib.sol': { Lib: [{ start: 1, length: 20 }] } },
      })
    ).toBe('full');
    // placeholders without link references cannot match
    expect(matchRuntimeBytecode('73' + address + BODY, { object: compiled })).toBe(null);
  });

  it('never matches empty code', () => {
    expect(matchRuntimeBytecode('0x', { object: '' })).toBe(null);
    expect(matchRuntimeBytecode('0x', { object: BODY })).toBe(null);
    expect(matchRuntimeBytecode(BODY, undefined)).toBe(null);
  });
});
