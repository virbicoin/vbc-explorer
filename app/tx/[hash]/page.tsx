import type { Metadata } from 'next';
import { buildTxMetadata, buildBreadcrumbJsonLd, shortenHex } from '@/lib/seo';
import { getTxSummary } from '@/lib/seo-data';
import { JsonLd } from '../../components/JsonLd';
import TxDetailClient from './TxDetailClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hash: string }>;
}): Promise<Metadata> {
  const { hash } = await params;
  const tx = await getTxSummary(hash);
  return buildTxMetadata(hash, tx ?? undefined);
}

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Transactions', path: '/transactions' },
    { name: `Transaction ${shortenHex(hash)}`, path: `/tx/${hash}` },
  ]);
  return (
    <>
      <JsonLd data={breadcrumb} />
      <TxDetailClient params={params} />
    </>
  );
}
