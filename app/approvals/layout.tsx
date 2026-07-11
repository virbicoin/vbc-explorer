import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildHubMetadata } from '@/lib/seo';

export const metadata: Metadata = buildHubMetadata('approvals');

export default function ApprovalsLayout({ children }: { children: ReactNode }) {
  return children;
}
