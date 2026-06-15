import { describe, it, expect } from 'vitest';
import {
  buildAddressMetadata,
  buildBlockMetadata,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
  buildTokenMetadata,
  buildTxMetadata,
  buildWebSiteJsonLd,
  formatNativeAmount,
  shortenHex,
} from '@/lib/seo';

const ADDR = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const MINER = '0x950302976387b43e042aea242ae8dab8e5c204d1';
const HASH = '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b';

describe('shortenHex', () => {
  it('shortens a long hex value to lead…tail', () => {
    expect(shortenHex(ADDR)).toBe('0x742d…f44e');
  });

  it('leaves a value that is already short untouched', () => {
    expect(shortenHex('0x1234')).toBe('0x1234');
  });

  it('honours custom lead/tail lengths', () => {
    expect(shortenHex(ADDR, 4, 6)).toBe('0x74…38f44e');
  });
});

describe('formatNativeAmount', () => {
  it('formats whole + fractional wei with a thousands separator', () => {
    expect(formatNativeAmount('1924245236517716618000000', 18, 'COIN')).toBe(
      '1,924,245.236517 COIN'
    );
  });

  it('formats round amounts without a fraction', () => {
    expect(formatNativeAmount('10000000000000000000', 18, 'COIN')).toBe('10 COIN');
    expect(formatNativeAmount('1000000000000000000000', 18, 'COIN')).toBe('1,000 COIN');
  });

  it('keeps a sub-1 fraction', () => {
    expect(formatNativeAmount('1500000000000000000', 18, 'COIN')).toBe('1.5 COIN');
  });

  it('omits the symbol when none is given', () => {
    expect(formatNativeAmount('2000000000000000000', 18)).toBe('2');
  });

  it('returns "" for zero, dust below precision, and bad input', () => {
    expect(formatNativeAmount('0', 18, 'COIN')).toBe('');
    expect(formatNativeAmount('10', 18, 'COIN')).toBe(''); // 10 wei rounds to 0
    expect(formatNativeAmount('-5', 18, 'COIN')).toBe('');
    expect(formatNativeAmount('not-a-number', 18, 'COIN')).toBe('');
  });
});

describe('buildBlockMetadata', () => {
  it('enriches the description with miner and date when known', () => {
    const ts = 1767351838;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const meta = buildBlockMetadata('12345', { miner: MINER, timestamp: ts });
    expect(String(meta.title)).toContain('Block #12345');
    expect(String(meta.description)).toContain(`mined by ${shortenHex(MINER)}`);
    expect(String(meta.description)).toContain(date);
    expect(meta.alternates?.canonical).toBe('/block/12345');
  });

  it('falls back to a generic description with no summary', () => {
    const meta = buildBlockMetadata('12345');
    expect(String(meta.description)).toContain('miner, transactions, gas used');
  });
});

describe('buildTxMetadata', () => {
  it('keeps the full hash in the description and shortens the title', () => {
    const meta = buildTxMetadata(HASH);
    expect(String(meta.title)).toContain(shortenHex(HASH));
    expect(String(meta.description)).toContain(HASH);
  });

  it('enriches with from/to/status and omits a zero value', () => {
    const meta = buildTxMetadata(HASH, { from: ADDR, to: MINER, value: '0', status: 1 });
    const desc = String(meta.description);
    expect(desc).toContain(`from ${shortenHex(ADDR)}`);
    expect(desc).toContain(`to ${shortenHex(MINER)}`);
    expect(desc).toContain('succeeded');
  });

  it('includes a non-zero value and a failed status', () => {
    const meta = buildTxMetadata(HASH, { value: '2500000000000000000', status: 0 });
    const desc = String(meta.description);
    expect(desc).toContain('2.5');
    expect(desc).toContain('failed');
  });
});

describe('buildAddressMetadata', () => {
  it('describes a contract balance when known', () => {
    const meta = buildAddressMetadata(ADDR, { balance: '1924245236517716618000000', type: 1 });
    const desc = String(meta.description);
    expect(desc).toContain('Contract');
    expect(desc).toContain('holds');
    expect(desc).toContain('1,924,245');
  });

  it('falls back to a generic description with no summary', () => {
    const meta = buildAddressMetadata(ADDR);
    expect(String(meta.title)).toContain(`Address ${shortenHex(ADDR)}`);
    expect(String(meta.description)).toContain('balance, transactions, token holdings');
  });
});

describe('buildTokenMetadata', () => {
  it('uses "Name (SYMBOL)" as the title when both are known', () => {
    const meta = buildTokenMetadata(ADDR, { name: 'My Token', symbol: 'MTK', type: 'ERC-20' });
    expect(String(meta.title)).toContain('My Token (MTK)');
    expect(meta.alternates?.canonical).toBe(`/token/${ADDR}`);
    expect(String(meta.description)).toContain(ADDR);
    expect(String(meta.description)).toContain('ERC-20 token');
    expect(String(meta.openGraph?.title)).toContain('My Token (MTK)');
  });

  it('falls back to the symbol alone when the name is missing', () => {
    const meta = buildTokenMetadata(ADDR, { symbol: 'MTK' });
    expect(String(meta.title)).toContain('MTK');
    expect(String(meta.title)).not.toContain('(');
  });

  it('falls back to the shortened address when no identity is known', () => {
    const meta = buildTokenMetadata(ADDR);
    expect(String(meta.title)).toContain(`Token ${shortenHex(ADDR)}`);
  });

  it('ignores blank identity fields', () => {
    const meta = buildTokenMetadata(ADDR, { name: '  ', symbol: '' });
    expect(String(meta.title)).toContain(`Token ${shortenHex(ADDR)}`);
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('builds a schema.org BreadcrumbList with positioned items', () => {
    const ld = buildBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Blocks', path: '/blocks' },
      { name: 'Block #5', path: '/block/5' },
    ]);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('BreadcrumbList');

    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ '@type': 'ListItem', position: 1, name: 'Home' });
    expect(items[2]).toMatchObject({ position: 3, name: 'Block #5' });
    expect(String(items[1].item)).toContain('/blocks');
  });
});

describe('buildWebSiteJsonLd', () => {
  it('declares a WebSite, with a SearchAction targeting /search when a URL is set', () => {
    const ld = buildWebSiteJsonLd();
    expect(ld['@type']).toBe('WebSite');
    expect(typeof ld.name).toBe('string');

    const action = ld.potentialAction as Record<string, unknown> | undefined;
    if (action) {
      expect(action['@type']).toBe('SearchAction');
      const target = action.target as Record<string, unknown>;
      expect(String(target.urlTemplate)).toContain('/search?q={search_term_string}');
    }
  });
});

describe('buildOrganizationJsonLd', () => {
  it('declares an Organization with a name and only https sameAs links', () => {
    const ld = buildOrganizationJsonLd();
    expect(ld['@type']).toBe('Organization');
    expect(typeof ld.name).toBe('string');

    if (ld.sameAs) {
      expect(Array.isArray(ld.sameAs)).toBe(true);
      for (const url of ld.sameAs as string[]) {
        expect(url).toMatch(/^https?:\/\//);
      }
    }
  });
});
