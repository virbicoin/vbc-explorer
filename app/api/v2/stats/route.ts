import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block, Transaction, Account, Contract } from '@/models/index';
import Web3 from 'web3';
import fs from 'fs';
import path from 'path';
import {
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '@/lib/security';

// Function to read config
const readConfig = () => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const exampleConfigPath = path.join(process.cwd(), 'config.example.json');

    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else if (fs.existsSync(exampleConfigPath)) {
      return JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading config:', error);
  }

  return {
    nodeAddr: 'localhost',
    port: 8329,
    supply: {
      blockReward: 8,
      premineAmount: 1,
    },
  };
};

const config = readConfig();
const WEB3_PROVIDER_URL =
  process.env.WEB3_PROVIDER_URL || `http://${config.nodeAddr}:${config.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

// Blockscout API v2 - Get stats
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`stats:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Get latest block
    const latestBlock = await Block.findOne({}).sort({ number: -1 }).lean();
    const blockNumber = latestBlock?.number || 0;

    // Get total transactions
    const totalTransactions = await Transaction.countDocuments({});

    // Get total addresses
    const totalAddresses = await Account.countDocuments({});

    // Get verified contracts count
    const verifiedContracts = await Contract.countDocuments({ verified: true });

    // Calculate total supply
    const blockReward = config.supply?.blockReward || 8;
    const premineAmount = config.supply?.premineAmount || 1;
    const totalSupply = blockNumber * blockReward + premineAmount;

    // Get gas price
    let gasPrice = '1000000000'; // 1 gwei default
    try {
      gasPrice = (await web3.eth.getGasPrice()).toString();
    } catch (error) {
      console.error('Error fetching gas price:', error);
    }

    // Calculate average block time (last 100 blocks)
    let avgBlockTime = 13;
    try {
      const recentBlocks = await Block.find({})
        .sort({ number: -1 })
        .limit(100)
        .select('number timestamp')
        .lean();

      if (recentBlocks.length > 1) {
        const timeDiff =
          (recentBlocks[0].timestamp as number) -
          (recentBlocks[recentBlocks.length - 1].timestamp as number);
        avgBlockTime = timeDiff / (recentBlocks.length - 1);
      }
    } catch (error) {
      console.error('Error calculating avg block time:', error);
    }

    // Get 24h transaction count
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const tx24h = await Transaction.countDocuments({
      timestamp: { $gte: oneDayAgo },
    });

    // Blockscout API v2 response format
    const response = {
      // Network info
      network_utilization_percentage: 0,
      
      // Block info
      total_blocks: blockNumber.toString(),
      average_block_time: avgBlockTime * 1000, // in milliseconds
      
      // Transaction info
      total_transactions: totalTransactions.toString(),
      transactions_today: tx24h.toString(),
      
      // Address info
      total_addresses: totalAddresses.toString(),
      
      // Contract info
      total_verified_contracts: verifiedContracts.toString(),
      
      // Supply info
      coin_price: null,
      coin_price_change_percentage: null,
      total_supply: (BigInt(Math.floor(totalSupply)) * BigInt(10 ** 18)).toString(),
      circulating_supply: (BigInt(Math.floor(totalSupply)) * BigInt(10 ** 18)).toString(),
      market_cap: null,
      
      // Gas info
      gas_prices: {
        slow: gasPrice,
        average: gasPrice,
        fast: gasPrice,
      },
      gas_used_today: '0',
      gas_price_updated_at: new Date().toISOString(),
      
      // Static gas price
      static_gas_price: gasPrice,
      
      // Secondary coin (not applicable)
      secondary_coin_price: null,
      
      // TVL
      tvl: null,
      
      // Rootstock (not applicable)
      rootstock_locked_btc: null,
      
      // Last new contract
      last_output_root_size: null,
      
      // Celo (not applicable)
      celo: null,
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
