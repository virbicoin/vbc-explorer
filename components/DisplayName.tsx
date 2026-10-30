'use client';

/**
 * Renders a chain-derived token / contract name or symbol safely:
 * control characters are removed, the text is length-capped, nothing is
 * linkified, and entries flagged `hidden` (spam-looking names) show a badge
 * with the shortened address instead of the name.
 */

import {
  NAME_MAX,
  SYMBOL_MAX,
  hiddenNameLabel,
  hiddenReasonDescription,
  sanitizeDisplayText,
} from '@/lib/security/display-name';

export interface DisplayNameProps {
  /** Name (or symbol when `variant="symbol"`) as stored in the database. */
  value: string | null | undefined;
  /** True when the token/contract is flagged hidden; renders the badge. */
  hidden?: boolean;
  /** Why it is hidden (`hiddenReason` of the record); selects the badge wording. */
  hiddenReason?: string | null;
  /** Shown next to the badge so a hidden entry stays identifiable. */
  address?: string;
  variant?: 'name' | 'symbol';
  /** Text when the value is empty (default: `Unknown`). */
  fallback?: string;
  className?: string;
  /** Override the length cap (default: 64 for names, 16 for symbols). */
  max?: number;
}

export function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Plain-text variant for places that need a string (titles, `alt`, headings). */
export function displayNameText(
  value: string | null | undefined,
  options: {
    hidden?: boolean;
    hiddenReason?: string | null;
    address?: string;
    variant?: 'name' | 'symbol';
    fallback?: string;
    max?: number;
  } = {}
): string {
  if (options.hidden) {
    const label = hiddenNameLabel(options.hiddenReason);
    return options.address ? `${label} ${shortenAddress(options.address)}` : label;
  }
  const max = options.max ?? (options.variant === 'symbol' ? SYMBOL_MAX : NAME_MAX);
  return (
    sanitizeDisplayText(value, max) ||
    options.fallback ||
    (options.fallback === '' ? '' : 'Unknown')
  );
}

export default function DisplayName({
  value,
  hidden = false,
  hiddenReason,
  address,
  variant = 'name',
  fallback,
  className,
  max,
}: DisplayNameProps) {
  if (hidden) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-300 ${className ?? ''}`}
        title={hiddenReasonDescription(hiddenReason)}
      >
        <span aria-hidden="true">⚠</span>
        {hiddenNameLabel(hiddenReason)}
        {address ? (
          <span className="font-mono text-yellow-200/80">{shortenAddress(address)}</span>
        ) : null}
      </span>
    );
  }
  return <span className={className}>{displayNameText(value, { variant, fallback, max })}</span>;
}
