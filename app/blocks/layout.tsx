import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('blocks');

export default function BlocksLayout({ children }: { children: ReactNode }) {
  return children;
}
