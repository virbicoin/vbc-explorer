/**
 * Blockscout-compatible API Endpoint
 *
 * This API follows the Blockscout/Etherscan API standard format.
 * All responses are in JSON format with status, message, and result fields.
 *
 * Usage: /api?module=<module>&action=<action>&...params
 *
 * Supported modules:
 * - account: balance, balancemulti, txlist, tokentx, tokenbalance, getminedblocks, txlistinternal
 * - block: getblockreward, getblocknobytime, eth_block_number
 * - transaction: gettxinfo, gettxreceiptstatus, getstatus
 * - token: getToken, getTokenHolders, tokeninfo, tokenlist
 * - stats: ethsupply, tokensupply, ethprice, chainsize, dailytx
 * - contract: getabi, getsourcecode, getcontractcreation
 * - logs: getLogs
 * - proxy: eth_blockNumber, eth_getBlockByNumber, eth_getTransactionByHash,
 *          eth_getTransactionReceipt, eth_call, eth_getCode, eth_gasPrice, eth_estimateGas
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createPublicClient, http, formatEther, formatUnits, type Address } from 'viem';
import mongoose from 'mongoose';
import {
  connectDB,
  Block,
  Transaction,
  TokenTransfer,
  Account,
  Contract,
  VerificationJob,
} from '@/models/index';
import { loadConfig } from '@/lib/config';
import {
  isValidAddress,
  isValidHash,
  validatePagination,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '@/lib/security';
import { randomUUID } from 'crypto';
import solc from 'solc';

// Type for config with supply
interface ConfigWithSupply {
  network?: { rpcUrl?: string };
  web3Provider?: { url?: string };
  supply?: {
    blockReward?: number;
    premineAmount?: number;
    excludedAddresses?: Array<{ address: string; label: string }>;
    cacheDuration?: number;
  };
  [key: string]: unknown;
}

const configJson = loadConfig() as ConfigWithSupply;

// Define Token schema inline since it's not exported from models/index
const tokenSchema = new mongoose.Schema(
  {
    address: String,
    name: String,
    symbol: String,
    decimals: { type: Number, default: 18 },
    totalSupply: String,
    holders: { type: Number, default: 0 },
    type: String,
    supply: String,
    verified: { type: Boolean, default: false },
    logoUrl: { type: String, default: null },
  },
  { collection: 'tokens' }
);

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// RPC Client
const RPC_URL =
  configJson.network?.rpcUrl || configJson.web3Provider?.url || 'http://localhost:8329';
const publicClient = createPublicClient({
  transport: http(RPC_URL, { timeout: 30000 }),
});

// Response helpers
function successResponse(result: unknown, message = 'OK') {
  return NextResponse.json(
    {
      status: '1',
      message,
      result,
    },
    { headers: getSecurityHeaders() }
  );
}

function errorResponse(message: string, result: unknown = null) {
  return NextResponse.json(
    {
      status: '0',
      message,
      result,
    },
    { headers: getSecurityHeaders() }
  );
}

// ============================================
// Account Module
// ============================================

async function getBalance(address: string) {
  try {
    const balance = await publicClient.getBalance({ address: address as Address });
    return successResponse(balance.toString());
  } catch (error) {
    return errorResponse('Error fetching balance');
  }
}

async function getBalanceMulti(addresses: string) {
  try {
    const addressList = addresses.split(',').slice(0, 20); // Max 20 addresses
    const balances = await Promise.all(
      addressList.map(async (addr) => {
        const balance = await publicClient.getBalance({ address: addr.trim() as Address });
        return {
          account: addr.trim(),
          balance: balance.toString(),
        };
      })
    );
    return successResponse(balances);
  } catch (error) {
    return errorResponse('Error fetching balances');
  }
}

async function getTxList(address: string, page = 1, offset = 10, sort = 'desc') {
  try {
    await connectDB();
    const skip = (page - 1) * offset;
    const sortOrder = sort === 'asc' ? 1 : -1;

    const txs = await Transaction.find({
      $or: [
        { from: { $regex: new RegExp(`^${address}$`, 'i') } },
        { to: { $regex: new RegExp(`^${address}$`, 'i') } },
      ],
    })
      .sort({ blockNumber: sortOrder })
      .skip(skip)
      .limit(offset)
      .lean();

    const result = txs.map((tx: Record<string, unknown>) => ({
      blockNumber: String(tx.blockNumber),
      timeStamp: String(tx.timestamp || ''),
      hash: tx.hash,
      nonce: String(tx.nonce || '0'),
      blockHash: tx.blockHash || '',
      transactionIndex: String(tx.transactionIndex || '0'),
      from: tx.from,
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      gas: String(tx.gas || '21000'),
      gasPrice: tx.gasPrice?.toString() || '0',
      isError: tx.status === false ? '1' : '0',
      txreceipt_status: tx.status === false ? '0' : '1',
      input: tx.input || '0x',
      contractAddress: tx.contractAddress || '',
      cumulativeGasUsed: String(tx.cumulativeGasUsed || '0'),
      gasUsed: String(tx.gasUsed || '21000'),
      confirmations: '',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transactions');
  }
}

async function getTokenTx(address: string, contractaddress?: string, page = 1, offset = 10) {
  try {
    await connectDB();
    const skip = (page - 1) * offset;

    // Build query
    interface TokenTxQuery {
      $or: Array<{ from: { $regex: RegExp } } | { to: { $regex: RegExp } }>;
      contractAddress?: { $regex: RegExp };
    }

    const query: TokenTxQuery = {
      $or: [
        { from: { $regex: new RegExp(`^${address}$`, 'i') } },
        { to: { $regex: new RegExp(`^${address}$`, 'i') } },
      ],
    };

    if (contractaddress) {
      query.contractAddress = { $regex: new RegExp(`^${contractaddress}$`, 'i') };
    }

    // Get token transfers from TokenTransfer collection or Transaction with token data
    const txs = await Transaction.find({
      ...query,
      input: { $ne: '0x' }, // Has input data (potential token transfer)
    })
      .sort({ blockNumber: -1 })
      .skip(skip)
      .limit(offset)
      .lean();

    const result = txs.map((tx: Record<string, unknown>) => ({
      blockNumber: String(tx.blockNumber),
      timeStamp: String(tx.timestamp || ''),
      hash: tx.hash,
      nonce: String(tx.nonce || '0'),
      blockHash: tx.blockHash || '',
      from: tx.from,
      contractAddress: tx.to || '',
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      tokenName: '',
      tokenSymbol: '',
      tokenDecimal: '18',
      transactionIndex: String(tx.transactionIndex || '0'),
      gas: String(tx.gas || '21000'),
      gasPrice: tx.gasPrice?.toString() || '0',
      gasUsed: String(tx.gasUsed || '21000'),
      cumulativeGasUsed: String(tx.cumulativeGasUsed || '0'),
      input: tx.input || '0x',
      confirmations: '',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token transactions');
  }
}

// Get specific token balance for an address
async function getTokenBalance(address: string, contractaddress: string) {
  try {
    // ERC20 balanceOf ABI
    const balanceOfAbi = [
      {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ] as const;

    const balance = await publicClient.readContract({
      address: contractaddress as Address,
      abi: balanceOfAbi,
      functionName: 'balanceOf',
      args: [address as Address],
    });

    return successResponse(balance.toString());
  } catch (error) {
    return errorResponse('Error fetching token balance');
  }
}

// Get blocks mined by address
async function getMinedBlocks(address: string, page = 1, offset = 10) {
  try {
    await connectDB();
    const skip = (page - 1) * offset;

    const blocks = await Block.find({
      miner: { $regex: new RegExp(`^${address}$`, 'i') },
    })
      .sort({ number: -1 })
      .skip(skip)
      .limit(offset)
      .lean();

    const blockReward = configJson.supply?.blockReward || 8;
    const result = blocks.map((block: Record<string, unknown>) => ({
      blockNumber: String(block.number),
      timeStamp: String(block.timestamp || ''),
      blockReward: (BigInt(blockReward) * BigInt(10 ** 18)).toString(),
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching mined blocks');
  }
}

// Get internal transactions (contract calls)
async function getTxListInternal(address?: string, txhash?: string, page = 1, offset = 10) {
  try {
    await connectDB();
    const skip = (page - 1) * offset;

    interface InternalTxQuery {
      input?: { $ne: string };
      creates?: { $exists: boolean; $ne: null };
      $or?: Array<{ from: { $regex: RegExp } } | { to: { $regex: RegExp } }>;
      hash?: { $regex: RegExp };
    }

    const query: InternalTxQuery = {};

    if (txhash) {
      query.hash = { $regex: new RegExp(`^${txhash}$`, 'i') };
    } else if (address) {
      query.$or = [
        { from: { $regex: new RegExp(`^${address}$`, 'i') } },
        { to: { $regex: new RegExp(`^${address}$`, 'i') } },
      ];
      query.input = { $ne: '0x' };
    }

    const txs = await Transaction.find(query)
      .sort({ blockNumber: -1 })
      .skip(skip)
      .limit(offset)
      .lean();

    const result = txs.map((tx: Record<string, unknown>) => ({
      blockNumber: String(tx.blockNumber),
      timeStamp: String(tx.timestamp || ''),
      hash: tx.hash,
      from: tx.from,
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      contractAddress: tx.creates || tx.contractAddress || '',
      input: tx.input || '0x',
      type: 'call',
      gas: String(tx.gas || '21000'),
      gasUsed: String(tx.gasUsed || '21000'),
      traceId: '0',
      isError: tx.status === false ? '1' : '0',
      errCode: '',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching internal transactions');
  }
}

// ============================================
// Block Module
// ============================================

async function getBlockReward(blockno: string) {
  try {
    await connectDB();
    const block = await Block.findOne({ number: parseInt(blockno) }).lean();

    if (!block) {
      return errorResponse('Block not found');
    }

    const blockReward = configJson.supply?.blockReward || 8;
    const result = {
      blockNumber: String(block.number),
      timeStamp: String(block.timestamp || ''),
      blockMiner: block.miner,
      blockReward: (BigInt(blockReward) * BigInt(10 ** 18)).toString(),
      uncles: [],
      uncleInclusionReward: '0',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching block reward');
  }
}

async function getBlockNoByTime(timestamp: string, closest: string = 'before') {
  try {
    await connectDB();
    const ts = parseInt(timestamp);
    const sortOrder = closest === 'after' ? 1 : -1;
    const comparison = closest === 'after' ? { $gte: ts } : { $lte: ts };

    const block = await Block.findOne({ timestamp: comparison })
      .sort({ timestamp: sortOrder })
      .lean();

    if (!block) {
      return errorResponse('Block not found');
    }

    return successResponse(String(block.number));
  } catch (error) {
    return errorResponse('Error fetching block');
  }
}

// ============================================
// Transaction Module
// ============================================

async function getTxInfo(txhash: string) {
  try {
    await connectDB();
    const tx = (await Transaction.findOne({
      hash: { $regex: new RegExp(`^${txhash}$`, 'i') },
    }).lean()) as Record<string, unknown> | null;

    if (!tx) {
      return errorResponse('Transaction not found');
    }

    const result = {
      blockNumber: String(tx.blockNumber),
      timeStamp: String(tx.timestamp || ''),
      hash: tx.hash,
      nonce: String(tx.nonce || '0'),
      blockHash: tx.blockHash || '',
      transactionIndex: String(tx.transactionIndex || '0'),
      from: tx.from,
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      gas: String(tx.gas || '21000'),
      gasPrice: tx.gasPrice?.toString() || '0',
      isError: tx.status === false ? '1' : '0',
      txreceipt_status: tx.status === false ? '0' : '1',
      input: tx.input || '0x',
      contractAddress: tx.contractAddress || '',
      cumulativeGasUsed: String(tx.cumulativeGasUsed || '0'),
      gasUsed: String(tx.gasUsed || '21000'),
      confirmations: '',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transaction');
  }
}

async function getTxReceiptStatus(txhash: string) {
  try {
    await connectDB();
    const tx = (await Transaction.findOne({
      hash: { $regex: new RegExp(`^${txhash}$`, 'i') },
    }).lean()) as Record<string, unknown> | null;

    if (!tx) {
      return errorResponse('Transaction not found');
    }

    return successResponse({
      status: tx.status === false ? '0' : '1',
    });
  } catch (error) {
    return errorResponse('Error fetching transaction status');
  }
}

// ============================================
// Token Module
// ============================================

async function getTokenInfo(contractaddress: string) {
  try {
    await connectDB();
    const token = (await Token.findOne({
      address: { $regex: new RegExp(`^${contractaddress}$`, 'i') },
    }).lean()) as Record<string, unknown> | null;

    if (!token) {
      return errorResponse('Token not found');
    }

    const result = {
      contractAddress: token.address,
      name: token.name || '',
      symbol: token.symbol || '',
      decimals: String(token.decimals || 18),
      totalSupply: token.totalSupply?.toString() || '0',
      type: token.type || 'ERC-20',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token info');
  }
}

async function getTokenHolders(contractaddress: string, page = 1, offset = 10) {
  try {
    await connectDB();
    const token = (await Token.findOne({
      address: { $regex: new RegExp(`^${contractaddress}$`, 'i') },
    }).lean()) as Record<string, unknown> | null;

    if (!token) {
      return errorResponse('Token not found');
    }

    // Get holders from Account collection
    const skip = (page - 1) * offset;
    const holders = await Account.find({
      [`tokenBalances.${contractaddress.toLowerCase()}`]: { $exists: true, $gt: '0' },
    })
      .sort({ [`tokenBalances.${contractaddress.toLowerCase()}`]: -1 })
      .skip(skip)
      .limit(offset)
      .lean();

    const result = holders.map((holder: Record<string, unknown>) => ({
      address: holder.address,
      balance:
        (holder.tokenBalances as Record<string, string>)?.[contractaddress.toLowerCase()] || '0',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token holders');
  }
}

// ============================================
// Stats Module
// ============================================

async function getEthSupply() {
  try {
    const blockNumber = await publicClient.getBlockNumber();
    const blockReward = configJson.supply?.blockReward || 8;
    const premineAmount = configJson.supply?.premineAmount || 1;
    const totalSupply = Number(blockNumber) * blockReward + premineAmount;
    // Return in wei
    return successResponse((BigInt(Math.floor(totalSupply)) * BigInt(10 ** 18)).toString());
  } catch (error) {
    return errorResponse('Error fetching supply');
  }
}

async function getTokenSupply(contractaddress: string) {
  try {
    await connectDB();
    const token = (await Token.findOne({
      address: { $regex: new RegExp(`^${contractaddress}$`, 'i') },
    }).lean()) as Record<string, unknown> | null;

    if (!token) {
      return errorResponse('Token not found');
    }

    return successResponse(token.totalSupply?.toString() || '0');
  } catch (error) {
    return errorResponse('Error fetching token supply');
  }
}

async function getEthPrice() {
  // VBC doesn't have external price feed, return placeholder
  return successResponse({
    ethbtc: '0',
    ethbtc_timestamp: String(Math.floor(Date.now() / 1000)),
    ethusd: '0',
    ethusd_timestamp: String(Math.floor(Date.now() / 1000)),
  });
}

// Get chain size (database size approximation)
async function getChainSize() {
  try {
    await connectDB();
    const blockCount = await Block.countDocuments();
    const txCount = await Transaction.countDocuments();

    // Estimate size: ~500 bytes per block, ~300 bytes per tx
    const estimatedSize = blockCount * 500 + txCount * 300;

    return successResponse({
      blockCount: String(blockCount),
      transactionCount: String(txCount),
      chainSizeBytes: String(estimatedSize),
      chainSizeMB: String((estimatedSize / (1024 * 1024)).toFixed(2)),
    });
  } catch (error) {
    return errorResponse('Error fetching chain size');
  }
}

// Get daily transaction count
async function getDailyTx(startdate?: string, enddate?: string, sort = 'asc') {
  try {
    await connectDB();

    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const start = startdate ? new Date(startdate) : defaultStart;
    const end = enddate ? new Date(enddate) : now;

    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(end.getTime() / 1000);

    // Aggregate transactions by day
    const sortValue: 1 | -1 = sort === 'asc' ? 1 : -1;
    const pipeline = [
      {
        $match: {
          timestamp: { $gte: startTs, $lte: endTs },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $toDate: { $multiply: ['$timestamp', 1000] } },
            },
          },
          transactionCount: { $sum: 1 },
        },
      },
      {
        $sort: { _id: sortValue } as Record<string, 1 | -1>,
      },
    ];

    const results = await Transaction.aggregate(pipeline);

    const result = results.map((day: { _id: string; transactionCount: number }) => ({
      UTCDate: day._id,
      unixTimeStamp: String(Math.floor(new Date(day._id).getTime() / 1000)),
      transactionCount: day.transactionCount,
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching daily transactions');
  }
}

// Get all tokens list
async function getTokenList(page = 1, offset = 100) {
  try {
    await connectDB();
    const skip = (page - 1) * offset;

    const tokens = await Token.find({}).sort({ holders: -1 }).skip(skip).limit(offset).lean();

    const result = tokens.map((token: Record<string, unknown>) => ({
      contractAddress: token.address,
      name: token.name || '',
      symbol: token.symbol || '',
      decimals: String(token.decimals || 18),
      totalSupply: token.totalSupply?.toString() || '0',
      type: token.type || 'ERC-20',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token list');
  }
}

// ============================================
// Contract Module (Extended)
// ============================================

// Get contract creation info
async function getContractCreation(addresses: string) {
  try {
    await connectDB();
    const addressList = addresses.split(',').slice(0, 5); // Max 5 addresses

    const results = await Promise.all(
      addressList.map(async (addr) => {
        const tx = (await Transaction.findOne({
          creates: { $regex: new RegExp(`^${addr.trim()}$`, 'i') },
        }).lean()) as Record<string, unknown> | null;

        if (tx) {
          return {
            contractAddress: addr.trim(),
            contractCreator: tx.from,
            txHash: tx.hash,
          };
        }
        return null;
      })
    );

    const filteredResults = results.filter((r) => r !== null);
    return successResponse(filteredResults);
  } catch (error) {
    return errorResponse('Error fetching contract creation info');
  }
}

// ============================================
// Logs Module
// ============================================

async function getLogs(
  address?: string,
  fromBlock?: string,
  toBlock?: string,
  topic0?: string,
  topic1?: string,
  topic2?: string,
  topic3?: string,
  page = 1,
  offset = 1000
) {
  try {
    // Build filter for RPC call
    interface LogFilter {
      address?: Address;
      fromBlock?: bigint | 'earliest';
      toBlock?: bigint | 'latest';
      topics?: (string | null)[];
    }

    const filter: LogFilter = {};

    if (address) {
      filter.address = address as Address;
    }

    filter.fromBlock =
      fromBlock === 'latest' ? undefined : fromBlock ? BigInt(fromBlock) : 'earliest';
    filter.toBlock = toBlock === 'latest' ? undefined : toBlock ? BigInt(toBlock) : 'latest';

    // Build topics array
    const topics: (string | null)[] = [];
    if (topic0) topics.push(topic0);
    else if (topic1 || topic2 || topic3) topics.push(null);
    if (topic1) topics.push(topic1);
    else if (topic2 || topic3) topics.push(null);
    if (topic2) topics.push(topic2);
    else if (topic3) topics.push(null);
    if (topic3) topics.push(topic3);

    if (topics.length > 0) {
      filter.topics = topics;
    }

    const logs = await publicClient.getLogs({
      address: filter.address,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
    });

    // Paginate results
    const start = (page - 1) * offset;
    const paginatedLogs = logs.slice(start, start + offset);

    const result = paginatedLogs.map((log) => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
      blockNumber: log.blockNumber ? `0x${log.blockNumber.toString(16)}` : '0x0',
      blockHash: log.blockHash || '',
      timeStamp: '',
      gasPrice: '',
      gasUsed: '',
      logIndex: log.logIndex !== undefined ? `0x${log.logIndex.toString(16)}` : '0x0',
      transactionHash: log.transactionHash || '',
      transactionIndex:
        log.transactionIndex !== undefined ? `0x${log.transactionIndex.toString(16)}` : '0x0',
    }));

    return successResponse(result);
  } catch (error) {
    console.error('[getLogs] Error:', error);
    return errorResponse('Error fetching logs');
  }
}

// ============================================
// Proxy Module (JSON-RPC Proxy)
// ============================================

async function proxyEthBlockNumber() {
  try {
    const blockNumber = await publicClient.getBlockNumber();
    return successResponse(`0x${blockNumber.toString(16)}`);
  } catch (error) {
    return errorResponse('Error fetching block number');
  }
}

async function proxyEthGetBlockByNumber(tag: string, full = false) {
  try {
    let block;

    if (
      tag === 'latest' ||
      tag === 'pending' ||
      tag === 'earliest' ||
      tag === 'safe' ||
      tag === 'finalized'
    ) {
      block = await publicClient.getBlock({
        blockTag: tag,
        includeTransactions: full,
      });
    } else {
      block = await publicClient.getBlock({
        blockNumber: BigInt(tag),
        includeTransactions: full,
      });
    }

    if (!block) {
      return errorResponse('Block not found');
    }

    // Format block for Etherscan-style response
    const result = {
      baseFeePerGas: block.baseFeePerGas ? `0x${block.baseFeePerGas.toString(16)}` : '0x0',
      difficulty: `0x${(block.difficulty || 0n).toString(16)}`,
      extraData: block.extraData || '0x',
      gasLimit: `0x${block.gasLimit.toString(16)}`,
      gasUsed: `0x${block.gasUsed.toString(16)}`,
      hash: block.hash,
      logsBloom: block.logsBloom || '0x',
      miner: block.miner,
      mixHash: block.mixHash || '0x',
      nonce: block.nonce || '0x0',
      number: `0x${block.number!.toString(16)}`,
      parentHash: block.parentHash,
      receiptsRoot: block.receiptsRoot,
      sha3Uncles: block.sha3Uncles,
      size: `0x${block.size.toString(16)}`,
      stateRoot: block.stateRoot,
      timestamp: `0x${block.timestamp.toString(16)}`,
      totalDifficulty: block.totalDifficulty ? `0x${block.totalDifficulty.toString(16)}` : '0x0',
      transactions: full ? block.transactions : block.transactions,
      transactionsRoot: block.transactionsRoot,
      uncles: block.uncles || [],
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching block');
  }
}

async function proxyEthGetTransactionByHash(txhash: string) {
  try {
    const tx = await publicClient.getTransaction({
      hash: txhash as `0x${string}`,
    });

    if (!tx) {
      return errorResponse('Transaction not found');
    }

    const result = {
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber ? `0x${tx.blockNumber.toString(16)}` : null,
      from: tx.from,
      gas: `0x${tx.gas.toString(16)}`,
      gasPrice: tx.gasPrice ? `0x${tx.gasPrice.toString(16)}` : '0x0',
      hash: tx.hash,
      input: tx.input,
      nonce: `0x${tx.nonce.toString(16)}`,
      to: tx.to,
      transactionIndex:
        tx.transactionIndex !== null ? `0x${tx.transactionIndex.toString(16)}` : null,
      value: `0x${tx.value.toString(16)}`,
      v: tx.v ? `0x${tx.v.toString(16)}` : '0x0',
      r: tx.r || '0x0',
      s: tx.s || '0x0',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transaction');
  }
}

async function proxyEthGetTransactionReceipt(txhash: string) {
  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: txhash as `0x${string}`,
    });

    if (!receipt) {
      return errorResponse('Transaction receipt not found');
    }

    const result = {
      blockHash: receipt.blockHash,
      blockNumber: `0x${receipt.blockNumber.toString(16)}`,
      contractAddress: receipt.contractAddress,
      cumulativeGasUsed: `0x${receipt.cumulativeGasUsed.toString(16)}`,
      effectiveGasPrice: receipt.effectiveGasPrice
        ? `0x${receipt.effectiveGasPrice.toString(16)}`
        : '0x0',
      from: receipt.from,
      gasUsed: `0x${receipt.gasUsed.toString(16)}`,
      logs: receipt.logs.map((log) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: `0x${log.blockNumber!.toString(16)}`,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        transactionIndex: `0x${log.transactionIndex!.toString(16)}`,
        logIndex: `0x${log.logIndex!.toString(16)}`,
        removed: log.removed || false,
      })),
      logsBloom: receipt.logsBloom,
      status: receipt.status === 'success' ? '0x1' : '0x0',
      to: receipt.to,
      transactionHash: receipt.transactionHash,
      transactionIndex: `0x${receipt.transactionIndex.toString(16)}`,
      type: receipt.type ? `0x${parseInt(receipt.type).toString(16)}` : '0x0',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transaction receipt');
  }
}

async function proxyEthCall(to: string, data: string, tag = 'latest') {
  try {
    const result = await publicClient.call({
      to: to as Address,
      data: data as `0x${string}`,
    });

    return successResponse(result.data || '0x');
  } catch (error) {
    return errorResponse('Error executing eth_call');
  }
}

async function proxyEthGetCode(address: string, tag = 'latest') {
  try {
    const code = await publicClient.getCode({
      address: address as Address,
    });

    return successResponse(code || '0x');
  } catch (error) {
    return errorResponse('Error fetching code');
  }
}

async function proxyEthGasPrice() {
  try {
    const gasPrice = await publicClient.getGasPrice();
    return successResponse(`0x${gasPrice.toString(16)}`);
  } catch (error) {
    return errorResponse('Error fetching gas price');
  }
}

async function proxyEthEstimateGas(to: string, data?: string, value?: string, from?: string) {
  try {
    const gas = await publicClient.estimateGas({
      to: to as Address,
      data: data as `0x${string}` | undefined,
      value: value ? BigInt(value) : undefined,
      account: from as Address | undefined,
    });

    return successResponse(`0x${gas.toString(16)}`);
  } catch (error) {
    return errorResponse('Error estimating gas');
  }
}

// ============================================
// Contract Verification Module (Etherscan/Hardhat Compatible)
// ============================================

// Get the installed solc version
const installedSolcVersion = (solc as unknown as { version: () => string }).version?.() || '0.8.30';

// Helper function to normalize compiler version
function normalizeCompilerVersion(version: string): string {
  // Remove 'v' prefix if present
  let normalized = version.startsWith('v') ? version.substring(1) : version;
  // Remove commit hash if present (e.g., "0.8.20+commit.a1b79de6" -> "0.8.20")
  normalized = normalized.split('+')[0];
  return normalized;
}

// Helper function to check if version is compatible with installed solc
function isVersionCompatible(requestedVersion: string): boolean {
  const requested = normalizeCompilerVersion(requestedVersion).split('.').slice(0, 2).join('.');
  const installed = installedSolcVersion.split('+')[0].split('.').slice(0, 2).join('.');
  return requested === installed;
}

// Helper function to modernize old Solidity syntax
function modernizeSyntax(sourceCode: string): string {
  let modernized = sourceCode;

  // Strip NatSpec comments to avoid DocstringParsingError
  modernized = modernized.replace(/\/\*\*[\s\S]*?\*\//g, '');

  // Replace var with appropriate types where possible
  modernized = modernized.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, 'uint256 $1 =');

  // Replace suicide with selfdestruct
  modernized = modernized.replace(/suicide\(/g, 'selfdestruct(');

  // Replace throw with revert
  modernized = modernized.replace(/\bthrow\b/g, 'revert()');

  // Convert strict pragma to flexible pragma for 0.8.x versions
  modernized = modernized.replace(/pragma\s+solidity\s+(\d+\.\d+\.\d+)\s*;/g, (match, version) => {
    const parts = version.split('.');
    if (parts[0] === '0' && parts[1] === '8') {
      return 'pragma solidity ^0.8.0;';
    }
    return match;
  });

  modernized = modernized.replace(
    /pragma\s+solidity\s+=\s*(\d+\.\d+\.\d+)\s*;/g,
    (match, version) => {
      const parts = version.split('.');
      if (parts[0] === '0' && parts[1] === '8') {
        return 'pragma solidity ^0.8.0;';
      }
      return match;
    }
  );

  return modernized;
}

// Cache for loaded solc compilers
const solcCache: Map<string, unknown> = new Map();

// Supported compiler versions
const SUPPORTED_COMPILER_VERSIONS = [
  '0.8.33',
  '0.8.32',
  '0.8.31',
  '0.8.30',
  '0.8.29',
  '0.8.28',
  '0.8.27',
  '0.8.26',
  '0.8.25',
  '0.8.24',
  '0.8.23',
  '0.8.22',
  '0.8.21',
  '0.8.20',
  '0.8.19',
  '0.6.12', // Legacy support
];

// Solc version to full release name mapping
// These are the exact release names from https://binaries.soliditylang.org/bin/list.json
const SOLC_RELEASES: Record<string, string> = {
  '0.8.33': 'v0.8.33+commit.e14f2714',
  '0.8.32': 'v0.8.32+commit.3b2e1c26',
  '0.8.31': 'v0.8.31+commit.46dfe0ff',
  '0.8.30': 'v0.8.30+commit.73712a01',
  '0.8.29': 'v0.8.29+commit.ab55807c',
  '0.8.28': 'v0.8.28+commit.7893614a',
  '0.8.27': 'v0.8.27+commit.40a35a09',
  '0.8.26': 'v0.8.26+commit.8a97fa7a',
  '0.8.25': 'v0.8.25+commit.b61c2a91',
  '0.8.24': 'v0.8.24+commit.e11b9ed9',
  '0.8.23': 'v0.8.23+commit.f704f362',
  '0.8.22': 'v0.8.22+commit.4fc1097e',
  '0.8.21': 'v0.8.21+commit.d9974bed',
  '0.8.20': 'v0.8.20+commit.a1b79de6',
  '0.8.19': 'v0.8.19+commit.7dd6d404',
  '0.8.18': 'v0.8.18+commit.87f61d96',
  '0.8.17': 'v0.8.17+commit.8df45f5f',
  '0.8.16': 'v0.8.16+commit.07a7930e',
  '0.8.15': 'v0.8.15+commit.e14f2714',
  '0.6.12': 'v0.6.12+commit.27d51765',
};

// Load a specific version of solc compiler
async function loadSolcVersion(version: string): Promise<unknown> {
  const normalizedVersion = normalizeCompilerVersion(version);

  // Check cache first
  if (solcCache.has(normalizedVersion)) {
    console.log(`📦 Using cached solc ${normalizedVersion}`);
    return solcCache.get(normalizedVersion);
  }

  // Get the full release name for this version
  const fullReleaseName = SOLC_RELEASES[normalizedVersion];

  if (!fullReleaseName) {
    console.warn(
      `⚠️ No release mapping for solc ${normalizedVersion}, falling back to installed solc`
    );
    return solc;
  }

  return new Promise((resolve) => {
    console.log(`📥 Loading solc ${normalizedVersion} (${fullReleaseName}) from remote...`);

    // Use solc.loadRemoteVersion to load the specific version
    // The version string must be the full release name like "v0.8.30+commit.73712a01"
    (
      solc as unknown as {
        loadRemoteVersion: (
          version: string,
          callback: (err: Error | null, solcSnapshot: unknown) => void
        ) => void;
      }
    ).loadRemoteVersion(fullReleaseName, (err: Error | null, solcSnapshot: unknown) => {
      if (err) {
        console.error(`❌ Failed to load solc ${normalizedVersion}:`, err.message);
        // Fall back to installed solc
        console.log(`⚠️ Falling back to installed solc`);
        resolve(solc);
      } else {
        console.log(`✅ Successfully loaded solc ${normalizedVersion}`);
        // Cache the loaded compiler
        solcCache.set(normalizedVersion, solcSnapshot);
        resolve(solcSnapshot);
      }
    });
  });
}

// Helper function to remove metadata from bytecode
function removeMetadata(bytecode: string): string {
  let cleaned = bytecode.toLowerCase();
  if (cleaned.startsWith('0x')) {
    cleaned = cleaned.substring(2);
  }

  // Look for IPFS metadata marker
  const ipfsMarkerIndex = cleaned.lastIndexOf('a264697066735822');
  if (ipfsMarkerIndex > 0) {
    return cleaned.substring(0, ipfsMarkerIndex);
  }

  // Look for Bzzr1 metadata marker
  const bzzr1MarkerIndex = cleaned.lastIndexOf('a265627a7a7231');
  if (bzzr1MarkerIndex > 0) {
    return cleaned.substring(0, bzzr1MarkerIndex);
  }

  // Look for Bzzr0 metadata marker
  const bzzr0MarkerIndex = cleaned.lastIndexOf('a265627a7a7230');
  if (bzzr0MarkerIndex > 0) {
    return cleaned.substring(0, bzzr0MarkerIndex);
  }

  // Old swarm metadata
  const swarmMarkerIndex = cleaned.lastIndexOf('a165627a7a72');
  if (swarmMarkerIndex > 0) {
    return cleaned.substring(0, swarmMarkerIndex);
  }

  return cleaned;
}

// Verify source code (Etherscan/Hardhat compatible)
async function verifySourceCode(params: {
  contractaddress: string;
  sourceCode: string;
  codeformat: string;
  contractname: string;
  compilerversion: string;
  optimizationUsed: string;
  runs: string;
  constructorArguements?: string;
  evmversion?: string;
  licenseType?: string;
  libraryname1?: string;
  libraryaddress1?: string;
}) {
  try {
    await connectDB();

    const {
      contractaddress,
      sourceCode,
      codeformat,
      contractname,
      compilerversion,
      optimizationUsed,
      runs,
      constructorArguements,
      evmversion,
      licenseType,
    } = params;

    // Validate address
    if (!isValidAddress(contractaddress)) {
      return errorResponse('Invalid contract address');
    }

    // Generate GUID for tracking
    const guid = randomUUID();

    // Create verification job
    const job = new VerificationJob({
      guid,
      address: contractaddress.toLowerCase(),
      status: 'pending',
      message: 'Verification in progress',
      sourceCode,
      codeFormat: codeformat || 'solidity-single-file',
      contractName: contractname,
      compilerVersion: compilerversion,
      optimizationUsed: optimizationUsed === '1',
      runs: parseInt(runs) || 200,
      constructorArguments: constructorArguements || '',
      evmVersion: evmversion || 'paris',
      licenseType: licenseType || '',
    });

    await job.save();

    // Process verification asynchronously
    processVerification(guid).catch((err) => {
      console.error(`Verification job ${guid} failed:`, err);
    });

    // Return GUID immediately (Etherscan-style response)
    return successResponse(guid, 'OK');
  } catch (error) {
    console.error('[verifySourceCode] Error:', error);
    return errorResponse('Error submitting verification request');
  }
}

// Process verification job
async function processVerification(guid: string) {
  try {
    await connectDB();

    const job = await VerificationJob.findOne({ guid });
    if (!job) {
      console.error(`Verification job ${guid} not found`);
      return;
    }

    const {
      address,
      sourceCode,
      codeFormat,
      contractName,
      compilerVersion,
      optimizationUsed,
      runs,
      constructorArguments,
      evmVersion,
      licenseType,
    } = job;

    // Get on-chain bytecode
    const onchainBytecode = await publicClient.getCode({ address: address as Address });

    if (!onchainBytecode || onchainBytecode === '0x') {
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: 'No contract found at this address' }
      );
      return;
    }

    let compiledSourceCode = sourceCode;
    let inputJson: Record<string, unknown>;

    // Handle different code formats
    if (codeFormat === 'solidity-standard-json-input') {
      // Standard JSON Input format (used by Hardhat)
      try {
        inputJson = JSON.parse(sourceCode);
        // Ensure settings are present
        if (!inputJson.settings) {
          inputJson.settings = {};
        }
        const settings = inputJson.settings as Record<string, unknown>;
        settings.outputSelection = {
          '*': {
            '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'],
          },
        };
        if (optimizationUsed) {
          settings.optimizer = {
            enabled: optimizationUsed,
            runs: runs || 200,
          };
        }
        if (evmVersion) {
          settings.evmVersion = evmVersion;
        }
      } catch (parseError) {
        await VerificationJob.updateOne(
          { guid },
          { status: 'fail', message: 'Invalid Standard JSON Input format' }
        );
        return;
      }
    } else {
      // Single file format
      compiledSourceCode = modernizeSyntax(sourceCode);

      inputJson = {
        language: 'Solidity',
        sources: {
          [contractName.includes(':') ? contractName.split(':')[0] : `${contractName}.sol`]: {
            content: compiledSourceCode,
          },
        },
        settings: {
          outputSelection: {
            '*': {
              '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers'],
            },
          },
          optimizer: {
            enabled: optimizationUsed,
            runs: runs || 200,
          },
          evmVersion: evmVersion || 'paris',
          // Match Hardhat's default metadata settings
          metadata: {
            bytecodeHash: 'ipfs', // Hardhat default
            useLiteralContent: false,
          },
          // Disable viaIR by default (Hardhat default)
          viaIR: false,
        },
      };
    }

    // Load the requested compiler version
    const normalizedVersion = normalizeCompilerVersion(compilerVersion);
    console.log(
      `🔧 Requested compiler version: ${compilerVersion} (normalized: ${normalizedVersion})`
    );

    const solcCompiler = await loadSolcVersion(compilerVersion);

    // Compile with the loaded compiler
    let compiledOutput;
    try {
      const compileFunc = (solcCompiler as { compile: (input: string) => string }).compile;
      compiledOutput = JSON.parse(compileFunc(JSON.stringify(inputJson)));
      console.log(`✅ Compiled with solc ${normalizedVersion}`);
    } catch (compileError) {
      await VerificationJob.updateOne(
        { guid },
        {
          status: 'fail',
          message: `Compilation failed: ${compileError instanceof Error ? compileError.message : 'Unknown error'}`,
        }
      );
      return;
    }

    // Check for compilation errors
    if (compiledOutput.errors) {
      const errors = compiledOutput.errors.filter(
        (e: { severity: string }) => e.severity === 'error'
      );
      if (errors.length > 0) {
        await VerificationJob.updateOne(
          { guid },
          {
            status: 'fail',
            message: `Compilation errors: ${errors.map((e: { message: string }) => e.message).join('; ')}`,
          }
        );
        return;
      }
    }

    // Find the compiled contract
    let compiledContract = null;
    let actualContractName = contractName;

    // Parse contract name (format: "FileName.sol:ContractName" or just "ContractName")
    let fileName = '';
    let targetContractName = contractName;
    if (contractName.includes(':')) {
      [fileName, targetContractName] = contractName.split(':');
    }

    if (compiledOutput.contracts) {
      for (const sourceName in compiledOutput.contracts) {
        const contracts = compiledOutput.contracts[sourceName];
        for (const name in contracts) {
          if (name === targetContractName || (!targetContractName && !compiledContract)) {
            compiledContract = contracts[name];
            actualContractName = name;
          }
        }
      }
    }

    if (!compiledContract) {
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: `Contract '${contractName}' not found in compilation output` }
      );
      return;
    }

    // Compare bytecodes
    const compiledBytecode =
      compiledContract.evm?.deployedBytecode?.object || compiledContract.evm?.bytecode?.object;

    if (!compiledBytecode) {
      await VerificationJob.updateOne(
        { guid },
        { status: 'fail', message: 'No bytecode generated from compilation' }
      );
      return;
    }

    // Normalize and compare bytecodes
    const cleanOnchainBytecode = removeMetadata(onchainBytecode).replace(/0+$/, '');
    const cleanCompiledBytecode = removeMetadata(compiledBytecode).replace(/0+$/, '');

    // Calculate similarity
    const minLen = Math.min(cleanOnchainBytecode.length, cleanCompiledBytecode.length);
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
      if (cleanOnchainBytecode[i] === cleanCompiledBytecode[i]) matches++;
    }
    const similarity = minLen > 0 ? matches / minLen : 0;

    // Check various verification methods
    const isVerified =
      cleanCompiledBytecode === cleanOnchainBytecode ||
      cleanCompiledBytecode.includes(cleanOnchainBytecode) ||
      cleanOnchainBytecode.includes(cleanCompiledBytecode) ||
      similarity > 0.95;

    if (isVerified) {
      // Extract license from source code
      let license = licenseType || 'None';
      if (!licenseType) {
        const spdxMatch = sourceCode.match(/SPDX-License-Identifier:\s*([^\s\n\r*]+)/i);
        if (spdxMatch && spdxMatch[1]) {
          license = spdxMatch[1].trim();
        }
      }

      // Save verified contract
      const contractData = {
        address: address.toLowerCase(),
        contractName: actualContractName,
        compilerVersion: normalizeCompilerVersion(compilerVersion),
        optimization: optimizationUsed,
        optimizationRuns: runs,
        license,
        sourceCode: codeFormat === 'solidity-standard-json-input' ? sourceCode : compiledSourceCode,
        abi: JSON.stringify(compiledContract.abi),
        byteCode: onchainBytecode,
        verified: true,
        verifiedAt: new Date(),
      };

      await Contract.findOneAndUpdate({ address: address.toLowerCase() }, contractData, {
        upsert: true,
        new: true,
      });

      await VerificationJob.updateOne(
        { guid },
        { status: 'pass', message: 'Contract successfully verified' }
      );
    } else {
      await VerificationJob.updateOne(
        { guid },
        {
          status: 'fail',
          message: `Bytecode mismatch (similarity: ${(similarity * 100).toFixed(2)}%)`,
        }
      );
    }
  } catch (error) {
    console.error(`[processVerification] Error for ${guid}:`, error);
    await VerificationJob.updateOne(
      { guid },
      {
        status: 'fail',
        message: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    );
  }
}

// Check verification status
async function checkVerifyStatus(guid: string) {
  try {
    await connectDB();

    const job = await VerificationJob.findOne({ guid }).lean();

    if (!job) {
      // Etherscan returns status 0 with result as string for not found
      return NextResponse.json(
        {
          status: '0',
          message: 'GUID not found',
          result: 'Fail - GUID not found',
        },
        { headers: getSecurityHeaders() }
      );
    }

    // Etherscan-style response - result must ALWAYS be a string, never null
    if (job.status === 'pending') {
      return NextResponse.json(
        {
          status: '0',
          message: 'Pending in queue',
          result: 'Pending in queue',
        },
        { headers: getSecurityHeaders() }
      );
    } else if (job.status === 'pass') {
      return NextResponse.json(
        {
          status: '1',
          message: 'OK',
          result: 'Pass - Verified',
        },
        { headers: getSecurityHeaders() }
      );
    } else {
      // Fail status - result must be a string describing the failure
      const failMessage = job.message || 'Fail - Unable to verify';
      return NextResponse.json(
        {
          status: '0',
          message: failMessage,
          result: `Fail - ${failMessage}`,
        },
        { headers: getSecurityHeaders() }
      );
    }
  } catch (error) {
    console.error('[checkVerifyStatus] Error:', error);
    return NextResponse.json(
      {
        status: '0',
        message: 'Error checking verification status',
        result: 'Fail - Error checking verification status',
      },
      { headers: getSecurityHeaders() }
    );
  }
}

// ============================================
// Contract Module
// ============================================

async function getAbi(address: string) {
  try {
    await connectDB();
    const contract = (await Contract.findOne({
      address: { $regex: new RegExp(`^${address}$`, 'i') },
      verified: true,
    }).lean()) as Record<string, unknown> | null;

    if (!contract || !contract.abi) {
      // Etherscan returns NOTOK status for unverified contracts
      return errorResponse('Contract source code not verified');
    }

    // Etherscan returns ABI as a string (already JSON stringified)
    const abiString =
      typeof contract.abi === 'string' ? contract.abi : JSON.stringify(contract.abi);
    return successResponse(abiString);
  } catch (error) {
    return errorResponse('Error fetching ABI');
  }
}

async function getSourceCode(address: string) {
  try {
    await connectDB();
    const contract = (await Contract.findOne({
      address: { $regex: new RegExp(`^${address}$`, 'i') },
      verified: true,
    }).lean()) as Record<string, unknown> | null;

    if (!contract) {
      // Etherscan returns empty array for unverified contracts
      return successResponse([
        {
          SourceCode: '',
          ABI: 'Contract source code not verified',
          ContractName: '',
          CompilerVersion: '',
          OptimizationUsed: '',
          Runs: '',
          ConstructorArguments: '',
          EVMVersion: '',
          Library: '',
          LicenseType: '',
          Proxy: '0',
          Implementation: '',
          SwarmSource: '',
        },
      ]);
    }

    // Etherscan-compatible response format
    const result = [
      {
        SourceCode: contract.sourceCode || '',
        ABI: typeof contract.abi === 'string' ? contract.abi : JSON.stringify(contract.abi || []),
        ContractName: contract.contractName || '',
        CompilerVersion: `v${contract.compilerVersion || ''}`,
        OptimizationUsed: contract.optimization ? '1' : '0',
        Runs: String(contract.optimizationRuns || 200),
        ConstructorArguments: contract.constructorArguments || '',
        EVMVersion: 'Default',
        Library: '',
        LicenseType: contract.license || '',
        Proxy: '0',
        Implementation: '',
        SwarmSource: '',
      },
    ];

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching source code');
  }
}

// ============================================
// Main Handler
// ============================================

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`blockscout-api:${clientIp}`, 100, 20);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: '0', message: 'Rate limit exceeded', result: null },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  const { searchParams } = new URL(request.url);
  const apiModule = searchParams.get('module')?.toLowerCase();
  const action = searchParams.get('action')?.toLowerCase();

  if (!apiModule || !action) {
    return errorResponse('Missing required parameters: module and action');
  }

  // Validate module and action names (alphanumeric only)
  if (!/^[a-z0-9_]+$/.test(apiModule) || !/^[a-z0-9_]+$/.test(action)) {
    return errorResponse('Invalid module or action format');
  }

  try {
    // Account module
    if (apiModule === 'account') {
      if (action === 'balance') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        return getBalance(address);
      }
      if (action === 'balancemulti') {
        const addresses = searchParams.get('address');
        if (!addresses) return errorResponse('Missing address parameter');
        // Validate all addresses
        const addressList = addresses.split(',');
        for (const addr of addressList) {
          if (!isValidAddress(addr.trim())) {
            return errorResponse(`Invalid address format: ${addr}`);
          }
        }
        return getBalanceMulti(addresses);
      }
      if (action === 'txlist') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        const sort = searchParams.get('sort') || 'desc';
        return getTxList(address, pagination.page, pagination.limit, sort);
      }
      if (action === 'txlistinternal') {
        const address = searchParams.get('address');
        const txhash = searchParams.get('txhash');
        if (address && !isValidAddress(address)) return errorResponse('Invalid address format');
        if (txhash && !isValidHash(txhash)) return errorResponse('Invalid txhash format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTxListInternal(
          address || undefined,
          txhash || undefined,
          pagination.page,
          pagination.limit
        );
      }
      if (action === 'tokentx') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        const contractaddress = searchParams.get('contractaddress') || undefined;
        if (contractaddress && !isValidAddress(contractaddress)) {
          return errorResponse('Invalid contractaddress format');
        }
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTokenTx(address, contractaddress, pagination.page, pagination.limit);
      }
      if (action === 'tokenbalance') {
        const address = searchParams.get('address');
        const contractaddress = searchParams.get('contractaddress');
        if (!address) return errorResponse('Missing address parameter');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        return getTokenBalance(address, contractaddress);
      }
      if (action === 'getminedblocks') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getMinedBlocks(address, pagination.page, pagination.limit);
      }
    }

    // Block module
    if (apiModule === 'block') {
      if (action === 'getblockreward') {
        const blockno = searchParams.get('blockno');
        if (!blockno) return errorResponse('Missing blockno parameter');
        return getBlockReward(blockno);
      }
      if (action === 'getblocknobytime') {
        const timestamp = searchParams.get('timestamp');
        if (!timestamp) return errorResponse('Missing timestamp parameter');
        const closest = searchParams.get('closest') || 'before';
        return getBlockNoByTime(timestamp, closest);
      }
    }

    // Transaction module
    if (apiModule === 'transaction') {
      if (action === 'gettxinfo' || action === 'getstatus') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        if (!isValidHash(txhash)) return errorResponse('Invalid txhash format');
        return getTxInfo(txhash);
      }
      if (action === 'gettxreceiptstatus') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        if (!isValidHash(txhash)) return errorResponse('Invalid txhash format');
        return getTxReceiptStatus(txhash);
      }
    }

    // Token module
    if (apiModule === 'token') {
      if (action === 'gettoken' || action === 'tokeninfo') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        return getTokenInfo(contractaddress);
      }
      if (action === 'gettokenholders') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTokenHolders(contractaddress, pagination.page, pagination.limit);
      }
      if (action === 'tokenlist') {
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTokenList(pagination.page, pagination.limit);
      }
    }

    // Stats module
    if (apiModule === 'stats') {
      if (action === 'ethsupply' || action === 'coinsupply') {
        return getEthSupply();
      }
      if (action === 'tokensupply') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        return getTokenSupply(contractaddress);
      }
      if (action === 'ethprice' || action === 'coinprice') {
        return getEthPrice();
      }
      if (action === 'chainsize') {
        return getChainSize();
      }
      if (action === 'dailytx' || action === 'dailytxncount') {
        const startdate = searchParams.get('startdate') || undefined;
        const enddate = searchParams.get('enddate') || undefined;
        const sort = searchParams.get('sort') || 'asc';
        return getDailyTx(startdate, enddate, sort);
      }
    }

    // Contract module
    if (apiModule === 'contract') {
      if (action === 'getabi') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        return getAbi(address);
      }
      if (action === 'getsourcecode') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        return getSourceCode(address);
      }
      if (action === 'getcontractcreation') {
        const addresses = searchParams.get('contractaddresses');
        if (!addresses) return errorResponse('Missing contractaddresses parameter');
        // Validate all addresses
        const addressList = addresses.split(',');
        for (const addr of addressList) {
          if (!isValidAddress(addr.trim())) {
            return errorResponse(`Invalid address format: ${addr}`);
          }
        }
        return getContractCreation(addresses);
      }
      // Check verification status (Etherscan/Hardhat compatible)
      if (action === 'checkverifystatus') {
        const guid = searchParams.get('guid');
        if (!guid) return errorResponse('Missing guid parameter');
        return checkVerifyStatus(guid);
      }
    }

    // Logs module
    if (apiModule === 'logs') {
      if (action === 'getlogs') {
        const address = searchParams.get('address') || undefined;
        const fromBlock = searchParams.get('fromBlock') || undefined;
        const toBlock = searchParams.get('toBlock') || undefined;
        const topic0 = searchParams.get('topic0') || undefined;
        const topic1 = searchParams.get('topic1') || undefined;
        const topic2 = searchParams.get('topic2') || undefined;
        const topic3 = searchParams.get('topic3') || undefined;
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '1000');
        return getLogs(address, fromBlock, toBlock, topic0, topic1, topic2, topic3, page, offset);
      }
    }

    // Proxy module (JSON-RPC)
    if (apiModule === 'proxy') {
      if (action === 'eth_blocknumber') {
        return proxyEthBlockNumber();
      }
      if (action === 'eth_getblockbynumber') {
        const tag = searchParams.get('tag') || 'latest';
        const boolean = searchParams.get('boolean') === 'true';
        return proxyEthGetBlockByNumber(tag, boolean);
      }
      if (action === 'eth_gettransactionbyhash') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        return proxyEthGetTransactionByHash(txhash);
      }
      if (action === 'eth_gettransactionreceipt') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        return proxyEthGetTransactionReceipt(txhash);
      }
      if (action === 'eth_call') {
        const to = searchParams.get('to');
        const data = searchParams.get('data');
        if (!to) return errorResponse('Missing to parameter');
        if (!data) return errorResponse('Missing data parameter');
        const tag = searchParams.get('tag') || 'latest';
        return proxyEthCall(to, data, tag);
      }
      if (action === 'eth_getcode') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        const tag = searchParams.get('tag') || 'latest';
        return proxyEthGetCode(address, tag);
      }
      if (action === 'eth_gasprice') {
        return proxyEthGasPrice();
      }
      if (action === 'eth_estimategas') {
        const to = searchParams.get('to');
        if (!to) return errorResponse('Missing to parameter');
        const data = searchParams.get('data') || undefined;
        const value = searchParams.get('value') || undefined;
        const from = searchParams.get('from') || undefined;
        return proxyEthEstimateGas(to, data, value, from);
      }
    }

    return errorResponse(`Unknown module/action: ${apiModule}/${action}`);
  } catch (error) {
    console.error('[Blockscout API] Error:', error);
    return errorResponse('Internal server error');
  }
}

// POST Handler for contract verification (Etherscan/Hardhat compatible)
export async function POST(request: NextRequest) {
  // Rate limiting - stricter for verification
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`verify-api:${clientIp}`, 10, 60); // 10 requests per minute
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: '0', message: 'Rate limit exceeded', result: null },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let params: Record<string, string> = {};

    // Get module and action from URL query params first
    const { searchParams } = new URL(request.url);
    const queryModule = searchParams.get('module')?.toLowerCase() || '';
    const queryAction = searchParams.get('action')?.toLowerCase() || '';

    // Handle both JSON and form-data (Etherscan uses form-data)
    if (contentType.includes('application/json')) {
      params = await request.json();
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        params[key] = value.toString();
      });
    } else {
      // Try to parse as JSON anyway
      try {
        params = await request.json();
      } catch {
        return errorResponse('Invalid content type. Expected application/json or form-data');
      }
    }

    // Module and action can come from URL query params OR body params
    // URL query params take precedence (for /api?module=contract&action=verifysourcecode style)
    const apiModule = queryModule || (params.module || '').toLowerCase();
    const action = queryAction || (params.action || '').toLowerCase();

    // Contract verification
    if (apiModule === 'contract' && action === 'verifysourcecode') {
      return verifySourceCode({
        contractaddress: params.contractaddress || params.address || '',
        sourceCode: params.sourceCode || params.sourcecode || '',
        codeformat: params.codeformat || 'solidity-single-file',
        contractname: params.contractname || '',
        compilerversion: params.compilerversion || '',
        optimizationUsed: params.optimizationUsed || params.optimizationused || '0',
        runs: params.runs || '200',
        constructorArguements: params.constructorArguements || params.constructorarguments || '',
        evmversion: params.evmversion || 'paris',
        licenseType: params.licenseType || params.licensetype || '',
        libraryname1: params.libraryname1 || '',
        libraryaddress1: params.libraryaddress1 || '',
      });
    }

    // Verify proxy contract (placeholder for future implementation)
    if (apiModule === 'contract' && action === 'verifyproxycontract') {
      return errorResponse('Proxy contract verification not yet implemented');
    }

    return errorResponse(`Unknown POST module/action: ${apiModule}/${action}`);
  } catch (error) {
    console.error('[Blockscout API POST] Error:', error);
    return errorResponse('Internal server error');
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
