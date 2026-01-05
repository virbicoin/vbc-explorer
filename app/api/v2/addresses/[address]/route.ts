import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Account, Transaction, Contract } from '@/models/index';
import Web3 from 'web3';
import fs from 'fs';
import path from 'path';
import {
  sanitizeAddress,
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
  };
};

const config = readConfig();
const WEB3_PROVIDER_URL =
  process.env.WEB3_PROVIDER_URL || `http://${config.nodeAddr}:${config.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

// Blockscout API v2 - Get address info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`address-info:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    // Validate address
    const sanitizedAddress = sanitizeAddress(address);
    if (!sanitizedAddress) {
      return NextResponse.json(
        { message: 'Invalid address' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Get balance from blockchain
    let balance = '0';
    try {
      balance = (await web3.eth.getBalance(sanitizedAddress)).toString();
    } catch (error) {
      console.error('Error fetching balance:', error);
    }

    // Get bytecode to check if it's a contract
    let bytecode = '0x';
    try {
      bytecode = await web3.eth.getCode(sanitizedAddress);
    } catch (error) {
      console.error('Error fetching bytecode:', error);
    }

    const isContract = bytecode !== '0x' && bytecode !== '0x0';

    // Get account from database
    const account = await Account.findOne({
      address: sanitizedAddress.toLowerCase(),
    }).lean();

    // Get transaction count
    let txCount = 0;
    try {
      txCount = await Transaction.countDocuments({
        $or: [
          { from: sanitizedAddress.toLowerCase() },
          { to: sanitizedAddress.toLowerCase() },
        ],
      });
    } catch (error) {
      console.error('Error counting transactions:', error);
    }

    // Get contract info if it's a contract
    let contractInfo = null;
    if (isContract) {
      contractInfo = await Contract.findOne({
        address: sanitizedAddress.toLowerCase(),
      }).lean();
    }

    // Blockscout API v2 response format
    const response: Record<string, unknown> = {
      hash: sanitizedAddress.toLowerCase(),
      is_contract: isContract,
      is_verified: contractInfo?.verified || false,
      name: contractInfo?.contractName || null,
      
      // Balance info
      coin_balance: balance,
      exchange_rate: null,
      
      // Transaction counts
      transactions_count: txCount,
      token_transfers_count: 0,
      gas_usage_count: null,
      validations_count: null,
      
      // Contract info
      creation_tx_hash: null,
      implementation_name: null,
      implementation_address: null,
      
      // Block info
      block_number_balance_updated_at: account?.blockNumber || null,
      
      // ENS
      ens_domain_name: null,
      
      // Metadata
      has_beacon_chain_withdrawals: false,
      has_custom_methods_read: false,
      has_custom_methods_write: false,
      has_decompiled_code: false,
      has_logs: false,
      has_methods_read: isContract,
      has_methods_read_proxy: false,
      has_methods_write: isContract,
      has_methods_write_proxy: false,
      has_token_transfers: false,
      has_tokens: false,
      has_validated_blocks: false,
      
      // Watchlist
      watchlist_address_id: null,
      watchlist_names: [],
      
      // Private tags
      private_tags: [],
      public_tags: [],
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching address info:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
