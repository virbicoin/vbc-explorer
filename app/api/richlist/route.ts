// Richlist API for VirBiCoin Explorer
import { NextRequest, NextResponse } from 'next/server';
import { Account, Contract } from '@/lib/models';
import { connectToDatabase } from '@/lib/db';

// Cache for totalSupply
const totalSupplyCache = {
  value: -1,
  timestamp: 0
};

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    // Get totalSupply from cache or calculate
    if (new Date().getTime() - totalSupplyCache.timestamp > 30 * 60 * 1000) {
      totalSupplyCache.value = -1;
      totalSupplyCache.timestamp = 0;
    }

    let totalSupply = totalSupplyCache.value;
    if (totalSupply < 0) {
      const docs = await Account.aggregate([
        { $match: { balance: { $gt: "0" } } },
        // Group by address to remove duplicates and keep the latest balance
        {
          $group: {
            _id: "$address",
            balance: { $first: "$balance" },
            blockNumber: { $max: "$blockNumber" }
          }
        },
        { $addFields: { balanceNum: { $toDouble: "$balance" } } },
        { $group: { _id: null, totalSupply: { $sum: '$balanceNum' } } },
      ]);
      totalSupply = docs[0]?.totalSupply || 0;
      totalSupplyCache.timestamp = new Date().getTime();
      totalSupplyCache.value = totalSupply;
    }

    // Get total count of unique accounts with balance > 0 (removing duplicates)
    const totalAccountsResult = await Account.aggregate([
      { $match: { balance: { $gt: "0" } } },
      { $group: { _id: "$address" } },
      { $count: "total" }
    ]);
    const totalAccounts = totalAccountsResult[0]?.total || 0;
    
    // Get contract addresses from Contract table
    const contractAddresses = await Contract.find({}, 'address').lean();
    const contractAddressList = contractAddresses.map(c => c.address);
    
    // Total contract addresses (from Contract table)
    const contractAccounts = contractAddresses.length;
    
    const walletAccounts = totalAccounts - contractAccounts;

    // Get richlist data using aggregation with duplicate removal
    let accounts;
    if (totalAccounts === 0) {
      // If no accounts with balance > 0, get all accounts for debugging
      accounts = await Account.aggregate([
        // Group by address to remove duplicates and keep the latest record
        {
          $group: {
            _id: "$address",
            address: { $first: "$address" },
            balance: { $first: "$balance" },
            blockNumber: { $max: "$blockNumber" }, // Keep the latest blockNumber
            type: { $first: "$type" }
          }
        },
        { $addFields: { balanceNum: { $toDouble: "$balance" } } },
        { $sort: { balanceNum: -1 } },
        { $skip: offset },
        { $limit: limit }
      ]);
    } else {
      // Get accounts with balance > 0, sorted by balance descending, with duplicates removed
      accounts = await Account.aggregate([
        { $match: { balance: { $gt: "0" } } },
        // Group by address to remove duplicates and keep the latest record
        {
          $group: {
            _id: "$address",
            address: { $first: "$address" },
            balance: { $first: "$balance" },
            blockNumber: { $max: "$blockNumber" }, // Keep the latest blockNumber
            type: { $first: "$type" }
          }
        },
        { $addFields: { balanceNum: { $toDouble: "$balance" } } },
        { $sort: { balanceNum: -1 } },
        { $skip: offset },
        { $limit: limit }
      ]);
    }

    // Format data for frontend with correct ranking
    const richlist = accounts.map((account, index) => {
      const rank = offset + index + 1; // Correct ranking based on offset
      const balanceNum = account.balanceNum || (typeof account.balance === 'string' ? parseFloat(account.balance) : account.balance);
      const balanceInVBC = balanceNum / 1e18;
      const percentage = totalSupply > 0 ? (balanceNum / totalSupply) * 100 : 0;
      
      return {
        rank,
        address: account.address,
        balance: balanceNum,
        balanceFormatted: `${balanceInVBC.toLocaleString(undefined, { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        })} VBC`,
        type: contractAddressList.includes(account.address) ? 'Contract' : 'Wallet',
        percentage: percentage.toFixed(4),
        lastUpdated: account.blockNumber
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
        hasPrev: page > 1
      },
      statistics: {
        totalSupply,
        totalAccounts,
        contractAccounts,
        walletAccounts
      }
    };

    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Richlist GET error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch richlist data',
      richlist: [],
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      },
      statistics: {
        totalSupply: 0,
        totalAccounts: 0,
        contractAccounts: 0,
        walletAccounts: 0
      }
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const body = await request.json();
    
    // Check cached totalSupply
    if (new Date().getTime() - totalSupplyCache.timestamp > 30 * 60 * 1000) {
      totalSupplyCache.value = -1;
      totalSupplyCache.timestamp = 0;
    }

    // Count accounts only once
    let count = body.recordsTotal || 0;
    count = parseInt(count);
    if (count < 0) {
      count = 0;
    }

    // Get totalSupply only once
    const queryTotalSupply = totalSupplyCache.value || body.totalSupply || null;

    let totalSupply;
    if (queryTotalSupply < 0) {
      const docs = await Account.aggregate([
        { $group: { _id: null, totalSupply: { $sum: '$balance' } } },
      ]);
      totalSupply = docs[0]?.totalSupply || 0;
      // Update cache
      totalSupplyCache.timestamp = new Date().getTime();
      totalSupplyCache.value = totalSupply;
    } else {
      totalSupply = queryTotalSupply > 0 ? queryTotalSupply : null;
    }

    if (!count) {
      // Get the number of all accounts
      count = await Account.countDocuments({});
    }

    // Check sort order
    let sortOrder: Record<string, number> = { balance: -1 };
    if (body.order && body.order[0] && body.order[0].column) {
      // Balance column
      if (body.order[0].column == 3) {
        if (body.order[0].dir == 'asc') {
          sortOrder = { balance: 1 };
        }
      }
      if (body.order[0].column == 2) {
        // Sort by account type and balance
        if (body.order[0].dir == 'asc') {
          sortOrder = { type: -1, balance: -1 };
        }
      }
    }

    // Set datatable params
    const limit = parseInt(body.length);
    const start = parseInt(body.start);

    const data: Record<string, unknown> = { 
      draw: parseInt(body.draw), 
      recordsFiltered: count, 
      recordsTotal: count 
    };
    
    if (totalSupply && totalSupply > 0) {
      data.totalSupply = totalSupply;
    }

    // Use aggregation to remove duplicates and apply sorting
    const accounts = await Account.aggregate([
      // Group by address to remove duplicates and keep the latest record
      {
        $group: {
          _id: "$address",
          address: { $first: "$address" },
          balance: { $first: "$balance" },
          blockNumber: { $max: "$blockNumber" },
          type: { $first: "$type" }
        }
      },
      { $addFields: { balanceNum: { $toDouble: "$balance" } } },
      { $sort: sortOrder.balance ? { balanceNum: sortOrder.balance as 1 | -1 } : sortOrder as Record<string, 1 | -1> },
      { $skip: start },
      { $limit: limit }
    ]);
      
    data.data = accounts.map((account, i) => [
      i + 1 + start, 
      account.address, 
      account.type, 
      account.balance, 
      account.blockNumber
    ]);
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Richlist error:', error);
    return NextResponse.json({ error: true }, { status: 500 });
  }
}
