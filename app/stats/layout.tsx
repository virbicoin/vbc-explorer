import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('stats');

export default function StatsLayout({ children }: { children: ReactNode }) {
  return children;
}
