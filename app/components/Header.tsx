import HeaderNav from './HeaderNav';
import { getFeatures, loadConfig } from '@/lib/config';

export default function Header() {
  const config = loadConfig();
  const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
  const currencySymbol = config.currency?.symbol || 'ETH';

  return (
    <HeaderNav
      explorerName={explorerName}
      currencySymbol={currencySymbol}
      features={getFeatures()}
    />
  );
}
