import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { getClient } from '@/lib/web3/provider';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PendingTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gas: string;
  nonce: number;
  input: string;
}

/** A quantity as a decimal string: the node answers in hex ('0x5208'), the page reads decimal. */
function decimal(value: unknown): string {
  try {
    return BigInt(String(value ?? 0)).toString();
  } catch {
    return '0';
  }
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    // Get pending transactions from txpool
    // Note: This requires txpool API to be enabled on the node
    let pendingTxs: PendingTransaction[] = [];

    try {
      // Try to get pending transactions using eth_pendingTransactions (if supported)
      const pending = (await getClient().request({
        method: 'eth_pendingTransactions',
      } as never)) as Array<Record<string, unknown>>;

      pendingTxs = pending.map((tx) => ({
        hash: (tx as { hash?: string }).hash || '',
        from: tx.from?.toString() || '',
        to: tx.to?.toString() || null,
        value: decimal(tx.value),
        gasPrice: decimal(tx.gasPrice),
        gas: decimal(tx.gas),
        nonce: Number(tx.nonce) || 0,
        input: tx.input?.toString() || '0x',
      }));
    } catch {
      // If getPendingTransactions is not supported, try txpool_content
      try {
        const txpool = (await getClient().request({
          method: 'txpool_content',
          params: [],
        } as never)) as {
          pending?: Record<string, Record<string, Record<string, string | undefined>>>;
        };

        if (txpool && txpool.pending) {
          for (const address of Object.keys(txpool.pending)) {
            for (const nonce of Object.keys(txpool.pending[address])) {
              const tx = txpool.pending[address][nonce];
              pendingTxs.push({
                hash: tx.hash || '',
                from: tx.from || address,
                to: tx.to || null,
                value: decimal(tx.value),
                gasPrice: decimal(tx.gasPrice),
                gas: decimal(tx.gas),
                nonce: parseInt(nonce),
                input: tx.input || '0x',
              });
            }
          }
        }
      } catch {
        // txpool API not available, return empty array
        console.log('txpool API not available');
      }
    }

    // Sort by gas price (highest first)
    pendingTxs.sort((a, b) => {
      const gasPriceA = BigInt(a.gasPrice || '0');
      const gasPriceB = BigInt(b.gasPrice || '0');
      return gasPriceB > gasPriceA ? 1 : gasPriceB < gasPriceA ? -1 : 0;
    });

    return NextResponse.json(
      {
        transactions: pendingTxs,
        count: pendingTxs.length,
        timestamp: Date.now(),
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching pending transactions:', error);
    return NextResponse.json(
      {
        transactions: [],
        count: 0,
        error: 'Failed to fetch pending transactions',
      },
      { status: 500 }
    );
  }
}
