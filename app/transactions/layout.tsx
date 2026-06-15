import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('transactions');

export default function TransactionsLayout({ children }: { children: ReactNode }) {
  return children;
}
