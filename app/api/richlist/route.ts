// Richlist API
import { NextRequest, NextResponse } from 'next/server';
import { countAll } from '@/lib/db/count';
import { Account, Contract } from '@/lib/models';
import { connectToDatabase } from '@/lib/db';
import { loadConfig } from '@/lib/config';
import { calculateTotalSupply } from '@/lib/supply';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { validatePagination, DEFAULT_MAX_OFFSET } from '@/lib/security/validation';
import { rejectDeepPagination } from '@/lib/security/pagination';

/** Accounts holding coins: `balance` is a wei string, and "0" the only zero. */
const WITH_BALANCE = { balance: { $gt: '0' } };

/**
 * A page of accounts in balance order (`address` is unique, so there is nothing to merge; the
 * balance is compared as a number, not as a string).
 */
function accountPage(
  match: Record<string, unknown>,
  skip: number,
  limit: number,
  sort: Record<string, 1 | -1>
) {
  return Account.aggregate([
    { $match: match },
    { $addFields: { balanceNum: { $toDouble: '$balance' } } },
    { $sort: sort },
    { $skip: skip },
    { $limit: limit },
  ]);
}

/** Which of these addresses are contracts. */
async function contractsAmong(addresses: string[]): Promise<Set<string>> {
  const found = (await Contract.find({ address: { $in: addresses } })
    .select('address')
    .lean()) as Array<{ address: string }>;
  return new Set(found.map((contract) => contract.address));
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const pagination = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit'),
      100,
      {
        defaultLimit: 50,
      }
    );
    const tooDeep = rejectDeepPagination(pagination);
    if (tooDeep) return tooDeep;
    const { page, limit, skip: offset } = pagination;

    const [totalSupplyNative, totalAccounts, contractAccounts, accounts] = await Promise.all([
      calculateTotalSupply(),
      Account.countDocuments(WITH_BALANCE),
      countAll(Contract),
      accountPage(WITH_BALANCE, offset, limit, { balanceNum: -1 }),
    ]);
    const totalSupplyWei = totalSupplyNative * 1e18;
    const contracts = await contractsAmong(accounts.map((account) => account.address));
    const walletAccounts = Math.max(0, totalAccounts - contractAccounts);

    // Format data for frontend with correct ranking
    const config = loadConfig();
    const currencySymbol = config.currency?.symbol || 'ETH';

    const richlist = accounts.map((account, index) => {
      const rank = offset + index + 1; // Correct ranking based on offset
      const balanceNum =
        account.balanceNum ||
        (typeof account.balance === 'string' ? parseFloat(account.balance) : account.balance);
      const balanceInNative = balanceNum / 1e18;
      // Use totalSupplyWei for correct percentage calculation
      const percentage = totalSupplyWei > 0 ? (balanceNum / totalSupplyWei) * 100 : 0;

      return {
        rank,
        address: account.address,
        balance: balanceNum,
        balanceFormatted: `${balanceInNative.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ${currencySymbol}`,
        type: contracts.has(account.address) ? 'Contract' : 'Wallet',
        percentage: percentage.toFixed(4),
        lastUpdated: account.blockNumber,
      };
    });

    const totalPages = Math.ceil(totalAccounts / limit);

    const data = {
      richlist,
      pagination: {
        page,
        limit,
        total: totalAccounts,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      statistics: {
        totalSupply: totalSupplyNative, // Return native unit for display
        totalAccounts,
        contractAccounts,
        walletAccounts,
      },
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error('Richlist GET error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch richlist data',
        richlist: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
        statistics: {
          totalSupply: 0,
          totalAccounts: 0,
          contractAccounts: 0,
          walletAccounts: 0,
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    await connectToDatabase();

    const body = await request.json();

    // Count accounts only once
    let count = body.recordsTotal || 0;
    count = parseInt(count);
    if (count < 0) {
      count = 0;
    }

    // Get totalSupply from lib/supply.ts (returns native currency unit)
    // Multiply by 1e18 to convert to wei for percentage calculation
    const totalSupplyNative = await calculateTotalSupply();
    const totalSupplyWei = totalSupplyNative * 1e18;

    if (!count) {
      // Number of all accounts, from the collection metadata (lib/db/count.ts)
      count = await countAll(Account);
    }

    // DataTables columns: 2 = type (then balance), 3 = balance; largest balance first by default
    const order = body.order?.[0];
    const sort: Record<string, 1 | -1> =
      order?.column == 3 && order.dir == 'asc'
        ? { balanceNum: 1 }
        : order?.column == 2 && order.dir == 'asc'
          ? { type: -1, balanceNum: -1 }
          : { balanceNum: -1 };

    // Set datatable params (DataTables sends length/start; same caps as the GET API)
    const limit = validatePagination(undefined, body.length, 100, { defaultLimit: 50 }).limit;
    const startRaw = parseInt(body.start, 10);
    const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 0;
    if (start + limit > DEFAULT_MAX_OFFSET) {
      return NextResponse.json(
        { error: `Offset too deep: start + length must not exceed ${DEFAULT_MAX_OFFSET}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {
      draw: parseInt(body.draw),
      recordsFiltered: count,
      recordsTotal: count,
    };

    if (totalSupplyNative && totalSupplyNative > 0) {
      data.totalSupply = totalSupplyNative;
      data.totalSupplyWei = totalSupplyWei;
    }

    const accounts = await accountPage({}, start, limit, sort);

    data.data = accounts.map((account, i) => [
      i + 1 + start,
      account.address,
      account.type,
      account.balance,
      account.blockNumber,
    ]);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Richlist error:', error);
    return NextResponse.json({ error: true }, { status: 500 });
  }
}
