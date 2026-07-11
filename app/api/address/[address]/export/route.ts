import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../models/index';
import { tryGetDb } from '../../../../../lib/db/get-db';
import { loadConfig } from '../../../../../lib/config';
import { METHOD_IDS } from '../../../../../lib/transaction-utils';
import {
  buildCsv,
  formatUnitsExact,
  formatCsvDateTime,
  computeTxFee,
} from '../../../../../lib/utils/csv';
import {
  isValidAddress,
  sanitizeAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../../lib/security';
import { logger } from '../../../../../lib/logger';

// Etherscan/BscScan-compatible CSV export of an address's transaction
// history, so accounting/tax tools that understand those exports can
// ingest data from this explorer directly.
//
//   GET /api/address/[address]/export?type=txs|tokentxs
//     &startblock=<int>&endblock=<int>   (optional block range)
//
// Row cap matches Etherscan's CSV export limit (5000, oldest first).

const MAX_ROWS = 5000;

interface TxDoc {
  hash?: string;
  blockNumber?: number;
  timestamp?: number;
  from?: string;
  to?: string;
  creates?: string;
  value?: string;
  gasUsed?: number;
  gasPrice?: string;
  status?: number;
  input?: string;
}

interface TokenTransferDoc {
  hash?: string;
  blockNumber?: number;
  timestamp?: number;
  from?: string;
  to?: string;
  contract?: string;
  value?: string;
  method?: string;
}

function methodLabel(input: string | undefined, creates: string | undefined): string {
  if (creates) return 'Contract Creation';
  if (!input || input === '0x' || input.length < 10) return 'Transfer';
  const known = METHOD_IDS[input.slice(0, 10).toLowerCase()];
  return known ? known.action : input.slice(0, 10);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const clientIp = getClientIp(request);
  // Exports scan up to MAX_ROWS documents - keep the limit strict
  const rateLimit = checkRateLimit(`export:${clientIp}`, 60, 10);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  const { address } = await params;
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }
  const addr = (sanitizeAddress(address) || '').toLowerCase();
  if (!addr) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') === 'tokentxs' ? 'tokentxs' : 'txs';
  const startBlock = parsePositiveInt(searchParams.get('startblock'));
  const endBlock = parsePositiveInt(searchParams.get('endblock'));

  try {
    await connectDB();
    const db = tryGetDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database unavailable' },
        { status: 503, headers: getSecurityHeaders() }
      );
    }

    const config = await loadConfig();
    const symbol = config.currency?.symbol || 'ETH';
    const nativeDecimals = config.currency?.decimals ?? 18;

    const blockFilter: Record<string, number> = {};
    if (startBlock !== null) blockFilter.$gte = startBlock;
    if (endBlock !== null) blockFilter.$lte = endBlock;

    const query: Record<string, unknown> = { $or: [{ from: addr }, { to: addr }] };
    if (Object.keys(blockFilter).length > 0) query.blockNumber = blockFilter;

    let csv: string;
    if (type === 'txs') {
      const docs = (await db
        .collection('Transaction')
        .find(query)
        .sort({ blockNumber: 1, transactionIndex: 1 })
        .limit(MAX_ROWS)
        .toArray()) as TxDoc[];

      const rows = docs.map((tx) => {
        const isOut = (tx.from || '').toLowerCase() === addr;
        const isIn = (tx.to || '').toLowerCase() === addr;
        const value = formatUnitsExact(tx.value, nativeDecimals);
        return [
          tx.hash || '',
          tx.blockNumber ?? '',
          tx.timestamp ?? '',
          formatCsvDateTime(tx.timestamp),
          tx.from || '',
          tx.to || '',
          tx.creates || '',
          isIn ? value : '0',
          isOut ? value : '0',
          isOut ? computeTxFee(tx.gasUsed, tx.gasPrice, nativeDecimals) : '0',
          tx.status === 0 ? 'Error' : '',
          '',
          methodLabel(tx.input, tx.creates),
        ];
      });

      csv = buildCsv(
        [
          'Txhash',
          'Blockno',
          'UnixTimestamp',
          'DateTime (UTC)',
          'From',
          'To',
          'ContractAddress',
          `Value_IN(${symbol})`,
          `Value_OUT(${symbol})`,
          `TxnFee(${symbol})`,
          'Status',
          'ErrCode',
          'Method',
        ],
        rows
      );
    } else {
      const docs = (await db
        .collection('TokenTransfer')
        .find(query)
        .sort({ blockNumber: 1 })
        .limit(MAX_ROWS)
        .toArray()) as TokenTransferDoc[];

      // Resolve token name/symbol/decimals for every contract in one query
      const contracts = [...new Set(docs.map((d) => (d.contract || '').toLowerCase()))].filter(
        Boolean
      );
      const tokenInfo = new Map<string, { name: string; symbol: string; decimals: number }>();
      if (contracts.length > 0) {
        const tokens = await db
          .collection('tokens')
          .find({ address: { $in: contracts } })
          .toArray();
        for (const t of tokens as Record<string, unknown>[]) {
          const a = ((t.address as string) || '').toLowerCase();
          if (a) {
            tokenInfo.set(a, {
              name: (t.name as string) || 'Unknown Token',
              symbol: (t.symbol as string) || '???',
              decimals: (t.decimals as number) ?? 18,
            });
          }
        }
      }

      const rows = docs.map((tr) => {
        const info = tokenInfo.get((tr.contract || '').toLowerCase());
        return [
          tr.hash || '',
          tr.blockNumber ?? '',
          tr.timestamp ?? '',
          formatCsvDateTime(tr.timestamp),
          tr.from || '',
          tr.to || '',
          formatUnitsExact(tr.value, info?.decimals ?? 18),
          tr.contract || '',
          info?.name || 'Unknown Token',
          info?.symbol || '???',
        ];
      });

      csv = buildCsv(
        [
          'Txhash',
          'Blockno',
          'UnixTimestamp',
          'DateTime (UTC)',
          'From',
          'To',
          'TokenValue',
          'ContractAddress',
          'TokenName',
          'TokenSymbol',
        ],
        rows
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="export-${type}-${addr}-${date}.csv"`,
        'Cache-Control': 'no-store',
        ...getSecurityHeaders(),
      },
    });
  } catch (error) {
    logger.error('CSV export failed', { error, address: addr, type });
    return NextResponse.json(
      { error: 'Export failed' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
