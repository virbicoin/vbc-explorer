import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { shortenHex } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Address details';

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return renderOgImage({ eyebrow: 'Address', title: shortenHex(address) });
}
