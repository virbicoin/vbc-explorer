'use client';

import { BridgeProvider } from './BridgeProvider';
import { BridgeShell } from './BridgeShell';

export function BridgeApp() {
  return (
    <BridgeProvider>
      <BridgeShell />
    </BridgeProvider>
  );
}
