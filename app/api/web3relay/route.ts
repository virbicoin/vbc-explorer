import { NextRequest, NextResponse } from 'next/server';
import { getClient, getCode } from '@/lib/web3/provider';
import { loadConfig } from '@/lib/config';
import { Transaction, Market } from '@/lib/models';
import { connectToDatabase } from '@/lib/db';
import { toEther, toGwei } from '@/lib/etherUnits';
import { enforceRateLimit } from '@/lib/security/rate-limits';

// Function to read config

// Load config with fallback
const config = loadConfig() as { settings?: { useFiat?: boolean } };

// The shared node connection (lib/web3/provider.ts)

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, 'relay');
  if (limited) return limited;

  try {
    await connectToDatabase();

    const body = await request.json();

    if ('tx' in body) {
      const txHash = body.tx.toLowerCase();

      let txResponse: Record<string, unknown>;
      let doc;

      try {
        doc = await Transaction.findOne({ hash: txHash }).lean(true).exec();
      } catch {
        // Database error, continue to blockchain lookup
      }

      if (!doc) {
        // Try to get from blockchain
        try {
          const tx = await getClient()
            .getTransaction({ hash: txHash as `0x${string}` })
            .catch(() => null);
          if (!tx) {
            // Try as block hash
            const block = await getClient()
              .getBlock({ blockHash: txHash as `0x${string}` })
              .catch(() => null);
            if (!block) {
              return NextResponse.json({ error: true });
            } else {
              return NextResponse.json({ error: true, isBlock: true });
            }
          }

          txResponse = tx as Record<string, unknown>;
          txResponse.value = toEther(BigInt(tx.value), 'wei');

          // Get transaction receipt
          const receipt = await getClient()
            .getTransactionReceipt({ hash: txHash as `0x${string}` })
            .catch(() => null);
          if (receipt) {
            txResponse.gasUsed = receipt.gasUsed;
            if (receipt.status !== undefined) {
              txResponse.status = receipt.status === 'success' ? 1 : 0;
            }
            if (!tx.to && receipt.contractAddress) {
              txResponse.creates = receipt.contractAddress;
            }
          }

          // Get timestamp from block
          const block = tx.blockNumber
            ? await getClient()
                .getBlock({ blockNumber: tx.blockNumber })
                .catch(() => null)
            : null;
          if (block) {
            txResponse.timestamp = block.timestamp;
          }

          txResponse.isTrace = txResponse.input !== '0x';
        } catch {
          return NextResponse.json({ error: true });
        }
      } else {
        const docData = Array.isArray(doc) ? doc[0] : doc;
        txResponse = docData as Record<string, unknown>;
      }

      const latestBlock = (await getClient().getBlockNumber()) + 1n;
      txResponse.confirmations = latestBlock - BigInt(String(txResponse.blockNumber || 0));

      if (txResponse.confirmations === latestBlock) {
        txResponse.confirmation = 0;
      }

      txResponse.gasPriceGwei = toGwei(BigInt(String(txResponse.gasPrice || 0)), 'wei');
      txResponse.gasPriceEther = toEther(BigInt(String(txResponse.gasPrice || 0)), 'wei');
      txResponse.txFee = Number(txResponse.gasPriceEther) * Number(txResponse.gasUsed || 0);

      if (config.settings?.useFiat) {
        const latestPrice = await Market.findOne().sort({ timestamp: -1 });
        if (latestPrice) {
          txResponse.txFeeUSD = Number(txResponse.txFee) * Number(latestPrice.quoteUSD);
          txResponse.valueUSD = Number(txResponse.value) * Number(latestPrice.quoteUSD);
        }
      }

      return NextResponse.json(txResponse);
    } else if ('addr' in body) {
      const addr = body.addr.toLowerCase();
      const { options } = body;

      const addrData: Record<string, unknown> = {};

      if (options.indexOf('balance') > -1) {
        try {
          const balance = await getClient().getBalance({ address: addr as `0x${string}` });
          addrData.balance = toEther(balance, 'wei');
        } catch {
          return NextResponse.json({ error: true });
        }
      }

      if (options.indexOf('count') > -1) {
        try {
          addrData.count = await getClient().getTransactionCount({
            address: addr as `0x${string}`,
          });
        } catch {
          return NextResponse.json({ error: true });
        }
      }

      if (options.indexOf('bytecode') > -1) {
        try {
          const code = await getCode(addr);
          addrData.bytecode = code;
        } catch {
          return NextResponse.json({ error: true });
        }
      }

      return NextResponse.json(addrData);
    } else if ('block' in body) {
      const blockNumber = body.block;

      try {
        const block = await getClient()
          .getBlock({ blockNumber: BigInt(blockNumber), includeTransactions: true })
          .catch(() => null);
        if (!block) {
          return NextResponse.json({ error: true });
        }

        return NextResponse.json(block);
      } catch {
        return NextResponse.json({ error: true });
      }
    }

    return NextResponse.json({ error: true });
  } catch {
    return NextResponse.json({ error: true }, { status: 500 });
  }
}
