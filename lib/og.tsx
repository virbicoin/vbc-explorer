import { ImageResponse } from 'next/og';
import { loadConfig } from '@/lib/config';

/**
 * Shared renderer for the per-entity Open Graph cards
 * (block / tx / address / token → `opengraph-image.tsx`).
 *
 * Pure: branding comes from config, the rest from the passed content only —
 * no DB/RPC — so it is safe on the render path and Next caches the result.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

interface OgContent {
  /** Small uppercase label above the title, e.g. "Block". */
  eyebrow: string;
  /** The large primary value, e.g. a token name, a block "#12345" or a hash. */
  title: string;
  /** Optional secondary line under the title, e.g. the symbol and short address. */
  subtitle?: string;
}

export function renderOgImage({ eyebrow, title, subtitle }: OgContent): ImageResponse {
  const config = loadConfig();
  const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
  const networkName = config.network?.name || config.currency?.name || 'Blockchain';
  const accent =
    typeof config.currency?.color === 'string' && HEX_COLOR.test(config.currency.color)
      ? config.currency.color
      : '#34d399';

  let domain = '';
  try {
    if (config.explorer?.url) domain = new URL(config.explorer.url).host;
  } catch {
    /* ignore malformed explorer.url */
  }
  const footer = domain ? `${networkName}  ·  ${domain}` : networkName;
  // Shrink long token names so they don't overflow the card width.
  const titleSize = title.length > 16 ? 64 : 88;

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px',
        background: '#0b1220',
        color: '#e5e7eb',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, color: accent }}>
        {explorerName}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 38, letterSpacing: 10, color: '#94a3b8' }}>
          {eyebrow.toUpperCase()}
        </div>
        <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 800, marginTop: 8 }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ display: 'flex', fontSize: 34, color: '#64748b', marginTop: 16 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', fontSize: 30, color: '#94a3b8' }}>{footer}</div>
    </div>,
    { ...OG_SIZE }
  );
}
