import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClientIp,
  getTrustedIpHeaderName,
  normalizeIp,
  DEFAULT_TRUSTED_IP_HEADER,
} from '@/lib/security/validation';
import {
  ABUSE_THRESHOLD,
  RATE_LIMITS,
  effectiveLimit,
  enforceRateLimit,
  getDeniedInCurrentWindow,
  resetRateLimitTracking,
  runExclusive,
  withRateLimit,
} from '@/lib/security/rate-limits';

let counter = 0;
/** Unique public IP per test so the shared in-memory buckets never interfere. */
function freshIp(): string {
  counter += 1;
  return `203.0.113.${(counter % 200) + 1}`.replace(
    '203.0.113',
    `198.51.${100 + Math.floor(counter / 200)}`
  );
}

function makeRequest(headers: Record<string, string> = {}, path = '/api/test'): Request {
  return new Request(`https://explorer.example${path}`, { headers });
}

const testEnv = { NODE_ENV: 'test' } as Record<string, string | undefined>;

describe('getClientIp', () => {
  it('reads only the trusted header and never X-Forwarded-For / X-Real-IP', () => {
    const a = getClientIp(makeRequest({ 'x-forwarded-for': '1.1.1.1' }), testEnv);
    const b = getClientIp(
      makeRequest({ 'x-forwarded-for': '2.2.2.2', 'x-real-ip': '3.3.3.3' }),
      testEnv
    );
    expect(a).toBe('unknown');
    expect(b).toBe('unknown');
    expect(a).toBe(b); // both land in the same (unknown) bucket
  });

  it('keys on the trusted header value', () => {
    expect(getClientIp(makeRequest({ 'x-client-ip': '203.0.113.5' }), testEnv)).toBe('203.0.113.5');
    expect(getClientIp(makeRequest({ 'x-client-ip': '203.0.113.6' }), testEnv)).toBe('203.0.113.6');
    expect(getClientIp(makeRequest({ 'x-client-ip': '[2001:DB8::1]' }), testEnv)).toBe(
      '2001:db8::1'
    );
  });

  it('returns unknown for missing or malformed values', () => {
    expect(getClientIp(makeRequest(), testEnv)).toBe('unknown');
    expect(getClientIp(makeRequest({ 'x-client-ip': 'evil' }), testEnv)).toBe('unknown');
    expect(getClientIp(makeRequest({ 'x-client-ip': '1.2.3.4, 5.6.7.8' }), testEnv)).toBe(
      'unknown'
    );
    expect(getClientIp(makeRequest({ 'x-client-ip': '999.1.1.1' }), testEnv)).toBe('unknown');
  });

  it('honours TRUSTED_IP_HEADER', () => {
    const env = { TRUSTED_IP_HEADER: 'CF-Connecting-IP', NODE_ENV: 'test' };
    expect(getTrustedIpHeaderName(env)).toBe('cf-connecting-ip');
    expect(getTrustedIpHeaderName({})).toBe(DEFAULT_TRUSTED_IP_HEADER);
    expect(getClientIp(makeRequest({ 'cf-connecting-ip': '203.0.113.9' }), env)).toBe(
      '203.0.113.9'
    );
    expect(getClientIp(makeRequest({ 'x-client-ip': '203.0.113.9' }), env)).toBe('unknown');
  });

  it('falls back to loopback only in development when the header is absent', () => {
    const dev = { NODE_ENV: 'development' };
    expect(getClientIp(makeRequest(), dev)).toBe('127.0.0.1');
    expect(getClientIp(makeRequest({ 'x-client-ip': 'garbage' }), dev)).toBe('unknown');
    expect(getClientIp(makeRequest(), { NODE_ENV: 'production' })).toBe('unknown');
  });

  it('normalizeIp accepts IPv4/IPv6 only', () => {
    expect(normalizeIp(' 10.0.0.1 ')).toBe('10.0.0.1');
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp('host.example')).toBeNull();
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => resetRateLimitTracking());
  afterEach(() => vi.restoreAllMocks());

  it('allows up to the bucket limit per minute and then returns 429 with Retry-After', async () => {
    const ip = freshIp();
    const request = makeRequest({ 'x-client-ip': ip }, '/api/compile');
    const limit = RATE_LIMITS.verify.perMinute;
    for (let i = 0; i < limit; i++) {
      expect(enforceRateLimit(request, 'verify')).toBeNull();
    }
    const denied = enforceRateLimit(request, 'verify');
    expect(denied).not.toBeNull();
    expect(denied?.status).toBe(429);
    expect(Number(denied?.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await denied?.json()).toMatchObject({ error: 'Rate limit exceeded' });
    expect(getDeniedInCurrentWindow(ip)).toBe(1);
  });

  it('gives clients without a trusted IP a tenth of the limit in one shared bucket', () => {
    expect(effectiveLimit('api', 'unknown')).toBe(RATE_LIMITS.api.perMinute / 10);
    expect(effectiveLimit('api', '203.0.113.1')).toBe(RATE_LIMITS.api.perMinute);
    expect(effectiveLimit('verify', 'unknown')).toBe(1);
  });

  it('uses the response format of the API family', async () => {
    const ip = freshIp();
    const request = makeRequest({ 'x-client-ip': ip });
    for (let i = 0; i < RATE_LIMITS.verify.perMinute; i++) enforceRateLimit(request, 'verify');
    const v2 = enforceRateLimit(request, 'verify', { format: 'v2' });
    expect(await v2?.json()).toEqual({ message: 'Rate limit exceeded' });
    const etherscan = enforceRateLimit(request, 'verify', { format: 'etherscan' });
    expect(await etherscan?.json()).toEqual({
      status: '0',
      message: 'Rate limit exceeded',
      result: null,
    });
  });

  it('counts repeated denials per IP across buckets (abuse warning threshold)', () => {
    const ip = freshIp();
    const request = makeRequest({ 'x-client-ip': ip });
    for (let i = 0; i < RATE_LIMITS.verify.perMinute + ABUSE_THRESHOLD; i++) {
      enforceRateLimit(request, 'verify');
    }
    for (let i = 0; i < RATE_LIMITS.interact.perMinute + 5; i++) {
      enforceRateLimit(request, 'interact');
    }
    expect(getDeniedInCurrentWindow(ip)).toBe(ABUSE_THRESHOLD + 5);
  });
});

describe('withRateLimit', () => {
  beforeEach(() => resetRateLimitTracking());

  it('passes allowed requests to the handler and blocks the rest', async () => {
    const ip = freshIp();
    const handler = vi.fn(async () => new Response('ok'));
    const wrapped = withRateLimit('interact', handler);
    const request = makeRequest({ 'x-client-ip': ip });
    for (let i = 0; i < RATE_LIMITS.interact.perMinute; i++) {
      expect((await wrapped(request, undefined)).status).toBe(200);
    }
    expect((await wrapped(request, undefined)).status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(RATE_LIMITS.interact.perMinute);
  });

  it('serializes handlers of a bucket with an exclusive mutex (verify)', async () => {
    const order: string[] = [];
    const wrapped = withRateLimit('verify', async (request: Request) => {
      const id = new URL(request.url).searchParams.get('id');
      order.push(`start ${id}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end ${id}`);
      return new Response('ok');
    });
    const ipA = freshIp();
    const ipB = freshIp();
    await Promise.all([
      wrapped(makeRequest({ 'x-client-ip': ipA }, '/api/compile?id=a'), undefined),
      wrapped(makeRequest({ 'x-client-ip': ipB }, '/api/compile?id=b'), undefined),
    ]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('runExclusive', () => {
  it('runs calls with the same name one after another and releases on error', async () => {
    const events: string[] = [];
    const failing = runExclusive('t', async () => {
      events.push('first');
      throw new Error('boom');
    });
    const second = runExclusive('t', async () => {
      events.push('second');
      return 2;
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await second).toBe(2);
    expect(events).toEqual(['first', 'second']);
  });
});
