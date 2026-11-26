/**
 * Optional parts (lib/features.ts): which are on for a config, which paths belong to them, and
 * how proxy.ts and the sitemap treat a part that is off, which background jobs a config runs
 * (tools/worker.ts) and when the web server starts them. A plain block explorer runs with all
 * of the parts off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  featureOfPath,
  planJobs,
  priceSources,
  resolveFeatures,
  selectJobs,
  workerWanted,
  type Features,
  type JobPlan,
} from '@/lib/features';

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

const enabled = (plan: JobPlan[]) => plan.filter((job) => job.enabled).map((job) => job.name);

describe('planJobs', () => {
  it('runs only the core jobs for a plain block explorer', () => {
    const plan = planJobs({ config: { richlist: { enabled: false } }, traceUrl: null });
    expect(enabled(plan)).toEqual(['sync', 'stats', 'tokens']);
    expect(plan.find((job) => job.name === 'richlist')?.reason).toBe('richlist.enabled is false');
    expect(plan.find((job) => job.name === 'price')?.reason).toContain('no price source');
    expect(plan.find((job) => job.name === 'internal-transactions')?.reason).toContain(
      'traces.url'
    );
  });

  it('adds internal transactions with a trace source, the richlist unless it is off', () => {
    const plan = planJobs({ config: {}, traceUrl: '/node/jsonrpc.ipc' });
    expect(enabled(plan)).toEqual(['sync', 'stats', 'tokens', 'internal-transactions', 'richlist']);
  });

  it('names the DEX and Launchpad work of the token job when they are on', () => {
    const plan = planJobs({
      config: { dex: { enabled: true }, launchpad: { enabled: true } },
      traceUrl: null,
    });
    expect(plan.find((job) => job.name === 'tokens')?.reason).toBe(
      'token discovery and updates (always); DEX LP pairs; Launchpad factories'
    );
  });
});

describe('priceSources', () => {
  it('lists the sources tools/price.ts would ask', () => {
    const priceApi = {
      coingecko: { enabled: true },
      cmc: { enabled: true },
      coinpaprika: { enabled: false },
      dex: { enabled: true },
    };
    // CMC needs its key, the DEX source the DEX
    expect(priceSources({ currency: { priceApi } })).toEqual(['coingecko']);
    expect(
      priceSources({ currency: { priceApi }, dex: { enabled: true } }, { CMC_API_KEY: 'k' })
    ).toEqual(['coingecko', 'cmc', 'dex']);
    // the DEX source is on by default once the DEX is
    expect(priceSources({ dex: { enabled: true } })).toEqual(['dex']);
    expect(
      priceSources({ dex: { enabled: true }, currency: { priceApi: { dex: { enabled: false } } } })
    ).toEqual([]);
  });
});

describe('selectJobs', () => {
  const plan = planJobs({ config: { richlist: { enabled: false } }, traceUrl: null });

  it('takes the enabled jobs, or exactly the ones named', () => {
    expect(selectJobs(plan)).toEqual(['sync', 'stats', 'tokens']);
    // in start order, also a job the config switches off
    expect(selectJobs(plan, ['richlist', 'sync'])).toEqual(['sync', 'richlist']);
  });

  it('refuses an unknown job name', () => {
    expect(() => selectJobs(plan, ['sync', 'rich-list'])).toThrow('Unknown job: rich-list');
  });
});

describe('workerWanted', () => {
  it('starts the jobs with the server in production unless EXPLORER_WORKER is off', async () => {
    expect(workerWanted({ NODE_ENV: 'production' })).toBe(true);
    expect(workerWanted({ NODE_ENV: 'production', EXPLORER_WORKER: 'off' })).toBe(false);
    expect(workerWanted({ NODE_ENV: 'development' })).toBe(false);
    expect(workerWanted({ NODE_ENV: 'development', EXPLORER_WORKER: 'on' })).toBe(true);
    expect(workerWanted({})).toBe(false);
  });
});
