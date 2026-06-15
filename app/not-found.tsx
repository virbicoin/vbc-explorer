import type { Metadata } from 'next';
import Link from 'next/link';
import { loadConfig } from '@/lib/config';

const config = loadConfig();
const explorerName = config.explorer?.name || `${config.currency?.name || 'Blockchain'} Explorer`;

// noindex so search engines don't index "Not Found" pages.
export const metadata: Metadata = {
  title: `Page not found | ${explorerName}`,
  description: 'The page you are looking for could not be found.',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-gray-500">404</p>
      <h1 className="mt-3 text-3xl font-bold text-gray-100">Page not found</h1>
      <p className="mt-3 max-w-md text-gray-400">
        The block, transaction, address, or page you are looking for does not exist.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/"
          className="rounded-lg bg-gray-100 px-5 py-2.5 font-medium text-gray-900 hover:bg-white"
        >
          Go home
        </Link>
        <Link
          href="/search"
          className="rounded-lg border border-gray-700 px-5 py-2.5 font-medium text-gray-200 hover:bg-gray-800"
        >
          Search
        </Link>
      </div>
    </main>
  );
}
