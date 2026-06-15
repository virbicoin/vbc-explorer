import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { shortenHex } from '@/lib/seo';
import { getTokenSummary } from '@/lib/seo-data';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Token details';

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const token = await getTokenSummary(address);
  const name = token?.name?.trim();
  const symbol = token?.symbol?.trim();
  const label = name || symbol;

  if (label) {
    const eyebrow = token?.type?.trim() ? `${token.type.trim()} Token` : 'Token';
    // Show the symbol (when it isn't already the title) and the address below.
    const subtitle = [name && symbol ? symbol : '', shortenHex(address)]
      .filter(Boolean)
      .join('  ·  ');
    return renderOgImage({ eyebrow, title: label, subtitle });
  }

  return renderOgImage({ eyebrow: 'Token', title: shortenHex(address) });
}
