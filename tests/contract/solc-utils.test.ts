import { describe, it, expect } from 'vitest';
import {
  normalizeCompilerVersion,
  SOLC_RELEASES,
  modernizeSyntax,
  removeMetadata,
} from '@/lib/contract/solc-utils';

describe('normalizeCompilerVersion', () => {
  it('strips a leading v prefix', () => {
    expect(normalizeCompilerVersion('v0.8.20')).toBe('0.8.20');
  });

  it('strips a +commit suffix', () => {
    expect(normalizeCompilerVersion('0.8.20+commit.a1b79de6')).toBe('0.8.20');
  });

  it('strips both prefix and commit suffix', () => {
    expect(normalizeCompilerVersion('v0.8.30+commit.73712a01')).toBe('0.8.30');
  });

  it('leaves a bare version untouched', () => {
    expect(normalizeCompilerVersion('0.6.12')).toBe('0.6.12');
  });
});

describe('SOLC_RELEASES', () => {
  it('maps known versions to their full release names', () => {
    expect(SOLC_RELEASES['0.8.30']).toBe('v0.8.30+commit.73712a01');
    expect(SOLC_RELEASES['0.6.12']).toBe('v0.6.12+commit.27d51765');
  });

  it('every value normalizes back to its key', () => {
    for (const [version, release] of Object.entries(SOLC_RELEASES)) {
      expect(normalizeCompilerVersion(release)).toBe(version);
    }
  });
});

describe('modernizeSyntax', () => {
  it('removes NatSpec block comments', () => {
    const src = '/** @param x the value */\nfunction f() {}';
    expect(modernizeSyntax(src)).not.toContain('@param');
  });

  it('rewrites suicide to selfdestruct', () => {
    expect(modernizeSyntax('suicide(owner);')).toContain('selfdestruct(owner);');
  });

  it('rewrites throw to revert()', () => {
    expect(modernizeSyntax('if (x) throw;')).toContain('revert()');
  });

  it('rewrites var declarations to uint256', () => {
    expect(modernizeSyntax('var amount = 5;')).toContain('uint256 amount =');
  });

  it('preserves strict 0.8.x pragma unchanged (no rewriting)', () => {
    expect(modernizeSyntax('pragma solidity 0.8.20;')).toContain('pragma solidity 0.8.20;');
  });

  it('preserves strict equals 0.8.x pragma unchanged', () => {
    expect(modernizeSyntax('pragma solidity =0.8.19;')).toContain('pragma solidity =0.8.19;');
  });

  it('does not rewrite non-0.8 pragmas', () => {
    expect(modernizeSyntax('pragma solidity 0.6.12;')).toContain('0.6.12');
  });
});

describe('removeMetadata', () => {
  it('lowercases and strips the 0x prefix', () => {
    expect(removeMetadata('0xABCD')).toBe('abcd');
  });

  it('truncates at the IPFS metadata marker', () => {
    const code = 'deadbeef' + 'a264697066735822' + 'ffff';
    expect(removeMetadata('0x' + code)).toBe('deadbeef');
  });

  it('truncates at the bzzr1 metadata marker', () => {
    const code = 'cafe' + 'a265627a7a7231' + '0000';
    expect(removeMetadata(code)).toBe('cafe');
  });

  it('returns the cleaned bytecode unchanged when no marker is present', () => {
    expect(removeMetadata('0x1234abcd')).toBe('1234abcd');
  });
});
