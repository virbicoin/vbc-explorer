'use client';

import { ReactNode } from 'react';
import { Web3Provider } from '@/lib/dex/providers';

export function LaunchpadWrapper({ children }: { children: ReactNode }) {
  return <Web3Provider>{children}</Web3Provider>;
}
