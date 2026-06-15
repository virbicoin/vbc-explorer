import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('network');

export default function NetworkLayout({ children }: { children: ReactNode }) {
  return children;
}
