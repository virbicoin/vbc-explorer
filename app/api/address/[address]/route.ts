import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../models/index';
import { tryGetDb } from '../../../../lib/db/get-db';
import { getWeb3 } from '../../../../lib/web3';
import { apiCache, CACHE_TTL } from '../../../../lib/cache';
import { loadConfig } from '../../../../lib/config';
import { calculateTotalSupply } from '../../../../lib/supply';
import {
  sanitizeAddress,
  validatePagination,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../lib/security';

// Load config for known contract names
const config = loadConfig();

// Get shared Web3 instance
const web3 = getWeb3();

// Account schema
const accountSchema = new mongoose.Schema(
  {
    address: String,
    balance: String,
    percentage: Number,
    rank: Number,
    type: Number,
    blockNumber: Number,
  },
  { collection: 'Account' }
);

// Transaction schema
const transactionSchema = new mongoose.Schema(
  {
    hash: String,
    from: String,
    to: String,
    value: String,
    timestamp: Number,
    blockNumber: Number,
    input: String,
    gasUsed: Number,
    gasPrice: String,
    status: Number,
    nonce: Number,
  },
  { collection: 'Transaction' }
);

// TokenTransfer schema is also defined
const tokenTransferSchema = new mongoose.Schema(
  {
    transactionHash: String,
    from: String,
    to: String,
    value: String,
    tokenAddress: String,
    timestamp: Date,
    blockNumber: Number,
  },
  { collection: 'tokentransfers' }
);

// Contract schema
const contractSchema = new mongoose.Schema(
  {
    address: String,
    blockNumber: Number,
    ERC: Number,
    creationTransaction: String,
    contractName: String,
    tokenName: String,
    symbol: String,
    owner: String,
    decimals: Number,
    totalSupply: Number,
    compilerVersion: String,
    optimization: Boolean,
    sourceCode: String,
    abi: String,
    byteCode: String,
    verified: Boolean,
    verifiedAt: Date,
  },
  { collection: 'Contract' }
);

// Block schema
const blockSchema = new mongoose.Schema(
  {
    number: Number,
    hash: String,
    miner: String,
    timestamp: Date,
    transactions: Number,
    gasUsed: Number,
    gasLimit: Number,
  },
  { collection: 'blocks' }
);

const Account = mongoose.models.Account || mongoose.model('Account', accountSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
const TokenTransfer =
  mongoose.models.TokenTransfer || mongoose.model('TokenTransfer', tokenTransferSchema);
const Contract = mongoose.models.Contract || mongoose.model('Contract', contractSchema);
const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);

// Determine MetaMask-compliant transaction type
const METHOD_IDS: Record<string, { type: string; action: string }> = {
  // ERC20
  '0xa9059cbb': { type: 'token_transfer', action: 'Transfer' },
  '0x23b872dd': { type: 'token_transfer', action: 'Transfer From' },
  '0x095ea7b3': { type: 'approve', action: 'Approve' },
  '0x39509351': { type: 'approve', action: 'Increase Allowance' },
  '0xa457c2d7': { type: 'approve', action: 'Decrease Allowance' },
  // ERC721/1155
  '0x42842e0e': { type: 'nft_transfer', action: 'Safe Transfer' },
  '0xb88d4fde': { type: 'nft_transfer', action: 'Safe Transfer' },
  '0xf242432a': { type: 'nft_transfer', action: 'Safe Transfer (ERC1155)' },
  '0x2eb2c2d6': { type: 'nft_transfer', action: 'Batch Transfer (ERC1155)' },
  '0xa22cb465': { type: 'approve', action: 'Set Approval For All' },
  '0xeacabe14': { type: 'mint', action: 'Mint NFT' },
  '0x40c10f19': { type: 'mint', action: 'Mint' },
  '0x6a627842': { type: 'mint', action: 'Mint' },
  // DEX
  '0x7ff36ab5': { type: 'swap', action: 'Swap ETH for Tokens' },
  '0x18cbafe5': { type: 'swap', action: 'Swap Tokens for ETH' },
  '0x38ed1739': { type: 'swap', action: 'Swap Tokens for Tokens' },
  '0xfb3bdb41': { type: 'swap', action: 'Swap ETH for Exact Tokens' },
  '0x4a25d94a': { type: 'swap', action: 'Swap Tokens for Exact ETH' },
  '0x8803dbee': { type: 'swap', action: 'Swap Tokens for Exact Tokens' },
  '0x5c11d795': { type: 'swap', action: 'Swap Exact Tokens' },
  '0xe8e33700': { type: 'liquidity', action: 'Add Liquidity' },
  '0xf305d719': { type: 'liquidity', action: 'Add Liquidity ETH' },
  '0xbaa2abde': { type: 'liquidity', action: 'Remove Liquidity' },
  '0x02751cec': { type: 'liquidity', action: 'Remove Liquidity ETH' },
  '0xaf2979eb': { type: 'liquidity', action: 'Remove Liquidity ETH Permit' },
  // MasterChef / Staking
  '0xe2bbb158': { type: 'stake', action: 'Deposit (Stake)' },
  '0x441a3e70': { type: 'unstake', action: 'Withdraw (Unstake)' },
  '0x1058d281': { type: 'harvest', action: 'Harvest' },
  '0xddc63262': { type: 'harvest', action: 'Harvest All' },
  '0xfb12a6f5': { type: 'harvest', action: 'Harvest (Enter Staking)' },
  '0x8dbdbe6d': { type: 'harvest', action: 'Deposit' },
  '0x5312ea8e': { type: 'unstake', action: 'Emergency Withdraw' },
  // Burn
  '0x42966c68': { type: 'burn', action: 'Burn' },
  '0x79cc6790': { type: 'burn', action: 'Burn From' },
  '0x9dc29fac': { type: 'burn', action: 'Burn' },
  // Contract Creation
  '0x60806040': { type: 'contract_creation', action: 'Contract Deploy' },
};

// Function to determine the transaction type
function getTransactionType(
  tx: {
    from: string;
    to: string | null;
    value: string;
    input?: string;
    status?: number;
  },
  address: string,
  tokenTransferHashes: Set<string>,
  txHash?: string
): { type: string; action: string; direction?: 'in' | 'out' | 'self' } {
  const input = tx.input || '0x';
  const methodId = input.slice(0, 10).toLowerCase();
  const isFromAddress = tx.from.toLowerCase() === address.toLowerCase();
  const isToAddress = tx.to?.toLowerCase() === address.toLowerCase();

  // Direction
  let direction: 'in' | 'out' | 'self' = 'out';
  if (isFromAddress && isToAddress) direction = 'self';
  else if (isToAddress) direction = 'in';
  else direction = 'out';

  // Contract creation (no to address)
  if (!tx.to || tx.to === '0x0000000000000000000000000000000000000000') {
    if (tx.from.toLowerCase() === address.toLowerCase()) {
      return { type: 'contract_creation', action: 'Contract Deploy', direction: 'out' };
    }
  }

  // Check if this tx is a token transfer
  if (txHash && tokenTransferHashes.has(txHash.toLowerCase())) {
    const method = METHOD_IDS[methodId];
    if (method) {
      return { ...method, direction };
    }
    return { type: 'token_transfer', action: 'Token Transfer', direction };
  }

  // Check method ID
  const method = METHOD_IDS[methodId];
  if (method) {
    return { ...method, direction };
  }

  // Contract interaction (has input data)
  if (input && input !== '0x' && input.length > 2) {
    return { type: 'contract_interaction', action: 'Contract Interaction', direction };
  }

  // Native transfer
  const value = BigInt(tx.value || '0');
  if (value > 0n) {
    if (direction === 'in') {
      return { type: 'receive', action: 'Receive', direction };
    }
    return { type: 'send', action: 'Send', direction };
  }

  return { type: 'unknown', action: 'Unknown', direction };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`address:${clientIp}`, 60, 10);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
        {
          status: 429,
          headers: { ...getSecurityHeaders(), 'Retry-After': String(rateLimit.resetIn) },
        }
      );
    }

    await connectDB();
  } catch (dbError) {
    console.error('Database connection error:', dbError);
    return NextResponse.json(
      { error: 'Database connection failed' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }

  const { address: rawAddress } = await params;

  // Validate and sanitize address
  const address = sanitizeAddress(rawAddress);
  if (!address) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  // Get account from DB (use lowercase comparison instead of regex)
  const account = await Account.findOne({
    address: { $regex: new RegExp(`^${address}$`, 'i') },
  }).lean();

  // Get contract info
  const contract = await Contract.findOne({
    address: { $regex: new RegExp(`^${address}$`, 'i') },
  }).lean();

  // Get known contract name from config.json
  const getKnownContractName = (addr: string): { name: string; type: string } | null => {
    const lowerAddr = addr.toLowerCase();
    const cfg = config;

    // DEX contracts
    if (cfg.dex) {
      if (cfg.dex.factory?.toLowerCase() === lowerAddr)
        return { name: 'SimpleFactoryV2', type: 'DEX Factory' };
      if (cfg.dex.router?.toLowerCase() === lowerAddr)
        return { name: 'SimpleRouterV2', type: 'DEX Router' };
      if (cfg.dex.masterChef?.toLowerCase() === lowerAddr)
        return { name: 'MasterChefV2', type: 'Staking' };
      if (cfg.dex.wrappedNative?.address?.toLowerCase() === lowerAddr)
        return { name: cfg.dex.wrappedNative.name || 'WVBC', type: 'Wrapped Token' };
      if (cfg.dex.rewardToken?.address?.toLowerCase() === lowerAddr)
        return { name: cfg.dex.rewardToken.name || 'Reward Token', type: 'ERC20' };

      // DEX tokens
      if (cfg.dex.tokens) {
        for (const [, token] of Object.entries(cfg.dex.tokens)) {
          const t = token as { address?: string; name?: string; symbol?: string };
          if (t.address?.toLowerCase() === lowerAddr) {
            return { name: t.name || t.symbol || 'Token', type: 'ERC20' };
          }
        }
      }

      // LP tokens
      if (cfg.dex.lpTokens) {
        for (const [, lp] of Object.entries(cfg.dex.lpTokens)) {
          const lpToken = lp as { address?: string; name?: string; symbol?: string };
          if (lpToken.address?.toLowerCase() === lowerAddr) {
            return { name: lpToken.name || lpToken.symbol || 'LP Token', type: 'LP Token' };
          }
        }
      }
    }

    // Launchpad TokenFactory
    if (cfg.launchpad?.factoryAddress?.toLowerCase() === lowerAddr) {
      return { name: 'TokenFactory', type: 'Token Factory' };
    }

    return null;
  };

  // Check contract code via Web3 (determine whether it is a contract even if not in DB)
  let isContract = false;
  let contractCode = '0x';
  try {
    contractCode = await web3.eth.getCode(address);
    isContract = Boolean(contractCode && contractCode !== '0x' && contractCode !== '0x0');
  } catch {
    // ignore
  }

  // Get real-time balance from Web3 (display only)
  let realBalance = '0';
  try {
    const balanceWei = await web3.eth.getBalance(address);
    // Convert BigInt to string
    realBalance = balanceWei.toString();
  } catch {
    // ignore
  }

  // Get totalSupply from lib/supply.ts (returns native currency unit, e.g., VBC)
  // Multiply by 1e18 to convert to wei for percentage calculation
  const totalSupplyNative = await calculateTotalSupply();
  const totalSupplyWei = totalSupplyNative * 1e18;

  // Calculate percentage dynamically
  let percent = 0;
  if (totalSupplyWei > 0) {
    percent = (parseFloat(realBalance) / totalSupplyWei) * 100;
  }

  // Use the DB values for percentage/rank as-is (return 0 when null)
  let rank = null;
  if (Array.isArray(account)) {
    rank = account[0]?.rank ?? null;
  } else {
    rank = account?.rank ?? null;
  }

  // Get transaction info (fetch more transactions to classify them)
  const allTransactions = await Transaction.find({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
  })
    .sort({ timestamp: -1 })
    .limit(50); // fetch more transactions

  // Classify regular transactions and mining rewards
  const regularTransactions = allTransactions.filter(
    (tx) =>
      tx.from !== '0x0000000000000000000000000000000000000000' &&
      tx.to !== '0x0000000000000000000000000000000000000000'
  );

  // Transactions for display (regular transactions only, up to 10)
  const displayTransactions = regularTransactions.slice(0, 10);

  // Get the regular transaction count (excluding system addresses)
  const regularTransactionCount = await Transaction.countDocuments({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
    $and: [
      { from: { $ne: '0x0000000000000000000000000000000000000000' } },
      { to: { $ne: '0x0000000000000000000000000000000000000000' } },
    ],
  });

  // Get the total transaction count
  const transactionCount = await Transaction.countDocuments({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
  });

  // Get the number of mined blocks
  const blocksMined = await Block.countDocuments({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  });

  // Time formatting function (supports Unix timestamps)
  const getTimeAgo = (timestamp: Date | number | null): string => {
    if (!timestamp) return 'Unknown';

    let targetTime: Date;
    if (typeof timestamp === 'number') {
      // Unix timestamp case (in seconds)
      targetTime = new Date(timestamp * 1000);
    } else if (timestamp instanceof Date) {
      targetTime = timestamp;
    } else {
      targetTime = new Date(timestamp);
    }

    const now = new Date();
    const diff = now.getTime() - targetTime.getTime();

    // Treat negative values (future dates) as 0
    if (diff < 0) return 'just now';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
  };

  // Date formatting function
  const formatDate = (timestamp: Date | number | null): string => {
    if (!timestamp) return 'Unknown';

    let targetTime: Date;
    if (typeof timestamp === 'number') {
      targetTime = new Date(timestamp * 1000);
    } else if (timestamp instanceof Date) {
      targetTime = timestamp;
    } else {
      targetTime = new Date(timestamp);
    }

    return targetTime.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  // Calculate mining rewards (block reward + gas fees)
  const minedBlocks = await Block.find({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  })
    .sort({ timestamp: -1 })
    .limit(10);

  // Generate mining reward transactions
  const miningRewards = await Promise.all(
    minedBlocks.map(async (block) => {
      try {
        // Get block info from Web3
        const blockInfo = await web3.eth.getBlock(block.number, true);

        // Calculate the actual reward
        let actualReward = 0;

        // 1. Block reward (fixed at 8 VBC)
        const blockReward = 8;

        // 2. Calculate gas fees (from all transactions in the block)
        let totalGasFees = 0;
        if (blockInfo.transactions && blockInfo.transactions.length > 0) {
          for (const tx of blockInfo.transactions) {
            // Type guard: check that tx is an object with gasPrice and gasUsed properties
            if (typeof tx === 'object' && tx !== null && 'gasPrice' in tx && 'gasUsed' in tx) {
              const txObj = tx as { gasPrice?: bigint; gasUsed?: bigint };
              if (typeof txObj.gasPrice === 'bigint' && typeof txObj.gasUsed === 'bigint') {
                const gasFee = (Number(txObj.gasUsed) * Number(txObj.gasPrice)) / 1e18;
                totalGasFees += gasFee;
              }
            }
          }
        }

        // 3. Get the actual balance change
        try {
          if (block.number > 0) {
            const balanceBefore = await web3.eth.getBalance(address, block.number - 1);
            const balanceAfter = await web3.eth.getBalance(address, block.number);
            const balanceChange = (Number(balanceAfter) - Number(balanceBefore)) / 1e18;

            // If the balance change is positive, use it as the actual reward
            if (balanceChange > 0) {
              actualReward = balanceChange;
            } else {
              // If the balance change is <= 0, use the sum of block reward and gas fees
              actualReward = blockReward + totalGasFees;
            }
          } else {
            // Genesis block case
            actualReward = blockReward + totalGasFees;
          }
        } catch {
          // If fetching the balance fails, use the calculated value
          actualReward = blockReward + totalGasFees;
        }

        return {
          hash: block.hash,
          from: '0x0000000000000000000000000000000000000000',
          to: address,
          value: actualReward.toFixed(8),
          timestamp: block.timestamp,
          timeAgo: getTimeAgo(block.timestamp),
          blockNumber: block.number,
          type: 'mining_reward',
          status: 'success',
          details: {
            blockReward: blockReward,
            gasFees: totalGasFees.toFixed(8),
            totalReward: actualReward.toFixed(8),
          },
        };
      } catch {
        // Fallback: use a fixed reward
        return {
          hash: block.hash,
          from: '0x0000000000000000000000000000000000000000',
          to: address,
          value: '8.00000000', // fixed reward
          timestamp: block.timestamp,
          timeAgo: getTimeAgo(block.timestamp),
          blockNumber: block.number,
          type: 'mining_reward',
          status: 'success',
          details: {
            blockReward: 8,
            gasFees: '0.00000000',
            totalReward: '8.00000000',
          },
        };
      }
    })
  );

  // Get the first and last transactions (regular transactions)
  const firstTx = await Transaction.findOne({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
  }).sort({ timestamp: 1 });

  const lastTx = await Transaction.findOne({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
  }).sort({ timestamp: -1 });

  // Get the first and last mining rewards
  const firstMiningBlock = await Block.findOne({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  }).sort({ timestamp: 1 });

  const lastMiningBlock = await Block.findOne({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  }).sort({ timestamp: -1 });

  // Determine the first activity time (the earlier of regular transactions and mining)
  let firstActivity = firstTx?.timestamp;
  if (firstMiningBlock?.timestamp) {
    if (!firstActivity || firstMiningBlock.timestamp < firstActivity) {
      firstActivity = firstMiningBlock.timestamp;
    }
  }

  // Determine the last activity time (the later of regular transactions and mining)
  let lastActivity = lastTx?.timestamp;
  if (lastMiningBlock?.timestamp) {
    if (!lastActivity || lastMiningBlock.timestamp > lastActivity) {
      lastActivity = lastMiningBlock.timestamp;
    }
  }

  // Also fetch TokenTransfers (direct DB access)
  const db = tryGetDb();
  const tokenTransfers = db
    ? await db
        .collection('tokentransfers')
        .find({
          $or: [
            { from: { $regex: new RegExp(`^${address}$`, 'i') } },
            { to: { $regex: new RegExp(`^${address}$`, 'i') } },
          ],
        })
        .sort({ timestamp: -1 })
        .limit(50)
        .toArray()
    : [];

  // Get the token transfer count
  const tokenTransferCount = db
    ? await db.collection('tokentransfers').countDocuments({
        $or: [
          { from: { $regex: new RegExp(`^${address}$`, 'i') } },
          { to: { $regex: new RegExp(`^${address}$`, 'i') } },
        ],
      })
    : 0;

  // Build a map of token info (for speed)
  const tokenAddresses = [
    ...new Set(tokenTransfers.map((t) => (t as Record<string, unknown>).tokenAddress as string)),
  ].filter(Boolean);
  const tokenInfoMap = new Map<
    string,
    { name: string; symbol: string; decimals: number; type: string }
  >();

  if (db && tokenAddresses.length > 0) {
    // Search by the address field (matching the tokens collection structure)
    const tokens = await db
      .collection('tokens')
      .find({
        address: { $in: tokenAddresses.map((a) => new RegExp(`^${a}$`, 'i')) },
      })
      .toArray();

    for (const token of tokens) {
      const t = token as Record<string, unknown>;
      const addr = ((t.address as string) || '').toLowerCase();
      if (addr) {
        tokenInfoMap.set(addr, {
          name: (t.name as string) || 'Unknown Token',
          symbol: (t.symbol as string) || '???',
          // Use nullish coalescing to handle decimals=0 correctly
          decimals: (t.decimals as number) ?? 18,
          type: (t.type as string) || 'VRC-20',
        });
      }
    }
  }

  // Balance formatting function (convert Wei to VBC)
  const formatBalance = (balance: string) => {
    try {
      // Use BigInt to preserve precision
      const weiValue = BigInt(balance);
      // Convert Wei to VBC (18 digits)
      const wholePart = weiValue / BigInt(10 ** 18);
      const fractionalPart = weiValue % BigInt(10 ** 18);

      // Convert the fractional part to a string and pad it
      const fractionalStr = fractionalPart.toString().padStart(18, '0');
      // Remove trailing zeros (keep at least 2 digits)
      const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0').slice(0, 8);

      const result = `${wholePart.toLocaleString()}.${trimmedFractional}`;
      return result;
    } catch {
      return balance;
    }
  };

  // Transaction value format function
  const formatTransactionValue = (value: string) => {
    try {
      const numValue = parseFloat(value);
      // Convert from Wei to native currency
      const nativeValue = numValue / 1000000000000000000;
      return nativeValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8,
      });
    } catch {
      return value;
    }
  };

  // Collect token transfer transaction hashes (for type detection)
  const tokenTxHashes = new Set(
    tokenTransfers.map((tx) =>
      String((tx as Record<string, unknown>).transactionHash || '').toLowerCase()
    )
  );

  // Map token transfer info by hash
  const tokenTransferMap = new Map<string, Array<Record<string, unknown>>>();
  for (const tt of tokenTransfers) {
    const t = tt as Record<string, unknown>;
    const hash = String(t.transactionHash || '').toLowerCase();
    if (!tokenTransferMap.has(hash)) {
      tokenTransferMap.set(hash, []);
    }
    tokenTransferMap.get(hash)!.push(t);
  }

  // Build a MetaMask-compliant transaction list
  interface FormattedTransaction {
    hash: string;
    from: string;
    to: string;
    value: string;
    valueRaw: string;
    timestamp: number | Date;
    timeAgo: string;
    blockNumber: number;
    type: string;
    action: string;
    direction: 'in' | 'out' | 'self';
    status: string;
    gasUsed?: number;
    gasPrice?: string;
    input?: string;
    tokenInfo?: {
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      type: string;
      value: string;
      tokenId?: number;
    };
    tokenTransfers?: Array<{
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      type: string;
      value: string;
      tokenId?: number;
      from: string;
      to: string;
      direction: 'in' | 'out';
    }>;
    nftInfo?: {
      tokenId: number;
      tokenAddress: string;
    };
  }

  const allTxs: FormattedTransaction[] = [];
  const processedHashes = new Set<string>();

  // 1. Process all transactions (regular transactions)
  for (const tx of displayTransactions) {
    const txData = tx as Record<string, unknown>;
    const hash = String(txData.hash || '').toLowerCase();
    if (processedHashes.has(hash)) continue;
    processedHashes.add(hash);

    const txType = getTransactionType(
      {
        from: txData.from as string,
        to: txData.to as string | null,
        value: txData.value as string,
        input: txData.input as string | undefined,
        status: txData.status as number | undefined,
      },
      address,
      tokenTxHashes,
      hash
    );

    const formatted: FormattedTransaction = {
      hash: txData.hash as string,
      from: txData.from as string,
      to: txData.to as string,
      value: formatTransactionValue(txData.value as string),
      valueRaw: txData.value as string,
      timestamp: txData.timestamp as number,
      timeAgo: getTimeAgo(txData.timestamp as number),
      blockNumber: txData.blockNumber as number,
      type: txType.type,
      action: txType.action,
      direction: txType.direction || 'out',
      status: (txData.status as number) === 1 ? 'success' : 'failed',
      gasUsed: txData.gasUsed as number | undefined,
      gasPrice: txData.gasPrice as string | undefined,
      input: txData.input as string | undefined,
    };

    // Add token transfer info if present
    const tokenTransfersForTx = tokenTransferMap.get(hash);
    if (tokenTransfersForTx && tokenTransfersForTx.length > 0) {
      // Prioritize transfers related to this address
      const addressLower = address.toLowerCase();

      // Show incoming (in) transfers first
      const incomingTransfer = tokenTransfersForTx.find(
        (t) => (t.to as string).toLowerCase() === addressLower
      );
      const outgoingTransfer = tokenTransfersForTx.find(
        (t) => (t.from as string).toLowerCase() === addressLower
      );

      // Prefer incoming; otherwise show outgoing
      const primaryTransfer = incomingTransfer || outgoingTransfer || tokenTransfersForTx[0];
      const tt = primaryTransfer;
      const tokenAddr = (tt.tokenAddress as string).toLowerCase();
      const tokenInfo = tokenInfoMap.get(tokenAddr);

      formatted.tokenInfo = {
        address: tt.tokenAddress as string,
        name: tokenInfo?.name || 'Unknown Token',
        symbol: tokenInfo?.symbol || '???',
        decimals: tokenInfo?.decimals ?? 18,
        type: tokenInfo?.type || 'VRC-20',
        value: tt.value as string,
        tokenId: tt.tokenId as number | undefined,
      };

      // Add all token transfer info
      formatted.tokenTransfers = tokenTransfersForTx.map((t) => {
        const addr = (t.tokenAddress as string).toLowerCase();
        const info = tokenInfoMap.get(addr);
        const isIncoming = (t.to as string).toLowerCase() === addressLower;
        return {
          address: t.tokenAddress as string,
          name: info?.name || 'Unknown Token',
          symbol: info?.symbol || '???',
          decimals: info?.decimals ?? 18,
          type: info?.type || 'VRC-20',
          value: t.value as string,
          tokenId: t.tokenId as number | undefined,
          from: t.from as string,
          to: t.to as string,
          direction: isIncoming ? 'in' : 'out',
        };
      });

      // NFT case
      if (tt.tokenId !== undefined && tt.tokenId !== null) {
        formatted.nftInfo = {
          tokenId: tt.tokenId as number,
          tokenAddress: tt.tokenAddress as string,
        };
        formatted.type = 'nft_transfer';
        formatted.action = txType.action === 'Transfer' ? 'NFT Transfer' : txType.action;
      }
    }

    allTxs.push(formatted);
  }

  // 2. Add token transfers that have not been processed yet
  for (const tt of tokenTransfers) {
    const t = tt as Record<string, unknown>;
    const hash = String(t.transactionHash || '').toLowerCase();
    if (processedHashes.has(hash)) continue;
    processedHashes.add(hash);

    const isFromAddress = (t.from as string).toLowerCase() === address.toLowerCase();
    const isToAddress = (t.to as string).toLowerCase() === address.toLowerCase();
    let direction: 'in' | 'out' | 'self' = 'out';
    if (isFromAddress && isToAddress) direction = 'self';
    else if (isToAddress) direction = 'in';

    const tokenAddr = (t.tokenAddress as string).toLowerCase();
    const tokenInfo = tokenInfoMap.get(tokenAddr);

    const isNFT = t.tokenId !== undefined && t.tokenId !== null;
    const type = isNFT ? 'nft_transfer' : 'token_transfer';
    const action = isNFT ? 'NFT Transfer' : 'Token Transfer';

    // Normalize timestamp to Unix seconds for consistency
    let normalizedTimestamp: number;
    const rawTimestamp = t.timestamp;
    if (rawTimestamp instanceof Date) {
      normalizedTimestamp = Math.floor(rawTimestamp.getTime() / 1000);
    } else if (typeof rawTimestamp === 'string') {
      normalizedTimestamp = Math.floor(new Date(rawTimestamp).getTime() / 1000);
    } else if (typeof rawTimestamp === 'number') {
      // Already Unix timestamp
      normalizedTimestamp = rawTimestamp;
    } else {
      normalizedTimestamp = Math.floor(Date.now() / 1000);
    }

    const formatted: FormattedTransaction = {
      hash: t.transactionHash as string,
      from: t.from as string,
      to: t.to as string,
      value: '0',
      valueRaw: '0',
      timestamp: normalizedTimestamp,
      timeAgo: getTimeAgo(normalizedTimestamp),
      blockNumber: t.blockNumber as number,
      type,
      action,
      direction,
      status: 'success',
      tokenInfo: {
        address: t.tokenAddress as string,
        name: tokenInfo?.name || 'Unknown Token',
        symbol: tokenInfo?.symbol || '???',
        decimals: tokenInfo?.decimals ?? 18,
        type: tokenInfo?.type || 'VRC-20',
        value: t.value as string,
        tokenId: t.tokenId as number | undefined,
      },
    };

    if (isNFT) {
      formatted.nftInfo = {
        tokenId: t.tokenId as number,
        tokenAddress: t.tokenAddress as string,
      };
    }

    allTxs.push(formatted);
  }

  // 3. Add mining rewards
  for (const tx of miningRewards.slice(0, 10)) {
    const hash = tx.hash?.toLowerCase();
    if (hash && processedHashes.has(hash)) continue;
    if (hash) processedHashes.add(hash);

    allTxs.push({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      valueRaw: '0',
      timestamp: tx.timestamp,
      timeAgo: tx.timeAgo,
      blockNumber: tx.blockNumber,
      type: 'mining_reward',
      action: 'Block Reward',
      direction: 'in',
      status: tx.status || 'success',
    });
  }

  // Sort by timestamp
  allTxs.sort((a, b) => {
    const timeA =
      typeof a.timestamp === 'number' ? a.timestamp * 1000 : new Date(a.timestamp).getTime();
    const timeB =
      typeof b.timestamp === 'number' ? b.timestamp * 1000 : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  // If contract is an array, use the first element
  const contractObj = Array.isArray(contract) ? contract[0] : contract;

  // Build contract info (use DB info when available, otherwise use info fetched from the blockchain)
  let contractInfo = null;
  if (contractObj) {
    contractInfo = {
      address: contractObj.address,
      name: contractObj.contractName || contractObj.tokenName || 'Unknown Contract',
      symbol: contractObj.symbol || '',
      type: contractObj.ERC === 2 ? 'ERC20' : contractObj.ERC === 3 ? 'ERC223' : 'Contract',
      decimals: contractObj.decimals || 0,
      totalSupply: contractObj.totalSupply || 0,
      verified: contractObj.verified || false,
      creationTransaction: contractObj.creationTransaction || '',
      blockNumber: contractObj.blockNumber || 0,
      creator: contractObj.owner || '',
      isContract: true,
    };
  } else if (isContract) {
    // If not in DB but is a contract, get the known name from config.json
    const knownContract = getKnownContractName(address);
    contractInfo = {
      address: address,
      name: knownContract?.name || 'Unverified Contract',
      symbol: '',
      type: knownContract?.type || 'Contract',
      decimals: 0,
      totalSupply: 0,
      verified: false,
      creationTransaction: '',
      blockNumber: 0,
      creator: '',
      isContract: true,
      bytecodeSize: Math.floor((contractCode.length - 2) / 2), // bytecode size (in bytes)
      knownContract: knownContract !== null, // whether it is a known contract in config.json
    };
  }

  return NextResponse.json({
    account: {
      address,
      balance: formatBalance(realBalance), // for display (formatted)
      balanceRaw: realBalance, // raw value
      percentage: percent.toFixed(4), // dynamically calculated value
      rank, // DB value as-is
      transactionCount: transactionCount || 0,
      blocksMined: blocksMined || 0,
      tokenTransferCount: tokenTransferCount || 0,
      firstSeen: firstActivity
        ? `${formatDate(firstActivity)} (${getTimeAgo(firstActivity)})`
        : 'Unknown',
      lastActivity: lastActivity
        ? `${formatDate(lastActivity)} (${getTimeAgo(lastActivity)})`
        : 'Unknown',
    },
    contract: contractInfo,
    transactions: allTxs,
    // Add classification info
    transactionStats: {
      regularCount: regularTransactionCount || 0, // use the actual regular transaction count
      miningCount: blocksMined || 0, // use the actual mined block count
      totalCount: (regularTransactionCount || 0) + (blocksMined || 0),
    },
  });
}
