import { NextResponse } from 'next/server';
import { getWeb3 } from '@/lib/web3/provider';

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

export async function GET() {
  try {
    const web3 = getWeb3();

    // Get pending transactions from txpool
    // Note: This requires txpool API to be enabled on the node
    let pendingTxs: PendingTransaction[] = [];

    try {
      // Try to get pending transactions using eth_pendingTransactions (if supported)
      const pending = await web3.eth.getPendingTransactions();

      pendingTxs = pending.map((tx) => ({
        hash: (tx as { hash?: string }).hash || '',
        from: tx.from?.toString() || '',
        to: tx.to?.toString() || null,
        value: tx.value?.toString() || '0',
        gasPrice: tx.gasPrice?.toString() || '0',
        gas: tx.gas?.toString() || '0',
        nonce: Number(tx.nonce) || 0,
        input: tx.input?.toString() || '0x',
      }));
    } catch {
      // If getPendingTransactions is not supported, try txpool_content
      try {
        const txpool = await web3.eth.requestManager.send({
          method: 'txpool_content',
          params: [],
        });

        if (txpool && txpool.pending) {
          for (const address of Object.keys(txpool.pending)) {
            for (const nonce of Object.keys(txpool.pending[address])) {
              const tx = txpool.pending[address][nonce];
              pendingTxs.push({
                hash: tx.hash || '',
                from: tx.from || address,
                to: tx.to || null,
                value: tx.value || '0',
                gasPrice: tx.gasPrice || '0',
                gas: tx.gas || '0',
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
