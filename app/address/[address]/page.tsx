import type { Metadata } from 'next';
import { buildAddressMetadata, buildBreadcrumbJsonLd, shortenHex } from '@/lib/seo';
import { getAddressSummary } from '@/lib/seo-data';
import { JsonLd } from '../../components/JsonLd';
import AddressDetailClient from './AddressDetailClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const account = await getAddressSummary(address);
  return buildAddressMetadata(address, account ?? undefined);
}

export default async function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: `Address ${shortenHex(address)}`, path: `/address/${address}` },
  ]);
  return (
    <>
      <JsonLd data={breadcrumb} />
      <AddressDetailClient params={params} />
    </>
  );
}
