import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Block details';

export default async function Image({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return renderOgImage({ eyebrow: 'Block', title: `#${number}` });
}
