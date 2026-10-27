/**
 * Pure URL helpers shared by the server-side safe fetch (`safe-fetch.ts`) and
 * the client-safe image URL validation (`validation.ts`).
 *
 * No Node-only imports: this file is bundled for the browser as well.
 */

/** Gateway used to turn `ipfs://` URIs into https URLs (overridable via config). */
export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

export type UrlRejectReason = 'invalid-url' | 'scheme' | 'ip-literal' | 'dangerous' | 'credentials';

export type ParseSafeUrlResult = { ok: true; url: URL } | { ok: false; reason: UrlRejectReason };

export interface SafeHttpsUrlOptions {
  /** Accept `http://localhost` / `http://127.0.0.1` (development image previews only). */
  allowHttpLocalhost?: boolean;
}

/** `ipfs://<cid>/<path>` (also `ipfs://ipfs/<cid>`) → gateway URL; anything else is returned unchanged. */
export function resolveIpfsUrl(raw: string, gateway: string = DEFAULT_IPFS_GATEWAY): string {
  if (typeof raw !== 'string') return raw;
  const match = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(raw.trim());
  if (!match) return raw;
  const base = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return base + match[1].replace(/^\/+/, '');
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Dotted-quad IPv4 → 4 octets, or null. */
export function parseIpv4(ip: string): number[] | null {
  const match = IPV4_RE.exec(ip.trim());
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** IPv6 text (with or without brackets / zone id) → 8 hextets, or null when malformed. */
export function parseIpv6(ip: string): number[] | null {
  let text = ip.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(':')) return null;

  // Embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4)
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<string>(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const hextets: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    hextets.push(parseInt(group, 16));
  }
  return hextets;
}

/** True when the hostname is an IP address rather than a DNS name (`127.0.0.1`, `[::1]`, `::1`). */
export function isIpLiteral(hostname: string): boolean {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return parseIpv4(bare) !== null || parseIpv6(bare) !== null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // 0/8 "this" network, 10/8, 127/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier-grade NAT
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255
  return false;
}

function isPrivateIpv6(h: number[]): boolean {
  const zeroThroughFour = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
  if (zeroThroughFour && h[5] === 0xffff) {
    // ::ffff:a.b.c.d (IPv4-mapped)
    return isPrivateIpv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  if (zeroThroughFour && h[5] === 0) {
    if (h[6] === 0) return h[7] === 0 || h[7] === 1; // :: unspecified, ::1 loopback
    return true; // ::a.b.c.d (deprecated IPv4-compatible) — never trust
  }
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    // 64:ff9b::/96 NAT64
    return isPrivateIpv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  if (h[0] === 0x2002) {
    // 2002::/16 6to4 embeds the IPv4 address in the next two hextets
    return isPrivateIpv4([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff]);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * True for every address that must never be fetched from a server-side
 * request: loopback, unspecified, link-local (169.254/16 incl. cloud metadata),
 * private (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10), 0/8, multicast,
 * reserved, ULA / link-local IPv6 and IPv4-mapped / NAT64 / 6to4 equivalents.
 * Unparseable input counts as private.
 */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(ip);
  if (!v6) return true;
  return isPrivateIpv6(v6);
}

/** Patterns that must never appear in a URL we use (scheme smuggling, inline handlers). */
const DANGEROUS_URL_PATTERNS = [
  /javascript:/i,
  /data:/i,
  /vbscript:/i,
  /file:/i,
  /<script/i,
  /on\w+=/i,
];

/**
 * Parse a chain-derived string as an https URL that is safe to use as a
 * resource location: https only, no credentials, no IP-literal host, none of
 * the dangerous patterns. This does NOT resolve DNS; `safeFetchJson` does.
 */
export function parseSafeHttpsUrl(
  raw: string | null | undefined,
  options: SafeHttpsUrlOptions = {}
): ParseSafeUrlResult {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'invalid-url' };
  const trimmed = raw.trim();
  if (DANGEROUS_URL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: 'dangerous' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.username || url.password) return { ok: false, reason: 'credentials' };

  const hostname = url.hostname;
  if (url.protocol !== 'https:') {
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (options.allowHttpLocalhost && url.protocol === 'http:' && isLocalhost) {
      return { ok: true, url };
    }
    return { ok: false, reason: 'scheme' };
  }
  if (!hostname) return { ok: false, reason: 'invalid-url' };
  if (isIpLiteral(hostname)) return { ok: false, reason: 'ip-literal' };
  return { ok: true, url };
}
