/**
 * Display-name classification for chain-derived token / contract names.
 *
 * Names and symbols come straight from contract code, so anything can be in
 * them. A token whose name looks like a URL (the 2026-10 spam wave), contains
 * control / zero-width / bidi characters or HTML, or is absurdly long is
 * flagged `hidden` at write time (tools/sync.ts, tools/tokens.ts, launchpad
 * registration) and by the backfill tool (tools/flag-spam-tokens.ts). List
 * APIs exclude hidden entries; detail pages show a badge instead of the name.
 *
 * Browser-safe: the DisplayName component uses sanitizeDisplayText().
 */

import { sanitizeImageUrl } from './validation';

export type HiddenReason =
  | 'url-name'
  | 'control-chars'
  | 'html'
  | 'too-long'
  /** eth_getCode is empty at the address (EOA or self-destructed); set by flag-spam-tokens --audit-code */
  | 'no-code'
  | 'manual';

/** Reasons set by operators / tools rather than by the name classifier; the automatic pass never clears them. */
export const STICKY_HIDDEN_REASONS: readonly string[] = ['manual', 'no-code'];

export interface DisplayNameInput {
  name?: string | null;
  symbol?: string | null;
  logoUrl?: string | null;
}

export interface DisplayNameClassification {
  hidden: boolean;
  reason?: HiddenReason;
  /** `logoUrl` after sanitizeImageUrl (null when it did not pass); never a reason to hide. */
  logoUrl: string | null;
}

export const NAME_MAX = 64;
export const SYMBOL_MAX = 16;

/** Text used in place of a hidden name (name-based reasons). */
export const HIDDEN_NAME_LABEL = 'Hidden (flagged as spam)';

/** Badge label for a hidden entry, by reason. */
export function hiddenNameLabel(reason?: string | null): string {
  switch (reason) {
    case 'no-code':
      return 'Hidden (no contract code)';
    case 'manual':
      return 'Hidden by the explorer operators';
    default:
      return HIDDEN_NAME_LABEL;
  }
}

/** Tooltip explaining why the name is not shown, by reason. */
export function hiddenReasonDescription(reason?: string | null): string {
  switch (reason) {
    case 'url-name':
      return 'The name or symbol looks like a URL, so the address is shown instead';
    case 'control-chars':
      return 'The name or symbol contains control or invisible characters, so the address is shown instead';
    case 'html':
      return 'The name or symbol contains HTML, so the address is shown instead';
    case 'too-long':
      return 'The name or symbol exceeds the length limit, so the address is shown instead';
    case 'no-code':
      return 'There is no contract code at this address (not a deployed token), so the record is kept out of the lists';
    case 'manual':
      return 'Hidden by the explorer operators; the address is shown instead of the name';
    default:
      return 'The name contains a URL or control characters, so the address is shown instead';
  }
}

const URL_PATTERNS = [
  /:\/\//,
  /^(https?|ftp|file|javascript|data):/i,
  // bare domain, optionally followed by a path: example.com, example.com/x
  /^[\w.-]+\.[a-z]{2,}(\/|$)/,
];

const HTML_TAG = /<\/?[a-z][^>]*>/i;

/** C0/C1 control characters, zero-width characters, bidi controls and BOM. */
export function isControlCodePoint(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

export function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    if (isControlCodePoint(char.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

/** True when the text looks like a URL or a bare domain name. */
export function looksLikeUrl(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return URL_PATTERNS.some((pattern) => pattern.test(text));
}

export function containsHtml(value: string): boolean {
  return HTML_TAG.test(value);
}

/** Remove control characters, collapse whitespace and cap the length (for rendering). */
export function sanitizeDisplayText(value: unknown, max: number = NAME_MAX): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const char of value) {
    if (!isControlCodePoint(char.codePointAt(0) ?? 0)) out += char;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > max) out = `${out.slice(0, Math.max(0, max - 1))}…`;
  return out;
}

/**
 * Decide whether a token / contract must be hidden from lists because of its
 * name, symbol or logo. Order: URL-like → control characters → HTML → length.
 */
export function classifyDisplayName(input: DisplayNameInput): DisplayNameClassification {
  const name = typeof input.name === 'string' ? input.name : '';
  const symbol = typeof input.symbol === 'string' ? input.symbol : '';
  const logoUrl = sanitizeImageUrl(input.logoUrl ?? null);
  const texts = [name, symbol];

  let reason: HiddenReason | undefined;
  if (texts.some(looksLikeUrl)) reason = 'url-name';
  else if (texts.some(containsControlCharacters)) reason = 'control-chars';
  else if (texts.some(containsHtml)) reason = 'html';
  else if (name.length > NAME_MAX || symbol.length > SYMBOL_MAX) reason = 'too-long';

  return reason ? { hidden: true, reason, logoUrl } : { hidden: false, logoUrl };
}

/** Fields to merge into a Token / Contract document on write. */
export function hiddenFields(input: DisplayNameInput): {
  hidden: boolean;
  hiddenReason: HiddenReason | null;
} {
  const result = classifyDisplayName(input);
  return { hidden: result.hidden, hiddenReason: result.reason ?? null };
}
