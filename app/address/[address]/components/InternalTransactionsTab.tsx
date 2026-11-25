'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  formatAddress,
  formatNativeValueShort,
  formatTimestamp,
  getTimeAgo,
} from '../../../../lib/address/format';

/** One row of `/api/v2/addresses/{address}/internal-transactions` (Blockscout v2 shape). */
interface InternalTransactionRow {
  transaction_hash: string;
  index: number;
  block_number: number;
  timestamp: string | null;
  from: { hash: string } | null;
  to: { hash: string } | null;
  created_contract: { hash: string } | null;
  type: string;
  value: string;
  success: boolean;
  error: string | null;
}

interface Page {
  items: InternalTransactionRow[];
  next_page_params: Record<string, unknown> | null;
}

const MOVES_VALUE = (row: InternalTransactionRow) =>
  row.value !== '0' || ['create', 'create2', 'selfdestruct'].includes(row.type);

async function fetchPage(address: string, params: Record<string, unknown> | null): Promise<Page> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) query.set(key, String(value));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`/api/v2/addresses/${address}/internal-transactions${suffix}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as Page;
}

/**
 * Internal transactions of an address (calls, creations and selfdestructs made
 * inside transactions; tools/internal-txs.ts). Value transfers, creations and
 * selfdestructs are shown unless all calls are asked for, as on Etherscan.
 */
export default function InternalTransactionsTab({
  address,
  currencySymbol,
}: {
  address: string;
  currencySymbol: string;
}) {
  const [rows, setRows] = useState<InternalTransactionRow[]>([]);
  const [next, setNext] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(address, null)
      .then((page) => {
        if (cancelled) return;
        setRows(page.items);
        setNext(page.next_page_params);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const loadMore = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const page = await fetchPage(address, next);
      setRows((previous) => [...previous, ...page.items]);
      setNext(page.next_page_params);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const shown = showAll ? rows : rows.filter(MOVES_VALUE);
  const hidden = rows.length - rows.filter(MOVES_VALUE).length;

  if (error) {
    return <p className="text-red-400 text-center py-8">Could not load internal transactions.</p>;
  }
  if (loading && rows.length === 0) {
    return <p className="text-gray-400 text-center py-8">Loading internal transactions…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-gray-400 text-center py-8">No internal transactions found.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-gray-400">
          Calls made inside transactions (contract payouts, creations, selfdestructs).
        </span>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-blue-400 hover:text-blue-300"
          >
            {showAll ? 'Show value transfers only' : `Show ${hidden} calls without value`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2 pr-4 font-medium">Parent Txn</th>
              <th className="py-2 pr-4 font-medium">Block</th>
              <th className="py-2 pr-4 font-medium">Age</th>
              <th className="py-2 pr-4 font-medium">From</th>
              <th className="py-2 pr-4 font-medium">To</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const seconds = row.timestamp ? Math.floor(Date.parse(row.timestamp) / 1000) : 0;
              const target = row.to?.hash ?? row.created_contract?.hash ?? null;
              const incoming = target?.toLowerCase() === address.toLowerCase();
              return (
                <tr
                  key={`${row.transaction_hash}:${row.index}`}
                  className={`border-b border-gray-700/50 ${row.success ? '' : 'opacity-60'}`}
                >
                  <td className="py-2 pr-4 font-mono">
                    <Link
                      href={`/tx/${row.transaction_hash}`}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      {formatAddress(row.transaction_hash)}
                    </Link>
                    {!row.success && (
                      <span
                        className="ml-2 px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 text-xs"
                        title={row.error ?? 'An enclosing call failed'}
                      >
                        Reverted
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/block/${row.block_number}`}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      {row.block_number}
                    </Link>
                  </td>
                  <td
                    className="py-2 pr-4 text-gray-300"
                    title={seconds ? formatTimestamp(seconds) : ''}
                  >
                    {seconds ? getTimeAgo(seconds) : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {row.from ? (
                      <Link
                        href={`/address/${row.from.hash}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {formatAddress(row.from.hash)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {target ? (
                      <Link
                        href={`/address/${target}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {row.created_contract ? 'Created ' : ''}
                        {formatAddress(target)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-300">{row.type}</td>
                  <td
                    className={`py-2 pr-4 text-right whitespace-nowrap ${incoming ? 'text-green-400' : 'text-gray-200'}`}
                  >
                    {formatNativeValueShort(row.value, currencySymbol)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && (
        <p className="text-gray-400 text-center py-4">
          No value transfers on this page ({hidden} calls without value).
        </p>
      )}
      {next && (
        <div className="text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
