import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('tokens');

export default function TokensLayout({ children }: { children: ReactNode }) {
  return children;
}
