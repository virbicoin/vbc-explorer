import { Suspense } from 'react';
import { Web3Provider } from '@/lib/dex/providers';
import { ApprovalsClient } from './ApprovalsClient';

export default function ApprovalsPage() {
  return (
    <Web3Provider>
      <Suspense fallback={null}>
        <ApprovalsClient />
      </Suspense>
    </Web3Provider>
  );
}
