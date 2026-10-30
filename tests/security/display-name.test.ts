import { describe, expect, it } from 'vitest';
import {
  classifyDisplayName,
  containsControlCharacters,
  hiddenFields,
  hiddenNameLabel,
  hiddenReasonDescription,
  looksLikeUrl,
  sanitizeDisplayText,
  HIDDEN_NAME_LABEL,
  NAME_MAX,
  STICKY_HIDDEN_REASONS,
  SYMBOL_MAX,
} from '@/lib/security/display-name';

// Shapes seen in the 2026-10-24 spam wave (same string returned by name/symbol/logoUrl/tokenURI)
const SPAM_NAMES = [
  'http://127.0.0.1:2375/version',
  'http://127.0.0.1:2379/version',
  'http://127.0.0.1:10255/pods',
  'http://127.0.0.1:8500/v1/status/leader',
  'http://127.0.0.1:9090/api/v1/status/buildinfo',
  'http://127.0.0.1:6060/debug/metrics',
  'http://127.0.0.1:8080/actuator/health',
  'http://127.0.0.1:3000/api/config',
  'http://[::1]:2375/version',
  'http://localhost:2375/version',
  'https://localhost/api/config',
  'ftp://files.example/x',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'example.com',
  'evil.example/claim',
  'claim-airdrop.xyz',
  'www.free-tokens.io/get',
];

describe('looksLikeUrl', () => {
  it.each(SPAM_NAMES)('flags %s', (value) => {
    expect(looksLikeUrl(value)).toBe(true);
  });

  it.each([
    'Wrapped VBC',
    'USDT',
    'VBC Gold',
    'Token.V2',
    'Wrapped.Ether',
    '日本語トークン',
    'LP-VBC/USDT',
    'v1.2',
  ])('accepts %s', (value) => {
    expect(looksLikeUrl(value)).toBe(false);
  });
});

describe('classifyDisplayName', () => {
  it.each(SPAM_NAMES)('hides name %s as url-name', (name) => {
    expect(classifyDisplayName({ name, symbol: 'X' })).toMatchObject({
      hidden: true,
      reason: 'url-name',
    });
  });

  it('hides a URL in the symbol as well', () => {
    expect(classifyDisplayName({ name: 'Nice', symbol: 'https://x.example' })).toMatchObject({
      hidden: true,
      reason: 'url-name',
    });
  });

  it('hides control, zero-width and bidi characters', () => {
    expect(classifyDisplayName({ name: 'Nice​Token', symbol: 'N' }).reason).toBe('control-chars');
    expect(classifyDisplayName({ name: 'Nice', symbol: 'N‮T' }).reason).toBe('control-chars');
    expect(classifyDisplayName({ name: 'Nice\u0000', symbol: 'N' }).reason).toBe('control-chars');
    expect(classifyDisplayName({ name: '﻿Nice', symbol: 'N' }).reason).toBe('control-chars');
  });

  it('hides HTML and over-long names', () => {
    expect(classifyDisplayName({ name: '<b>Bold</b>', symbol: 'B' }).reason).toBe('html');
    expect(classifyDisplayName({ name: 'x'.repeat(NAME_MAX + 1), symbol: 'B' }).reason).toBe(
      'too-long'
    );
    expect(classifyDisplayName({ name: 'ok', symbol: 'y'.repeat(SYMBOL_MAX + 1) }).reason).toBe(
      'too-long'
    );
    expect(
      classifyDisplayName({ name: 'x'.repeat(NAME_MAX), symbol: 'y'.repeat(SYMBOL_MAX) }).hidden
    ).toBe(false);
  });

  it('keeps normal and Japanese names visible', () => {
    for (const name of [
      'Wrapped VBC',
      'VBC Gold',
      '日本語トークン',
      'Shiba Inu',
      'USD Tether',
      'LP VBC/USDT',
    ]) {
      expect(classifyDisplayName({ name, symbol: 'OK' })).toEqual({ hidden: false, logoUrl: null });
    }
  });

  it('sanitizes logoUrl without hiding on its own', () => {
    expect(classifyDisplayName({ name: 'Nice', symbol: 'N', logoUrl: 'http://x/a.png' })).toEqual({
      hidden: false,
      logoUrl: null,
    });
    expect(
      classifyDisplayName({ name: 'Nice', symbol: 'N', logoUrl: 'https://cdn.example/a.png' })
        .logoUrl
    ).toBe('https://cdn.example/a.png');
    expect(
      classifyDisplayName({ name: 'Nice', symbol: 'N', logoUrl: 'https://127.0.0.1/a.png' }).logoUrl
    ).toBeNull();
  });

  it('hiddenFields returns the document fields', () => {
    expect(hiddenFields({ name: 'http://127.0.0.1/x', symbol: 'X' })).toEqual({
      hidden: true,
      hiddenReason: 'url-name',
    });
    expect(hiddenFields({ name: 'Fine', symbol: 'F' })).toEqual({
      hidden: false,
      hiddenReason: null,
    });
  });
});

describe('sanitizeDisplayText', () => {
  it('strips control characters, collapses whitespace and truncates', () => {
    expect(sanitizeDisplayText('  Hello​  World\u0000 ')).toBe('Hello World');
    expect(sanitizeDisplayText('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    expect(sanitizeDisplayText(42)).toBe('');
    expect(sanitizeDisplayText('日本語トークン')).toBe('日本語トークン');
  });

  it('containsControlCharacters detects the ranges', () => {
    expect(containsControlCharacters('plain')).toBe(false);
    expect(containsControlCharacters('tab\there')).toBe(true);
    expect(containsControlCharacters('zero‌width')).toBe(true);
  });
});

describe('hidden badge wording', () => {
  it('names the reason and keeps the spam label for name-based reasons', () => {
    expect(hiddenNameLabel('url-name')).toBe(HIDDEN_NAME_LABEL);
    expect(hiddenNameLabel('control-chars')).toBe(HIDDEN_NAME_LABEL);
    expect(hiddenNameLabel(undefined)).toBe(HIDDEN_NAME_LABEL);
    expect(hiddenNameLabel('no-code')).toBe('Hidden (no contract code)');
    expect(hiddenNameLabel('manual')).toMatch(/operators/);
    for (const reason of ['url-name', 'control-chars', 'html', 'too-long', 'no-code', 'manual']) {
      expect(hiddenReasonDescription(reason).length).toBeGreaterThan(20);
    }
    expect(hiddenReasonDescription('no-code')).toMatch(/no contract code/);
    expect(hiddenReasonDescription('url-name')).toMatch(/URL/);
    expect(hiddenReasonDescription(null)).toMatch(/URL or control characters/);
  });

  it('treats operator and audit reasons as sticky for the automatic pass', () => {
    expect(STICKY_HIDDEN_REASONS).toEqual(['manual', 'no-code']);
  });
});
