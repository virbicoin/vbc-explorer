import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { shortenHex } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Transaction details';

export default async function Image({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return renderOgImage({ eyebrow: 'Transaction', title: shortenHex(hash) });
}
