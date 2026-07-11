import Link from 'next/link';
import Image from 'next/image';
import {
  CubeTransparentIcon,
  CubeIcon,
  ArrowPathIcon,
  CodeBracketIcon,
  TrophyIcon,
  RocketLaunchIcon,
  DocumentTextIcon,
  ChartBarIcon,
  GlobeAltIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';
import { loadConfig } from '@/lib/config';

export default function Header() {
  const config = loadConfig();
  const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
  const currencySymbol = config.currency?.symbol || 'ETH';
  const dexEnabled = config.dex?.enabled ?? false;
  const launchpadEnabled = config.launchpad?.enabled ?? false;
  const bridgeEnabled = (config as { bridge?: { enabled?: boolean } }).bridge?.enabled ?? false;

  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <nav className="container mx-auto px-2 flex items-center justify-between h-14">
        <Link
          href="/"
          className="text-xl font-bold nav-link text-gray-100 hover:text-blue-400 transition-colors flex items-center gap-2"
        >
          <Image src={`/img/${currencySymbol}.svg`} alt={currencySymbol} width={32} height={32} />
          {explorerName}
        </Link>
        <ul className="flex items-center space-x-2 md:space-x-4">
          <li>
            <Link href="/blocks" className="nav-link text-gray-200 flex items-center gap-1">
              <CubeIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Blocks</span>
            </Link>
          </li>
          <li>
            <Link href="/transactions" className="nav-link text-gray-200 flex items-center gap-1">
              <ArrowPathIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Transactions</span>
            </Link>
          </li>
          <li>
            <Link href="/richlist" className="nav-link text-gray-200 flex items-center gap-1">
              <TrophyIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Richlist</span>
            </Link>
          </li>
          <li>
            <Link href="/tokens" className="nav-link text-gray-200 flex items-center gap-1">
              <CubeTransparentIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Tokens</span>
            </Link>
          </li>
          <li>
            <Link href="/contracts" className="nav-link text-gray-200 flex items-center gap-1">
              <CodeBracketIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Contracts</span>
            </Link>
          </li>
          <li>
            <Link href="/stats" className="nav-link text-gray-200 flex items-center gap-1">
              <ChartBarIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Stats</span>
            </Link>
          </li>
          <li>
            <Link href="/network" className="nav-link text-gray-200 flex items-center gap-1">
              <GlobeAltIcon className="w-5 h-5" />
              <span className="hidden sm:inline">Network</span>
            </Link>
          </li>
          {dexEnabled && (
            <li>
              <Link href="/dex" className="nav-link text-gray-200 flex items-center gap-1">
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 3h5v5" />
                  <path d="M8 3H3v5" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 3l7 7" />
                  <path d="M16 21h5v-5" />
                  <path d="M8 21H3v-5" />
                  <path d="M21 21l-7-7" />
                  <path d="M3 21l7-7" />
                </svg>
                <span className="hidden sm:inline">DEX</span>
              </Link>
            </li>
          )}
          {bridgeEnabled && (
            <li>
              <Link href="/bridge" className="nav-link text-gray-200 flex items-center gap-1">
                <ArrowsRightLeftIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Bridge</span>
              </Link>
            </li>
          )}
          {launchpadEnabled && (
            <li>
              <Link href="/launchpad" className="nav-link text-gray-200 flex items-center gap-1">
                <RocketLaunchIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Launchpad</span>
              </Link>
            </li>
          )}
          <li>
            <Link href="/api-docs" className="nav-link text-gray-200 flex items-center gap-1">
              <DocumentTextIcon className="w-5 h-5" />
              <span className="hidden sm:inline">API</span>
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
