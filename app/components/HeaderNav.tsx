'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, type ComponentType } from 'react';
import {
  CubeTransparentIcon,
  CubeIcon,
  ArrowPathIcon,
  CodeBracketIcon,
  TrophyIcon,
  RocketLaunchIcon,
  DocumentTextIcon,
  ChartBarIcon,
  ArrowsRightLeftIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// Standalone icon so the DEX link matches the heroicons signature.
function DexIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

interface HeaderNavProps {
  explorerName: string;
  currencySymbol: string;
  dexEnabled: boolean;
  bridgeEnabled: boolean;
  launchpadEnabled: boolean;
}

export default function HeaderNav({
  explorerName,
  currencySymbol,
  dexEnabled,
  bridgeEnabled,
  launchpadEnabled,
}: HeaderNavProps): React.ReactNode {
  const [open, setOpen] = useState(false);

  // Feature links are appended only when enabled in config.json.
  const items: NavItem[] = [
    { href: '/blocks', label: 'Blocks', Icon: CubeIcon },
    { href: '/transactions', label: 'Transactions', Icon: ArrowPathIcon },
    { href: '/richlist', label: 'Richlist', Icon: TrophyIcon },
    { href: '/tokens', label: 'Tokens', Icon: CubeTransparentIcon },
    { href: '/contracts', label: 'Contracts', Icon: CodeBracketIcon },
    { href: '/stats', label: 'Stats', Icon: ChartBarIcon },
    ...(dexEnabled ? [{ href: '/dex', label: 'DEX', Icon: DexIcon }] : []),
    ...(bridgeEnabled ? [{ href: '/bridge', label: 'Bridge', Icon: ArrowsRightLeftIcon }] : []),
    ...(launchpadEnabled
      ? [{ href: '/launchpad', label: 'Launchpad', Icon: RocketLaunchIcon }]
      : []),
    { href: '/api-docs', label: 'API', Icon: DocumentTextIcon },
  ];

  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <nav className="container mx-auto px-2 flex items-center justify-between h-14">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="text-xl font-bold nav-link text-gray-100 hover:text-blue-400 transition-colors flex items-center gap-2 shrink-0 min-w-0"
        >
          <Image src={`/img/${currencySymbol}.svg`} alt={currencySymbol} width={32} height={32} />
          <span className="truncate">{explorerName}</span>
        </Link>

        {/* Desktop nav: icons always, labels only on very wide screens to avoid overflow. */}
        <ul className="hidden lg:flex items-center space-x-1 2xl:space-x-3">
          {items.map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                title={it.label}
                className="nav-link text-gray-200 flex items-center gap-1"
              >
                <it.Icon className="w-5 h-5" />
                <span className="hidden 2xl:inline">{it.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation menu"
          aria-expanded={open}
          className="lg:hidden p-2 -mr-1 text-gray-200 hover:text-blue-400 transition-colors"
        >
          {open ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
        </button>
      </nav>

      {/* Mobile menu: full-width dropdown with icons and labels. */}
      {open && (
        <div className="lg:hidden border-t border-gray-800 bg-gray-900">
          <ul className="container mx-auto px-2 py-2 flex flex-col">
            {items.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className="nav-link text-gray-200 flex items-center gap-3"
                >
                  <it.Icon className="w-5 h-5 shrink-0" />
                  <span>{it.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
