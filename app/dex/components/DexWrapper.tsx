'use client';

import { Web3Provider } from '@/lib/dex/providers';
import { DexHeader } from './DexHeader';

interface DexWrapperProps {
  children: React.ReactNode;
}

export function DexWrapper({ children }: DexWrapperProps) {
  return (
    <Web3Provider>
      <DexHeader />
      {children}
    </Web3Provider>
  );
}
