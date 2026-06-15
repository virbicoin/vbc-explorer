import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Header from './components/Header';
import Footer from './components/Footer';
import { JsonLd } from './components/JsonLd';
import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { loadConfig } from '@/lib/config';
import { siteMetadataBase, buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/seo';

const inter = Inter({ subsets: ['latin'] });

// Load config for metadata generation
const config = loadConfig();
const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;
const networkName = config.network?.name || config.currency?.name || 'Blockchain';

const siteDescription = `Explore the ${networkName} blockchain with real-time transaction data, block information, address tracking, and comprehensive token analytics. A modern, user-friendly blockchain explorer.`;

export const metadata: Metadata = {
  metadataBase: siteMetadataBase(),
  title: explorerName,
  description: siteDescription,
  openGraph: {
    title: explorerName,
    description: siteDescription,
    siteName: explorerName,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: explorerName,
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-900 text-gray-200 min-h-screen flex flex-col`}>
        <JsonLd data={buildWebSiteJsonLd()} />
        <JsonLd data={buildOrganizationJsonLd()} />
        <div className="flex-grow">
          <Header />
          {children}
          <Footer />
        </div>
      </body>
    </html>
  );
}
