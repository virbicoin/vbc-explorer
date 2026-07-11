import HeaderNav from './HeaderNav';
import { loadConfig } from '@/lib/config';

export default function Header() {
  const config = loadConfig();
  const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
  const currencySymbol = config.currency?.symbol || 'ETH';
  const dexEnabled = config.dex?.enabled ?? false;
  const launchpadEnabled = config.launchpad?.enabled ?? false;
  const bridgeEnabled = (config as { bridge?: { enabled?: boolean } }).bridge?.enabled ?? false;

  return (
    <HeaderNav
      explorerName={explorerName}
      currencySymbol={currencySymbol}
      dexEnabled={dexEnabled}
      bridgeEnabled={bridgeEnabled}
      launchpadEnabled={launchpadEnabled}
    />
  );
}
