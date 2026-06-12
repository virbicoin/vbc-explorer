/**
 * Domain handlers for the Blockscout/Etherscan-compatible API.
 *
 * Groups the `block`, `transaction`, `token`, `stats`, `logs` and `contract`
 * read actions. Extracted from `app/api/route.ts` to keep the dispatcher thin;
 * the `account`, `proxy` and contract-`verification` actions live in sibling
 * modules.
 */

import { type Address } from 'viem';
import { connectDB, Block, Transaction, Account, Contract } from '@/models/index';
import { configJson, publicClient, Token, successResponse, errorResponse, getBlockRewardWeiForHeight, calculateTotalMiningReward } from './shared';

// ============================================
// Block Module
// ============================================

export async function getBlockReward(blockno: string) {
  try {
    await connectDB();
    const blockNum = parseInt(blockno);
    const block = await Block.findOne({ number: blockNum }).lean();

    if (!block) {
      return errorResponse('Block not found');
    }

    const result = {
      blockNumber: String(block.number),
      timeStamp: String(block.timestamp || ''),
      blockMiner: block.miner,
      blockReward: getBlockRewardWeiForHeight(blockNum),
      uncles: [],
      uncleInclusionReward: '0',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching block reward');
  }
}

export async function getBlockNoByTime(timestamp: string, closest: string = 'before') {
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

export async function getTxInfo(txhash: string) {
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

export async function getTxReceiptStatus(txhash: string) {
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

export async function getTokenInfo(contractaddress: string) {
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

export async function getTokenHolders(contractaddress: string, page = 1, offset = 10) {
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

export async function getEthSupply() {
  try {
    const blockNumber = await publicClient.getBlockNumber();
    const premineAmount = configJson.supply?.premineAmount || 1;
    const totalSupply = calculateTotalMiningReward(Number(blockNumber)) + premineAmount;
    return successResponse((BigInt(Math.floor(totalSupply)) * BigInt(10 ** 18)).toString());
  } catch (error) {
    return errorResponse('Error fetching supply');
  }
}

export async function getTokenSupply(contractaddress: string) {
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

export async function getEthPrice() {
  // VBC doesn't have external price feed, return placeholder
  return successResponse({
    ethbtc: '0',
    ethbtc_timestamp: String(Math.floor(Date.now() / 1000)),
    ethusd: '0',
    ethusd_timestamp: String(Math.floor(Date.now() / 1000)),
  });
}

// Get chain size (database size approximation)
export async function getChainSize() {
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
export async function getDailyTx(startdate?: string, enddate?: string, sort = 'asc') {
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
export async function getTokenList(page = 1, offset = 100) {
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
export async function getContractCreation(addresses: string) {
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

export async function getLogs(
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
// Contract Module
// ============================================

export async function getAbi(address: string) {
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

export async function getSourceCode(address: string) {
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
