import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('contracts');

export default function ContractsLayout({ children }: { children: ReactNode }) {
  return children;
}
