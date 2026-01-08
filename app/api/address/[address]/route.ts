import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../models/index';
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

// TokenTransferスキーマも定義
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

// MetaMask準拠のトランザクションタイプを判定
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

// トランザクションタイプを判定する関数
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

  // DBからアカウント取得 (use lowercase comparison instead of regex)
  const account = await Account.findOne({
    address: { $regex: new RegExp(`^${address}$`, 'i') },
  }).lean();

  // コントラクト情報を取得
  const contract = await Contract.findOne({
    address: { $regex: new RegExp(`^${address}$`, 'i') },
  }).lean();

  // config.jsonから既知のコントラクト名を取得
  const getKnownContractName = (addr: string): { name: string; type: string } | null => {
    const lowerAddr = addr.toLowerCase();
    const cfg = config;

    // DEXコントラクト
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

      // DEXトークン
      if (cfg.dex.tokens) {
        for (const [, token] of Object.entries(cfg.dex.tokens)) {
          const t = token as { address?: string; name?: string; symbol?: string };
          if (t.address?.toLowerCase() === lowerAddr) {
            return { name: t.name || t.symbol || 'Token', type: 'ERC20' };
          }
        }
      }

      // LPトークン
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

  // Web3でコントラクトコードを確認（DBにない場合でもコントラクトかどうか判定）
  let isContract = false;
  let contractCode = '0x';
  try {
    contractCode = await web3.eth.getCode(address);
    isContract = Boolean(contractCode && contractCode !== '0x' && contractCode !== '0x0');
  } catch {
    // ignore
  }

  // Web3からリアルタイムバランス取得（表示用のみ）
  let realBalance = '0';
  try {
    const balanceWei = await web3.eth.getBalance(address);
    // BigIntを文字列に変換
    realBalance = balanceWei.toString();
  } catch {
    // ignore
  }

  // Get totalSupply from lib/supply.ts (returns native currency unit, e.g., VBC)
  // Multiply by 1e18 to convert to wei for percentage calculation
  const totalSupplyNative = await calculateTotalSupply();
  const totalSupplyWei = totalSupplyNative * 1e18;

  // percentageを動的に計算
  let percent = 0;
  if (totalSupplyWei > 0) {
    percent = (parseFloat(realBalance) / totalSupplyWei) * 100;
  }

  // percentage/rankはDBの値をそのまま使う（nullの場合は0を返す）
  let rank = null;
  if (Array.isArray(account)) {
    rank = account[0]?.rank ?? null;
  } else {
    rank = account?.rank ?? null;
  }

  // トランザクション情報を取得（より多くのトランザクションを取得して分類）
  const allTransactions = await Transaction.find({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
  })
    .sort({ timestamp: -1 })
    .limit(50); // より多くのトランザクションを取得

  // 通常のトランザクションとマイニング報酬を分類
  const regularTransactions = allTransactions.filter(
    (tx) =>
      tx.from !== '0x0000000000000000000000000000000000000000' &&
      tx.to !== '0x0000000000000000000000000000000000000000'
  );

  // 表示用のトランザクション（通常のトランザクションのみ、最大10件）
  const displayTransactions = regularTransactions.slice(0, 10);

  // 通常のトランザクション数を取得（システムアドレス以外）
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

  // 全トランザクション数を取得
  const transactionCount = await Transaction.countDocuments({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } },
    ],
  });

  // 採掘したブロック数を取得
  const blocksMined = await Block.countDocuments({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  });

  // 時間フォーマット関数（Unix timestamp対応）
  const getTimeAgo = (timestamp: Date | number | null): string => {
    if (!timestamp) return 'Unknown';

    let targetTime: Date;
    if (typeof timestamp === 'number') {
      // Unix timestampの場合（秒単位）
      targetTime = new Date(timestamp * 1000);
    } else if (timestamp instanceof Date) {
      targetTime = timestamp;
    } else {
      targetTime = new Date(timestamp);
    }

    const now = new Date();
    const diff = now.getTime() - targetTime.getTime();

    // 負の値の場合（未来の日付）は0として扱う
    if (diff < 0) return 'just now';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
  };

  // 日付フォーマット関数
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

  // マイニング報酬を計算（ブロック報酬 + ガス料金）
  const minedBlocks = await Block.find({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  })
    .sort({ timestamp: -1 })
    .limit(10);

  // マイニング報酬トランザクションを生成
  const miningRewards = await Promise.all(
    minedBlocks.map(async (block) => {
      try {
        // Web3からブロック情報を取得
        const blockInfo = await web3.eth.getBlock(block.number, true);

        // 実際の報酬を計算
        let actualReward = 0;

        // 1. ブロック報酬（8 VBC固定）
        const blockReward = 8;

        // 2. ガス料金の計算（ブロック内の全トランザクションから）
        let totalGasFees = 0;
        if (blockInfo.transactions && blockInfo.transactions.length > 0) {
          for (const tx of blockInfo.transactions) {
            // 型ガード: txがオブジェクトでgasPriceとgasUsedプロパティを持つかチェック
            if (typeof tx === 'object' && tx !== null && 'gasPrice' in tx && 'gasUsed' in tx) {
              const txObj = tx as { gasPrice?: bigint; gasUsed?: bigint };
              if (typeof txObj.gasPrice === 'bigint' && typeof txObj.gasUsed === 'bigint') {
                const gasFee = (Number(txObj.gasUsed) * Number(txObj.gasPrice)) / 1e18;
                totalGasFees += gasFee;
              }
            }
          }
        }

        // 3. 実際のバランス変化を取得
        try {
          if (block.number > 0) {
            const balanceBefore = await web3.eth.getBalance(address, block.number - 1);
            const balanceAfter = await web3.eth.getBalance(address, block.number);
            const balanceChange = (Number(balanceAfter) - Number(balanceBefore)) / 1e18;

            // バランス変化が正の値の場合、それを実際の報酬として使用
            if (balanceChange > 0) {
              actualReward = balanceChange;
            } else {
              // バランス変化が0以下の場合、ブロック報酬とガス料金の合計を使用
              actualReward = blockReward + totalGasFees;
            }
          } else {
            // ジェネシスブロックの場合
            actualReward = blockReward + totalGasFees;
          }
        } catch {
          // バランス取得に失敗した場合は計算値を使用
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
        // フォールバック: 固定報酬を使用
        return {
          hash: block.hash,
          from: '0x0000000000000000000000000000000000000000',
          to: address,
          value: '8.00000000', // 固定報酬
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

  // 最初と最後のトランザクションを取得（通常のトランザクション）
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

  // マイニング報酬の最初と最後を取得
  const firstMiningBlock = await Block.findOne({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  }).sort({ timestamp: 1 });

  const lastMiningBlock = await Block.findOne({
    miner: { $regex: new RegExp(`^${address}$`, 'i') },
  }).sort({ timestamp: -1 });

  // 最初の活動日時を決定（通常のトランザクションとマイニングの早い方）
  let firstActivity = firstTx?.timestamp;
  if (firstMiningBlock?.timestamp) {
    if (!firstActivity || firstMiningBlock.timestamp < firstActivity) {
      firstActivity = firstMiningBlock.timestamp;
    }
  }

  // 最後の活動日時を決定（通常のトランザクションとマイニングの遅い方）
  let lastActivity = lastTx?.timestamp;
  if (lastMiningBlock?.timestamp) {
    if (!lastActivity || lastMiningBlock.timestamp > lastActivity) {
      lastActivity = lastMiningBlock.timestamp;
    }
  }

  // TokenTransferも取得（直接DBアクセス）
  const db = mongoose.connection.db;
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

  // トークン転送数を取得
  const tokenTransferCount = db
    ? await db.collection('tokentransfers').countDocuments({
        $or: [
          { from: { $regex: new RegExp(`^${address}$`, 'i') } },
          { to: { $regex: new RegExp(`^${address}$`, 'i') } },
        ],
      })
    : 0;

  // トークン情報のマップを作成（高速化のため）
  const tokenAddresses = [
    ...new Set(tokenTransfers.map((t) => (t as Record<string, unknown>).tokenAddress as string)),
  ].filter(Boolean);
  const tokenInfoMap = new Map<
    string,
    { name: string; symbol: string; decimals: number; type: string }
  >();

  if (db && tokenAddresses.length > 0) {
    // addressフィールドで検索（tokensコレクションの構造に合わせる）
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

  // バランスフォーマット関数（WeiからVBCに変換）
  const formatBalance = (balance: string) => {
    try {
      const numValue = parseFloat(balance);
      // WeiからVBCに変換（18桁）
      if (numValue > 1000000000000000000) {
        return (numValue / 1000000000000000000).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 8,
        });
      }
      return numValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8,
      });
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

  // トークン転送のトランザクションハッシュを収集（タイプ判定用）
  const tokenTxHashes = new Set(
    tokenTransfers.map((tx) =>
      String((tx as Record<string, unknown>).transactionHash || '').toLowerCase()
    )
  );

  // トークントランスファー情報をハッシュでマップ化
  const tokenTransferMap = new Map<string, Array<Record<string, unknown>>>();
  for (const tt of tokenTransfers) {
    const t = tt as Record<string, unknown>;
    const hash = String(t.transactionHash || '').toLowerCase();
    if (!tokenTransferMap.has(hash)) {
      tokenTransferMap.set(hash, []);
    }
    tokenTransferMap.get(hash)!.push(t);
  }

  // MetaMask準拠のトランザクションリストを構築
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

  // 1. 全トランザクションを処理（通常トランザクション）
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

    // トークン転送情報があれば追加
    const tokenTransfersForTx = tokenTransferMap.get(hash);
    if (tokenTransfersForTx && tokenTransfersForTx.length > 0) {
      // このアドレスに関連する転送を優先
      const addressLower = address.toLowerCase();

      // 受け取り（in）を優先的に表示
      const incomingTransfer = tokenTransfersForTx.find(
        (t) => (t.to as string).toLowerCase() === addressLower
      );
      const outgoingTransfer = tokenTransfersForTx.find(
        (t) => (t.from as string).toLowerCase() === addressLower
      );

      // 受け取りを優先、なければ送金を表示
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

      // 全てのトークン転送情報を追加
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

      // NFTの場合
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

  // 2. トークントランスファーで、まだ処理されていないものを追加
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

  // 3. マイニング報酬を追加
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

  // タイムスタンプでソート
  allTxs.sort((a, b) => {
    const timeA =
      typeof a.timestamp === 'number' ? a.timestamp * 1000 : new Date(a.timestamp).getTime();
    const timeB =
      typeof b.timestamp === 'number' ? b.timestamp * 1000 : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  // contractが配列の場合は最初の要素を使う
  const contractObj = Array.isArray(contract) ? contract[0] : contract;

  // コントラクト情報を構築（DBにある場合はDB情報を使用、ない場合はブロックチェーンから取得した情報を使用）
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
    // DBにないがコントラクトの場合、config.jsonから既知の名前を取得
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
      bytecodeSize: Math.floor((contractCode.length - 2) / 2), // バイトコードサイズ（バイト単位）
      knownContract: knownContract !== null, // config.jsonで既知のコントラクトかどうか
    };
  }

  return NextResponse.json({
    account: {
      address,
      balance: formatBalance(realBalance), // 表示用（フォーマット済み）
      balanceRaw: realBalance, // 生の値
      percentage: percent.toFixed(4), // 動的計算値
      rank, // DB値そのまま
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
    // 分類情報を追加
    transactionStats: {
      regularCount: regularTransactionCount || 0, // 実際の通常トランザクション数を使用
      miningCount: blocksMined || 0, // 実際のマイニングブロック数を使用
      totalCount: (regularTransactionCount || 0) + (blocksMined || 0),
    },
  });
}
