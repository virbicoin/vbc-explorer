import type { Metadata } from 'next';
import { getNetworkName, loadConfig } from '@/lib/config';

interface BridgeSideConfig {
  name?: string;
}

interface BridgeMetadataConfig {
  bridge?: { routes?: Array<{ remote?: BridgeSideConfig }>; remote?: BridgeSideConfig };
}

// Names come from config.json (network.name and the bridge routes' remote chains)
export function generateMetadata(): Metadata {
  const { bridge } = loadConfig() as BridgeMetadataConfig;
  const network = getNetworkName();
  const remotes = [
    ...new Set(
      [...(bridge?.routes ?? []).map((route) => route.remote?.name), bridge?.remote?.name].filter(
        (name): name is string => Boolean(name)
      )
    ),
  ];
  return {
    title: `Bridge - ${network}`,
    description: remotes.length
      ? `Bridge assets 1:1 between ${network} and ${remotes.join(', ')}`
      : `Bridge assets to and from ${network}`,
  };
}

export default function BridgeLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-900 text-white">{children}</div>;
}
