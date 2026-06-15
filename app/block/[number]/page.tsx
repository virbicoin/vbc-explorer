import type { Metadata } from 'next';
import { buildBlockMetadata, buildBreadcrumbJsonLd } from '@/lib/seo';
import { getBlockSummary } from '@/lib/seo-data';
import { JsonLd } from '../../components/JsonLd';
import BlockDetailClient from './BlockDetailClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}): Promise<Metadata> {
  const { number } = await params;
  const block = await getBlockSummary(number);
  return buildBlockMetadata(number, block ?? undefined);
}

export default async function BlockPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Blocks', path: '/blocks' },
    { name: `Block #${number}`, path: `/block/${number}` },
  ]);
  return (
    <>
      <JsonLd data={breadcrumb} />
      <BlockDetailClient params={params} />
    </>
  );
}
