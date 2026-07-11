/**
 * CSV helpers for the Etherscan/BscScan-compatible export endpoints.
 *
 * Pure functions (no DB/network) so they can be unit-tested directly.
 */

/**
 * Escape a single CSV field:
 * - always wrapped in double quotes with inner quotes doubled (Etherscan style)
 * - guards against spreadsheet formula injection for user-controlled values
 *   (token names etc.) by prefixing =, +, -, @ with a single quote
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Formula-injection guard: hex values (0x...) and plain numbers are unaffected
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/** Build one CRLF-terminated CSV line from raw field values. */
export function csvLine(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvEscape).join(',') + '\r\n';
}

/**
 * Serialize rows into a CSV document with a UTF-8 BOM (Excel-friendly).
 * The header row is emitted as-is (headers are trusted constants).
 */
export function buildCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  let out = '\uFEFF' + headers.map((h) => `"${h}"`).join(',') + '\r\n';
  for (const row of rows) {
    out += csvLine(row);
  }
  return out;
}

/**
 * Format a wei-style integer string into a decimal token amount without
 * floating point loss (plain string arithmetic, supports arbitrary size).
 * Returns '0' for empty/invalid input. Trailing zeros in the fraction are
 * trimmed (Etherscan exports do the same).
 */
export function formatUnitsExact(raw: string | null | undefined, decimals: number): string {
  if (!raw || !/^\d+$/.test(raw)) return '0';
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 77 ? decimals : 18;
  const padded = raw.padStart(d + 1, '0');
  const whole = padded.slice(0, padded.length - d) || '0';
  const fraction = d > 0 ? padded.slice(padded.length - d).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Format a unix timestamp (seconds) as Etherscan's "YYYY-MM-DD HH:mm:ss" UTC. */
export function formatCsvDateTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return '';
  const dt = new Date(unixSeconds * 1000);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ` +
    `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`
  );
}

/**
 * Compute the transaction fee (gasUsed * gasPrice, both wei-scale) as an
 * exact decimal string in native currency units.
 */
export function computeTxFee(
  gasUsed: number | null | undefined,
  gasPrice: string | null | undefined,
  decimals = 18
): string {
  if (!gasUsed || !gasPrice || !/^\d+$/.test(gasPrice)) return '0';
  try {
    const fee = BigInt(gasUsed) * BigInt(gasPrice);
    return formatUnitsExact(fee.toString(), decimals);
  } catch {
    return '0';
  }
}
