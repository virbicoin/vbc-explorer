import { describe, it, expect } from 'vitest';
import { resolveLevel, shouldLog } from '@/lib/logger';

describe('resolveLevel', () => {
  it('forces error-only output under test environments', () => {
    expect(resolveLevel({ NODE_ENV: 'test' })).toBe('error');
    expect(resolveLevel({ VITEST: 'true' })).toBe('error');
  });

  it('reads a valid LOG_LEVEL outside of tests', () => {
    expect(resolveLevel({ LOG_LEVEL: 'debug' })).toBe('debug');
    expect(resolveLevel({ LOG_LEVEL: 'WARN' })).toBe('warn');
  });

  it('defaults to info for missing or invalid LOG_LEVEL', () => {
    expect(resolveLevel({})).toBe('info');
    expect(resolveLevel({ LOG_LEVEL: 'bogus' })).toBe('info');
  });
});

describe('shouldLog', () => {
  it('emits messages at or above the configured level', () => {
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('warn', 'info')).toBe(true);
    expect(shouldLog('error', 'info')).toBe(true);
  });

  it('suppresses messages below the configured level', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('info', 'warn')).toBe(false);
    expect(shouldLog('warn', 'error')).toBe(false);
  });

  it('suppresses everything when configured to silent', () => {
    expect(shouldLog('error', 'silent')).toBe(false);
  });
});
