/**
 * Domain handlers for the Blockscout/Etherscan-compatible API.
 *
 * Groups the `block`, `transaction`, `token`, `stats`, `logs` and `contract`
 * read actions. Extracted from `app/api/route.ts` to keep the dispatcher thin;
 * the `account`, `proxy` and contract-`verification` actions live in sibling
 * modules.
 */

import { hexToNumber, numberToHex, type Hash } from 'viem';
import { countAll } from '../../db/count';
import { connectDB, Block, Transaction, Contract, Market, TokenHolder } from '@/models/index';
import { ercTokenType } from '@/lib/api/token-standard';
import {
  publicClient,
  Token,
  successResponse,
  errorResponse,
  emptyListResponse,
  rpcResponse,
  rpcErrorResponse,
  txStatusFields,
  getHeadNumber,
  confirmations,
  getBlockRewardWeiForHeight,
} from './shared';
import { getNephewRewardWei, getUncleRewardWei } from '@/lib/reward-schedule';
import { calculateTotalSupplyWei } from '@/lib/supply';
import { etherscanEvmVersion } from '@/lib/contract/solc-utils';

// ============================================
// Block Module
// ============================================

export async function getBlockReward(blockno: string) {
  try {
    await connectDB();
    const blockNum = parseInt(blockno);
    const block = (await Block.findOne({ number: blockNum }).lean()) as {
      number: number;
      hash: string;
      miner?: string;
      timestamp?: number;
      uncles?: string[];
    } | null;

    if (!block) {
      return errorResponse('Block not found');
    }

    // The block lists only uncle hashes; the reward depends on each uncle's height.
    const uncles = await Promise.all(
      (block.uncles ?? []).map(async (_hash, index) => {
        const uncle = await publicClient.request({
          method: 'eth_getUncleByBlockHashAndIndex',
          params: [block.hash as Hash, numberToHex(index)],
        });
        if (!uncle?.number) throw new Error(`uncle ${index} of block ${blockNum} not found`);
        return {
          miner: uncle.miner.toLowerCase(),
          unclePosition: String(index),
          blockreward: getUncleRewardWei(hexToNumber(uncle.number), blockNum).toString(),
        };
      })
    );
    const uncleInclusionReward = BigInt(uncles.length) * getNephewRewardWei(blockNum);

    const txs = (await Transaction.find({ blockNumber: blockNum })
      .select('gasUsed gasPrice')
      .lean()) as Array<{ gasUsed?: number; gasPrice?: string }>;
    const fees = txs.reduce(
      (total, tx) => total + BigInt(tx.gasUsed ?? 0) * BigInt(tx.gasPrice || '0'),
      0n
    );

    // Etherscan semantics: blockReward = static reward + fees + uncle inclusion reward
    const result = {
      blockNumber: String(block.number),
      timeStamp: String(block.timestamp || ''),
      blockMiner: block.miner,
      blockReward: (
        BigInt(getBlockRewardWeiForHeight(blockNum)) +
        fees +
        uncleInclusionReward
      ).toString(),
      uncles,
      uncleInclusionReward: uncleInclusionReward.toString(),
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

/** Etherscan `getblockcountdown`: blocks and estimated seconds until a future height. */
export async function getBlockCountdown(blockno: string) {
  try {
    await connectDB();
    const target = parseInt(blockno, 10);
    if (!Number.isSafeInteger(target) || target < 0) return errorResponse('Invalid blockno');
    const head = await getHeadNumber();
    if (target <= head) return errorResponse('NOTOK', 'Error! Block number already pass');

    // average block time over the last blocks (up to 1000)
    const span = Math.min(1000, head);
    const [newest, oldest] = (await Promise.all([
      Block.findOne({ number: head }).select('timestamp').lean(),
      Block.findOne({ number: head - span })
        .select('timestamp')
        .lean(),
    ])) as Array<{ timestamp?: number } | null>;
    const elapsed =
      newest?.timestamp && oldest?.timestamp ? newest.timestamp - oldest.timestamp : 0;
    const blockTime = span > 0 && elapsed > 0 ? elapsed / span : 0;
    const remaining = target - head;

    return successResponse({
      CurrentBlock: String(head),
      CountdownBlock: String(target),
      RemainingBlock: String(remaining),
      EstimateTimeInSec: (remaining * blockTime).toFixed(1),
    });
  } catch (error) {
    return errorResponse('Error fetching block countdown');
  }
}

/** Blockscout `eth_block_number`: the node's head in the JSON-RPC envelope. */
export async function getEthBlockNumber() {
  try {
    return rpcResponse(await publicClient.request({ method: 'eth_blockNumber' }));
  } catch (error) {
    return rpcErrorResponse('Error fetching block number');
  }
}

// ============================================
// Transaction Module
// ============================================

export async function getTxInfo(txhash: string) {
  try {
    await connectDB();
    const [tx, head] = await Promise.all([
      Transaction.findOne({ hash: txhash.toLowerCase() }).lean() as Promise<Record<
        string,
        unknown
      > | null>,
      getHeadNumber(),
    ]);

    if (!tx) {
      return errorResponse('Transaction not found');
    }

    // Logs come from the node; the transaction is still reported without them
    let logs: Array<{ address: string; data: string; topics: string[]; index: string }> = [];
    try {
      const receipt = await publicClient.request({
        method: 'eth_getTransactionReceipt',
        params: [txhash.toLowerCase() as Hash],
      });
      logs = (receipt?.logs ?? []).map((log) => ({
        address: log.address,
        data: log.data,
        topics: log.topics,
        index: String(hexToNumber(log.logIndex ?? '0x0')),
      }));
    } catch {
      logs = [];
    }

    // Blockscout `gettxinfo` fields, followed by the Etherscan-style ones this action used to return
    const result = {
      blockNumber: String(tx.blockNumber),
      confirmations: confirmations(head, tx.blockNumber),
      from: tx.from,
      gasLimit: String(tx.gas ?? 0),
      gasPrice: tx.gasPrice?.toString() || '0',
      gasUsed: String(tx.gasUsed ?? 0),
      hash: tx.hash,
      input: tx.input || '0x',
      logs,
      revertReason: '',
      success: tx.status !== 0,
      timeStamp: String(tx.timestamp ?? ''),
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      nonce: String(tx.nonce ?? 0),
      blockHash: tx.blockHash || '',
      transactionIndex: String(tx.transactionIndex ?? 0),
      gas: String(tx.gas ?? 0),
      ...txStatusFields(tx.status),
      contractAddress: tx.creates || '',
    };

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transaction');
  }
}

/** Etherscan `getstatus`: whether the contract execution failed. */
export async function getTxStatus(txhash: string) {
  try {
    await connectDB();
    const tx = (await Transaction.findOne({ hash: txhash.toLowerCase() })
      .select('status')
      .lean()) as { status?: number | null } | null;

    // Etherscan answers an unknown hash like a successful one
    return successResponse({ isError: tx?.status === 0 ? '1' : '0', errDescription: '' });
  } catch (error) {
    return errorResponse('Error fetching transaction status');
  }
}

export async function getTxReceiptStatus(txhash: string) {
  try {
    await connectDB();
    const tx = (await Transaction.findOne({
      hash: txhash.toLowerCase(),
    }).lean()) as Record<string, unknown> | null;

    if (!tx) {
      return successResponse({ status: '' });
    }

    return successResponse({ status: txStatusFields(tx.status).txreceipt_status });
  } catch (error) {
    return errorResponse('Error fetching transaction status');
  }
}

// ============================================
// Token Module
// ============================================

function tokenFields(token: Record<string, unknown>) {
  return {
    contractAddress: token.address,
    name: token.name || '',
    symbol: token.symbol || '',
    decimals: String(token.decimals ?? 18),
    totalSupply: token.totalSupply?.toString() || '0',
    type: ercTokenType(token.type as string | undefined),
  };
}

/** Blockscout `getToken`. */
export async function getTokenInfo(contractaddress: string) {
  try {
    await connectDB();
    const token = (await Token.findOne({
      address: contractaddress.toLowerCase(),
    }).lean()) as Record<string, unknown> | null;

    if (!token) {
      return errorResponse('Token not found');
    }

    return successResponse({ cataloged: true, ...tokenFields(token) });
  } catch (error) {
    return errorResponse('Error fetching token info');
  }
}

/** Etherscan `tokeninfo`: a one-element array with Etherscan's field names. */
export async function getTokenInfoEtherscan(contractaddress: string) {
  try {
    await connectDB();
    const token = (await Token.findOne({
      address: contractaddress.toLowerCase(),
    }).lean()) as Record<string, unknown> | null;

    if (!token) {
      return errorResponse('No data found', []);
    }

    const fields = tokenFields(token);
    const metadata = (token.metadata ?? {}) as { description?: string; website?: string };
    return successResponse([
      {
        contractAddress: fields.contractAddress,
        tokenName: fields.name,
        symbol: fields.symbol,
        divisor: fields.decimals,
        tokenType: fields.type.replace('-', ''),
        totalSupply: fields.totalSupply,
        blueCheckmark: 'false',
        description: metadata.description || '',
        website: metadata.website || '',
      },
    ]);
  } catch (error) {
    return errorResponse('Error fetching token info');
  }
}

/**
 * Holders of a token from the `tokenholders` collection, by rank.
 * `blockscout`: `[{ address, value }]` (getTokenHolders);
 * `etherscan`: `[{ TokenHolderAddress, TokenHolderQuantity }]` (tokenholderlist).
 */
export async function getTokenHolders(
  contractaddress: string,
  page = 1,
  offset = 10,
  format: 'blockscout' | 'etherscan' = 'blockscout'
) {
  try {
    await connectDB();
    const holders = (await TokenHolder.find({
      tokenAddress: contractaddress.toLowerCase(),
      balance: { $nin: ['0', ''], $exists: true },
    })
      .sort({ rank: 1 })
      .skip((page - 1) * offset)
      .limit(offset)
      .lean()) as Array<Record<string, unknown>>;

    if (holders.length === 0) return emptyListResponse('No token holders found');

    return successResponse(
      holders.map((holder) =>
        format === 'etherscan'
          ? {
              TokenHolderAddress: holder.holderAddress,
              TokenHolderQuantity: String(holder.balance),
            }
          : { address: holder.holderAddress, value: String(holder.balance) }
      )
    );
  } catch (error) {
    return errorResponse('Error fetching token holders');
  }
}

// ============================================
// Stats Module
// ============================================

export async function getEthSupply() {
  try {
    // Same figure as /api/total_supply (block rewards + uncle issuance + pre-mine), in wei
    return successResponse((await calculateTotalSupplyWei()).toString());
  } catch (error) {
    return errorResponse('Error fetching supply');
  }
}

export async function getTokenSupply(contractaddress: string) {
  try {
    await connectDB();
    const token = (await Token.findOne({
      address: contractaddress.toLowerCase(),
    }).lean()) as Record<string, unknown> | null;

    if (!token) {
      return errorResponse('Token not found');
    }

    return successResponse(token.totalSupply?.toString() || '0');
  } catch (error) {
    return errorResponse('Error fetching token supply');
  }
}

/** Plain decimal string (no exponent) for a price figure. */
function plainNumber(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return amount.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Latest stored price of the native coin (collection `Market`, written by
 * tools/price.ts). `etherscan`: `ethusd` / `ethbtc` (ethprice); `blockscout`:
 * `coin_usd` / `coin_btc` (coinprice). Zeros when no price has been stored.
 */
export async function getEthPrice(format: 'etherscan' | 'blockscout' = 'etherscan') {
  let usd = '0';
  let btc = '0';
  let timestamp = String(Math.floor(Date.now() / 1000));
  try {
    await connectDB();
    const latest = (await Market.findOne().sort({ timestamp: -1 }).lean()) as {
      timestamp?: number;
      quoteUSD?: number;
      quoteBTC?: number;
    } | null;
    if (latest) {
      usd = plainNumber(latest.quoteUSD);
      btc = plainNumber(latest.quoteBTC);
      const stored = Number(latest.timestamp);
      if (Number.isFinite(stored) && stored > 0) {
        timestamp = String(Math.floor(stored > 1e12 ? stored / 1000 : stored));
      }
    }
  } catch (error) {
    // fall through with zeros
  }

  return successResponse(
    format === 'blockscout'
      ? {
          coin_btc: btc,
          coin_btc_timestamp: timestamp,
          coin_usd: usd,
          coin_usd_timestamp: timestamp,
        }
      : { ethbtc: btc, ethbtc_timestamp: timestamp, ethusd: usd, ethusd_timestamp: timestamp }
  );
}

// Get chain size (database size approximation)
export async function getChainSize() {
  try {
    await connectDB();
    // Collection metadata counts (lib/db/count.ts): the estimate is enough for a size approximation
    const blockCount = await countAll(Block);
    const txCount = await countAll(Transaction);

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

// Get all tokens list (spam-hidden tokens are left out, as in every list API)
export async function getTokenList(page = 1, offset = 100) {
  try {
    await connectDB();
    const skip = (page - 1) * offset;

    const tokens = await Token.find({ hidden: { $ne: true } })
      .sort({ holders: -1, address: 1 })
      .skip(skip)
      .limit(offset)
      .lean();

    return successResponse(tokens.map((token: Record<string, unknown>) => tokenFields(token)));
  } catch (error) {
    return errorResponse('Error fetching token list');
  }
}

/** Etherscan `gasoracle`: gas price tiers in gwei from the latest transactions. */
export async function getGasOracle() {
  try {
    await connectDB();
    const [recent, blocks] = (await Promise.all([
      Transaction.find({})
        .sort({ blockNumber: -1, transactionIndex: -1 })
        .limit(200)
        .select('gasPrice')
        .lean(),
      Block.find({}).sort({ number: -1 }).limit(5).select('number gasUsed gasLimit').lean(),
    ])) as [
      Array<{ gasPrice?: string }>,
      Array<{ number?: number; gasUsed?: number; gasLimit?: number }>,
    ];

    let prices = recent
      .map((tx) => {
        try {
          return BigInt(tx.gasPrice || '0');
        } catch {
          return 0n;
        }
      })
      .filter((price) => price > 0n)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (prices.length === 0) {
      prices = [await publicClient.getGasPrice()];
    }
    const percentile = (p: number) =>
      prices[Math.min(prices.length - 1, Math.floor((prices.length * p) / 100))];
    const gwei = (wei: bigint) => {
      const whole = wei / 1_000_000_000n;
      const fraction = (wei % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
      return fraction ? `${whole}.${fraction}` : whole.toString();
    };

    return successResponse({
      LastBlock: String(blocks[0]?.number ?? 0),
      SafeGasPrice: gwei(percentile(10)),
      ProposeGasPrice: gwei(percentile(50)),
      FastGasPrice: gwei(percentile(90)),
      // no base fee on this chain (pre-London)
      suggestBaseFee: '0',
      gasUsedRatio: blocks
        .map((block) =>
          block.gasLimit
            ? ((block.gasUsed ?? 0) / block.gasLimit).toFixed(6).replace(/0+$/, '0')
            : '0'
        )
        .join(','),
    });
  } catch (error) {
    return errorResponse('Error fetching gas oracle');
  }
}

// ============================================
// Contract Module (Extended)
// ============================================

// Get contract creation info
export async function getContractCreation(addresses: string) {
  try {
    await connectDB();
    const addressList = addresses
      .split(',')
      .slice(0, 5) // Max 5 addresses
      .map((addr) => addr.trim().toLowerCase());

    const txs = (await Transaction.find({ creates: { $in: addressList } })
      .select('creates from hash blockNumber timestamp')
      .lean()) as Array<Record<string, unknown>>;
    const txByContract = new Map(txs.map((tx) => [String(tx.creates), tx]));

    const result = addressList
      .filter((addr) => txByContract.has(addr))
      .map((addr) => {
        const tx = txByContract.get(addr) as Record<string, unknown>;
        return {
          contractAddress: addr,
          contractCreator: tx.from,
          txHash: tx.hash,
          blockNumber: String(tx.blockNumber),
          timestamp: String(tx.timestamp ?? ''),
        };
      });

    if (result.length === 0) return errorResponse('No data found');
    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching contract creation info');
  }
}

// ============================================
// Logs Module
// ============================================

/** Etherscan returns at most 1000 log records per call. */
const MAX_LOG_ROWS = 1000;

/** Block parameter of eth_getLogs: a tag, or a decimal / hex height as a hex quantity. */
function logBlockTag(value: string | undefined, fallback: 'earliest' | 'latest'): string | null {
  if (value === undefined || value === '') return fallback;
  if (value === 'latest' || value === 'earliest') return value;
  if (/^\d+$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value)) return numberToHex(BigInt(value));
  return null;
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string | null;
  blockHash: string | null;
  logIndex: string | null;
  transactionHash: string | null;
  transactionIndex: string | null;
}

export async function getLogs(
  address?: string,
  fromBlock?: string,
  toBlock?: string,
  topic0?: string,
  topic1?: string,
  topic2?: string,
  topic3?: string,
  page = 1,
  offset = MAX_LOG_ROWS
) {
  try {
    const from = logBlockTag(fromBlock, 'earliest');
    const to = logBlockTag(toBlock, 'latest');
    if (!from || !to) return errorResponse('Invalid fromBlock or toBlock');

    const topicList = [topic0, topic1, topic2, topic3];
    if (topicList.some((topic) => topic !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(topic))) {
      return errorResponse('Invalid topic format');
    }
    // an unfiltered scan of the whole chain is not something to forward to the node
    if (!address && !topicList.some(Boolean)) {
      return errorResponse('Missing address or topic parameter');
    }

    // Topics are positional: null matches anything, trailing wildcards are dropped
    const lastTopic = topicList.reduce((last, topic, index) => (topic ? index : last), -1);
    const filter: Record<string, unknown> = { fromBlock: from, toBlock: to };
    if (address) filter.address = address;
    if (lastTopic >= 0) {
      filter.topics = topicList.slice(0, lastTopic + 1).map((topic) => topic ?? null);
    }

    const logs = (await publicClient.request({
      method: 'eth_getLogs',
      params: [filter],
    } as never)) as RawLog[];

    const pageSize = Math.min(Math.max(1, Number(offset) || MAX_LOG_ROWS), MAX_LOG_ROWS);
    const start = (Math.max(1, Number(page) || 1) - 1) * pageSize;
    const rows = logs.slice(start, start + pageSize);
    if (rows.length === 0) return emptyListResponse('No records found');

    // Etherscan adds the block time and the transaction's gas figures to every record
    const timeByBlock = new Map<number, number>();
    const txByHash = new Map<string, { gasPrice?: string; gasUsed?: number }>();
    try {
      await connectDB();
      const heights = [
        ...new Set(
          rows.filter((log) => log.blockNumber).map((log) => hexToNumber(log.blockNumber as Hash))
        ),
      ];
      const hashes = [
        ...new Set(
          rows
            .filter((log) => log.transactionHash)
            .map((log) => String(log.transactionHash).toLowerCase())
        ),
      ];
      const [blocks, txs] = (await Promise.all([
        Block.find({ number: { $in: heights } })
          .select('number timestamp')
          .lean(),
        Transaction.find({ hash: { $in: hashes } })
          .select('hash gasPrice gasUsed')
          .lean(),
      ])) as [
        Array<{ number: number; timestamp?: number }>,
        Array<{ hash: string; gasPrice?: string; gasUsed?: number }>,
      ];
      for (const block of blocks) timeByBlock.set(block.number, block.timestamp ?? 0);
      for (const tx of txs) txByHash.set(tx.hash, tx);
    } catch {
      // the records are still returned, without the added fields
    }
    const hex = (value: bigint | number | undefined) =>
      value === undefined ? '' : numberToHex(BigInt(value));

    const result = rows.map((log) => {
      const height = log.blockNumber ? hexToNumber(log.blockNumber as Hash) : undefined;
      const tx = log.transactionHash ? txByHash.get(log.transactionHash.toLowerCase()) : undefined;
      let gasPrice: string;
      try {
        gasPrice = tx?.gasPrice ? numberToHex(BigInt(tx.gasPrice)) : '';
      } catch {
        gasPrice = '';
      }
      return {
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: log.blockNumber || '0x0',
        blockHash: log.blockHash || '',
        timeStamp:
          height !== undefined && timeByBlock.has(height) ? hex(timeByBlock.get(height)) : '',
        gasPrice,
        gasUsed: hex(tx?.gasUsed),
        logIndex: log.logIndex || '0x0',
        transactionHash: log.transactionHash || '',
        transactionIndex: log.transactionIndex || '0x0',
      };
    });

    return successResponse(result);
  } catch (error) {
    console.error(
      '[getLogs] Error:',
      error instanceof Error ? error.message.split('\n')[0] : error
    );
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
      address: address.toLowerCase(),
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
      address: address.toLowerCase(),
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
        // Records verified before 2026-11 lack the settings (they were dropped on save): empty
        // rather than a guessed 200, and 'Default' as Etherscan reports an unspecified version
        Runs:
          typeof contract.optimizationRuns === 'number' ? String(contract.optimizationRuns) : '',
        ConstructorArguments: contract.constructorArguments || '',
        EVMVersion: etherscanEvmVersion(contract.evmVersion),
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
