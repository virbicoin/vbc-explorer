import type { Metadata } from 'next';
import { buildTokenMetadata, buildBreadcrumbJsonLd, shortenHex } from '@/lib/seo';
import { getTokenSummary } from '@/lib/seo-data';
import { JsonLd } from '../../components/JsonLd';
import TokenDetailClient from './TokenDetailClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const token = await getTokenSummary(address);
  return buildTokenMetadata(address, token ?? undefined);
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tokens', path: '/tokens' },
    { name: `Token ${shortenHex(address)}`, path: `/token/${address}` },
  ]);
  return (
    <>
      <JsonLd data={breadcrumb} />
      <TokenDetailClient params={params} />
    </>
  );
}
