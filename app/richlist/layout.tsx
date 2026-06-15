import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('richlist');

export default function RichlistLayout({ children }: { children: ReactNode }) {
  return children;
}
