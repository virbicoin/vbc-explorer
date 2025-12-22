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
import { connectDB, Block, Transaction, TokenTransfer, Account, Contract } from '@/models/index';
import configJsonRaw from '@/config.json';

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

const configJson = configJsonRaw as ConfigWithSupply;

// Define Token schema inline since it's not exported from models/index
const tokenSchema = new mongoose.Schema({
  address: String,
  name: String,
  symbol: String,
  decimals: { type: Number, default: 18 },
  totalSupply: String,
  holders: { type: Number, default: 0 },
  type: String,
  supply: String,
  verified: { type: Boolean, default: false },
  logoUrl: { type: String, default: null }
}, { collection: 'tokens' });

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// RPC Client
const RPC_URL = configJson.network?.rpcUrl || configJson.web3Provider?.url || 'http://localhost:8329';
const publicClient = createPublicClient({
  transport: http(RPC_URL, { timeout: 30000 }),
});

// Response helpers
function successResponse(result: unknown, message = 'OK') {
  return NextResponse.json({
    status: '1',
    message,
    result,
  });
}

function errorResponse(message: string, result: unknown = null) {
  return NextResponse.json({
    status: '0',
    message,
    result,
  });
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
    const balanceOfAbi = [{
      inputs: [{ name: 'account', type: 'address' }],
      name: 'balanceOf',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    }] as const;

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
    const tx = await Transaction.findOne({ 
      hash: { $regex: new RegExp(`^${txhash}$`, 'i') } 
    }).lean() as Record<string, unknown> | null;

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
    const tx = await Transaction.findOne({ 
      hash: { $regex: new RegExp(`^${txhash}$`, 'i') } 
    }).lean() as Record<string, unknown> | null;

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
    const token = await Token.findOne({
      address: { $regex: new RegExp(`^${contractaddress}$`, 'i') },
    }).lean() as Record<string, unknown> | null;

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
    const token = await Token.findOne({
      address: { $regex: new RegExp(`^${contractaddress}$`, 'i') },
    }).lean() as Record<string, unknown> | null;

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
      balance: (holder.tokenBalances as Record<string, string>)?.[contractaddress.toLowerCase()] || '0',
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
    const totalSupply = (Number(blockNumber) * blockReward) + premineAmount;
    // Return in wei
    return successResponse((BigInt(Math.floor(totalSupply)) * BigInt(10 ** 18)).toString());
  } catch (error) {
    return errorResponse('Error fetching supply');
  }
}

async function getTokenSupply(contractaddress: string) {
  try {
    await connectDB();
    const token = await Token.findOne({
      address: { $regex: new RegExp(`^${contractaddress}$`, 'i') },
    }).lean() as Record<string, unknown> | null;

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
    const estimatedSize = (blockCount * 500) + (txCount * 300);
    
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
          timestamp: { $gte: startTs, $lte: endTs }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $toDate: { $multiply: ['$timestamp', 1000] } }
            }
          },
          transactionCount: { $sum: 1 }
        }
      },
      {
        $sort: { _id: sortValue } as Record<string, 1 | -1>
      }
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
    
    const tokens = await Token.find({})
      .sort({ holders: -1 })
      .skip(skip)
      .limit(offset)
      .lean();
    
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
        const tx = await Transaction.findOne({
          creates: { $regex: new RegExp(`^${addr.trim()}$`, 'i') },
        }).lean() as Record<string, unknown> | null;
        
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
    
    const filteredResults = results.filter(r => r !== null);
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
    
    filter.fromBlock = fromBlock === 'latest' ? undefined : 
                       fromBlock ? BigInt(fromBlock) : 'earliest';
    filter.toBlock = toBlock === 'latest' ? undefined : 
                     toBlock ? BigInt(toBlock) : 'latest';
    
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
    
    const result = paginatedLogs.map(log => ({
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
      transactionIndex: log.transactionIndex !== undefined ? `0x${log.transactionIndex.toString(16)}` : '0x0',
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
    
    if (tag === 'latest' || tag === 'pending' || tag === 'earliest' || tag === 'safe' || tag === 'finalized') {
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
      transactionIndex: tx.transactionIndex !== null ? `0x${tx.transactionIndex.toString(16)}` : null,
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
      effectiveGasPrice: receipt.effectiveGasPrice ? `0x${receipt.effectiveGasPrice.toString(16)}` : '0x0',
      from: receipt.from,
      gasUsed: `0x${receipt.gasUsed.toString(16)}`,
      logs: receipt.logs.map(log => ({
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
// Contract Module
// ============================================

async function getAbi(address: string) {
  try {
    await connectDB();
    const contract = await Contract.findOne({
      address: { $regex: new RegExp(`^${address}$`, 'i') },
      verified: true,
    }).lean() as Record<string, unknown> | null;

    if (!contract || !contract.abi) {
      return errorResponse('Contract source code not verified');
    }

    return successResponse(JSON.stringify(contract.abi));
  } catch (error) {
    return errorResponse('Error fetching ABI');
  }
}

async function getSourceCode(address: string) {
  try {
    await connectDB();
    const contract = await Contract.findOne({
      address: { $regex: new RegExp(`^${address}$`, 'i') },
      verified: true,
    }).lean() as Record<string, unknown> | null;

    if (!contract) {
      return errorResponse('Contract source code not verified');
    }

    const result = [{
      SourceCode: contract.sourceCode || '',
      ABI: JSON.stringify(contract.abi || []),
      ContractName: contract.contractName || '',
      CompilerVersion: contract.compilerVersion || '',
      OptimizationUsed: contract.optimizationEnabled ? '1' : '0',
      Runs: String(contract.optimizationRuns || 200),
      ConstructorArguments: contract.constructorArguments || '',
      EVMVersion: 'default',
      Library: '',
      LicenseType: '',
      Proxy: '0',
      Implementation: '',
      SwarmSource: '',
    }];

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching source code');
  }
}

// ============================================
// Main Handler
// ============================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const apiModule = searchParams.get('module')?.toLowerCase();
  const action = searchParams.get('action')?.toLowerCase();

  if (!apiModule || !action) {
    return errorResponse('Missing required parameters: module and action');
  }

  try {
    // Account module
    if (apiModule === 'account') {
      if (action === 'balance') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        return getBalance(address);
      }
      if (action === 'balancemulti') {
        const addresses = searchParams.get('address');
        if (!addresses) return errorResponse('Missing address parameter');
        return getBalanceMulti(addresses);
      }
      if (action === 'txlist') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '10');
        const sort = searchParams.get('sort') || 'desc';
        return getTxList(address, page, offset, sort);
      }
      if (action === 'txlistinternal') {
        const address = searchParams.get('address');
        const txhash = searchParams.get('txhash');
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '10');
        return getTxListInternal(address || undefined, txhash || undefined, page, offset);
      }
      if (action === 'tokentx') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        const contractaddress = searchParams.get('contractaddress') || undefined;
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '10');
        return getTokenTx(address, contractaddress, page, offset);
      }
      if (action === 'tokenbalance') {
        const address = searchParams.get('address');
        const contractaddress = searchParams.get('contractaddress');
        if (!address) return errorResponse('Missing address parameter');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        return getTokenBalance(address, contractaddress);
      }
      if (action === 'getminedblocks') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '10');
        return getMinedBlocks(address, page, offset);
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
        return getTxInfo(txhash);
      }
      if (action === 'gettxreceiptstatus') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        return getTxReceiptStatus(txhash);
      }
    }

    // Token module
    if (apiModule === 'token') {
      if (action === 'gettoken' || action === 'tokeninfo') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        return getTokenInfo(contractaddress);
      }
      if (action === 'gettokenholders') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '10');
        return getTokenHolders(contractaddress, page, offset);
      }
      if (action === 'tokenlist') {
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '100');
        return getTokenList(page, offset);
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
        return getAbi(address);
      }
      if (action === 'getsourcecode') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        return getSourceCode(address);
      }
      if (action === 'getcontractcreation') {
        const addresses = searchParams.get('contractaddresses');
        if (!addresses) return errorResponse('Missing contractaddresses parameter');
        return getContractCreation(addresses);
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

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
