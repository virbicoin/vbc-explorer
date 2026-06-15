import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { loadConfig } from '@/lib/config';

const config = loadConfig();
const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
const networkName = config.network?.name || config.currency?.name || 'Blockchain';

export const metadata: Metadata = {
  title: `API Documentation | ${explorerName}`,
  description: `REST API documentation for the ${networkName} blockchain explorer — blocks, transactions, addresses, tokens, contracts and statistics endpoints.`,
  alternates: { canonical: '/api-docs' },
};

export default function ApiDocsLayout({ children }: { children: ReactNode }) {
  return children;
}
