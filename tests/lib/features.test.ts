/**
 * Optional parts (lib/features.ts): which are on for a config, which paths belong to them, and
 * how proxy.ts, the sitemap and /api/v2/stats treat a part that is off. A plain block explorer
 * runs with all of them off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { featureOfPath, resolveFeatures, type Features } from '@/lib/features';

const features = vi.hoisted(() => ({
  current: { dex: false, launchpad: false, bridge: false, richlist: false } as Features,
}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getFeatures: () => features.current,
}));

const { proxy } = await import('@/proxy');
const sitemap = (await import('@/app/sitemap')).default;

const request = (path: string) => new NextRequest(`https://explorer.example${path}`);

beforeEach(() => {
  features.current = { dex: false, launchpad: false, bridge: false, richlist: false };
});

describe('resolveFeatures', () => {
  it('turns DEX, Launchpad and bridge on only with enabled: true', () => {
    expect(resolveFeatures({})).toEqual({
      dex: false,
      launchpad: false,
      bridge: false,
      // on unless switched off, as before it could be
      richlist: true,
    });
    expect(
      resolveFeatures({
        dex: { enabled: true },
        launchpad: { enabled: 'yes' },
        bridge: { enabled: true },
        richlist: { enabled: false },
      })
    ).toEqual({ dex: true, launchpad: false, bridge: true, richlist: false });
  });
});

describe('featureOfPath', () => {
  it('matches whole path segments of pages and API routes', () => {
    expect(featureOfPath('/dex')).toBe('dex');
    expect(featureOfPath('/dex/swap')).toBe('dex');
    expect(featureOfPath('/api/dex/geckoterminal/networks')).toBe('dex');
    expect(featureOfPath('/launchpad/token/0xabc')).toBe('launchpad');
    expect(featureOfPath('/api/launchpad/register')).toBe('launchpad');
    expect(featureOfPath('/bridge')).toBe('bridge');
    expect(featureOfPath('/api/richlist')).toBe('richlist');
    expect(featureOfPath('/dexes')).toBeNull();
    expect(featureOfPath('/api/v2/stats')).toBeNull();
    expect(featureOfPath('/')).toBeNull();
  });
});

describe('proxy', () => {
  it('answers 404 for the API routes of a part that is off', async () => {
    const response = await proxy(request('/api/dex/pairs'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'FEATURE_DISABLED', message: 'The DEX is not enabled on this explorer' },
    });
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it("uses GeckoTerminal's error format under /api/dex/geckoterminal", async () => {
    const response = await proxy(request('/api/dex/geckoterminal/networks'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      errors: [{ status: '404', title: 'The DEX is not enabled on this explorer' }],
    });
  });

  it('renders the not-found page for the pages of a part that is off', async () => {
    for (const path of ['/dex/swap', '/launchpad', '/bridge', '/richlist']) {
      const response = await proxy(request(path));
      expect(response.headers.get('x-middleware-rewrite')).toBe(
        'https://explorer.example/_feature-disabled'
      );
    }
  });

  it('lets the parts that are on, and everything else, through', async () => {
    features.current = { dex: true, launchpad: true, bridge: true, richlist: true };
    for (const path of ['/api/dex/pairs', '/dex', '/launchpad', '/richlist', '/blocks']) {
      const response = await proxy(request(path));
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    }
  });
});

describe('sitemap', () => {
  it('lists the richlist only when it is on', () => {
    const paths = () => sitemap().map((entry) => new URL(entry.url, 'https://x').pathname);
    expect(paths()).not.toContain('/richlist');
    expect(paths()).toContain('/blocks');
    features.current = { ...features.current, richlist: true };
    expect(paths()).toContain('/richlist');
  });
});
