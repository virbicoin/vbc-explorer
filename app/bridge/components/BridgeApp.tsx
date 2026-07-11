'use client';

import { BridgeProvider } from './BridgeProvider';
import { BridgeContent } from './BridgeContent';

export function BridgeApp() {
  return (
    <BridgeProvider>
      <BridgeContent />
    </BridgeProvider>
  );
}
