import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { connectDB } from '../../../../models/index';
import fs from 'fs';
import path from 'path';

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
  
  // Default configuration
  return {
    nodeAddr: 'localhost',
    port: 8329
  };
};

// Account schema
const accountSchema = new mongoose.Schema({
  address: String,
  balance: String,
  percentage: Number,
  rank: Number,
  type: Number,
  blockNumber: Number
}, { collection: 'Account' });

// Transaction schema
const transactionSchema = new mongoose.Schema({
  hash: String,
  from: String,
  to: String,
  value: String,
  timestamp: Date,
  blockNumber: Number
}, { collection: 'transactions' });

// TokenTransferスキーマも定義
const tokenTransferSchema = new mongoose.Schema({
  transactionHash: String,
  from: String,
  to: String,
  value: String,
  tokenAddress: String,
  timestamp: Date,
  blockNumber: Number
}, { collection: 'tokentransfers' });

// Contract schema
const contractSchema = new mongoose.Schema({
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
  verifiedAt: Date
}, { collection: 'Contract' });

// Block schema
const blockSchema = new mongoose.Schema({
  number: Number,
  hash: String,
  miner: String,
  timestamp: Date,
  transactions: Number,
  gasUsed: Number,
  gasLimit: Number
}, { collection: 'blocks' });

const Account = mongoose.models.Account || mongoose.model('Account', accountSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
const TokenTransfer = mongoose.models.TokenTransfer || mongoose.model('TokenTransfer', tokenTransferSchema);
const Contract = mongoose.models.Contract || mongoose.model('Contract', contractSchema);
const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);

const config = readConfig();
const web3 = new Web3(new Web3.providers.HttpProvider(`http://${config.nodeAddr}:${config.port}`));


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    await connectDB();
  } catch (dbError) {
    console.error('Database connection error:', dbError);
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
  }
  
  const { address } = await params;

  // DBからアカウント取得
  const account = await Account.findOne({ address: { $regex: new RegExp(`^${address}$`, 'i') } }).lean();

  // コントラクト情報を取得
  const contract = await Contract.findOne({ address: { $regex: new RegExp(`^${address}$`, 'i') } }).lean();

  // config.jsonから既知のコントラクト名を取得
  const getKnownContractName = (addr: string): { name: string; type: string } | null => {
    const lowerAddr = addr.toLowerCase();
    const cfg = config;
    
    // DEXコントラクト
    if (cfg.dex) {
      if (cfg.dex.factory?.toLowerCase() === lowerAddr) return { name: 'SimpleFactoryV2', type: 'DEX Factory' };
      if (cfg.dex.router?.toLowerCase() === lowerAddr) return { name: 'SimpleRouterV2', type: 'DEX Router' };
      if (cfg.dex.masterChef?.toLowerCase() === lowerAddr) return { name: 'MasterChefV2', type: 'Staking' };
      if (cfg.dex.wrappedNative?.address?.toLowerCase() === lowerAddr) return { name: cfg.dex.wrappedNative.name || 'WVBC', type: 'Wrapped Token' };
      if (cfg.dex.rewardToken?.address?.toLowerCase() === lowerAddr) return { name: cfg.dex.rewardToken.name || 'Reward Token', type: 'ERC20' };
      
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

  // 全アカウントのリアルタイムバランス合計を取得
  const allAccounts = await Account.find({});
  const totalBalance = allAccounts.reduce((sum, acc) => {
    let b = acc.balance || '0';
    if (typeof b !== 'string') b = b.toString();
    return sum + parseFloat(b);
  }, 0);

  // percentageを動的に計算
  let percent = 0;
  if (totalBalance > 0) {
    percent = (parseFloat(realBalance) / totalBalance) * 100;
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
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ]
  })
    .sort({ timestamp: -1 })
    .limit(50); // より多くのトランザクションを取得

  // 通常のトランザクションとマイニング報酬を分類
  const regularTransactions = allTransactions.filter(tx => 
    tx.from !== '0x0000000000000000000000000000000000000000' && 
    tx.to !== '0x0000000000000000000000000000000000000000'
  );



  // 表示用のトランザクション（通常のトランザクションのみ、最大10件）
  const displayTransactions = regularTransactions.slice(0, 10);

  // 通常のトランザクション数を取得（システムアドレス以外）
  const regularTransactionCount = await Transaction.countDocuments({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ],
    $and: [
      { from: { $ne: '0x0000000000000000000000000000000000000000' } },
      { to: { $ne: '0x0000000000000000000000000000000000000000' } }
    ]
  });

  // 全トランザクション数を取得
  const transactionCount = await Transaction.countDocuments({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ]
  });

  // 採掘したブロック数を取得
  const blocksMined = await Block.countDocuments({
    miner: { $regex: new RegExp(`^${address}$`, 'i') }
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
    miner: { $regex: new RegExp(`^${address}$`, 'i') }
  }).sort({ timestamp: -1 }).limit(10);

  // マイニング報酬トランザクションを生成
  const miningRewards = await Promise.all(minedBlocks.map(async (block) => {
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
              const gasFee = Number(txObj.gasUsed) * Number(txObj.gasPrice) / 1e18;
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
          totalReward: actualReward.toFixed(8)
        }
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
          totalReward: '8.00000000'
        }
      };
    }
  }));

  // 最初と最後のトランザクションを取得（通常のトランザクション）
  const firstTx = await Transaction.findOne({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ]
  }).sort({ timestamp: 1 });

  const lastTx = await Transaction.findOne({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ]
  }).sort({ timestamp: -1 });

  // マイニング報酬の最初と最後を取得
  const firstMiningBlock = await Block.findOne({
    miner: { $regex: new RegExp(`^${address}$`, 'i') }
  }).sort({ timestamp: 1 });

  const lastMiningBlock = await Block.findOne({
    miner: { $regex: new RegExp(`^${address}$`, 'i') }
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

  // TokenTransferも取得
  const tokenTransfers = await TokenTransfer.find({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ]
  }).sort({ timestamp: -1 }).limit(10);

  // トークン転送数を取得
  const tokenTransferCount = await TokenTransfer.countDocuments({
    $or: [
      { from: { $regex: new RegExp(`^${address}$`, 'i') } },
      { to: { $regex: new RegExp(`^${address}$`, 'i') } }
    ]
  });



  // バランスフォーマット関数（WeiからVBCに変換）
  const formatBalance = (balance: string) => {
    try {
      const numValue = parseFloat(balance);
      // WeiからVBCに変換（18桁）
      if (numValue > 1000000000000000000) {
        return (numValue / 1000000000000000000).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 8
        });
      }
      return numValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
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
        maximumFractionDigits: 8
      });
    } catch {
      return value;
    }
  };

  // Transaction、TokenTransfer、MiningRewardsをマージ
  const allTxs = [
    ...displayTransactions.map(tx => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: formatTransactionValue(tx.value),
      timestamp: tx.timestamp,
      timeAgo: getTimeAgo(tx.timestamp),
      blockNumber: tx.blockNumber,
      type: 'native',
      status: 'success'
    })),
    ...tokenTransfers.map(tx => ({
      hash: tx.transactionHash,
      from: tx.from,
      to: tx.to,
      value: tx.value, // トークンの場合はそのまま
      timestamp: tx.timestamp,
      timeAgo: getTimeAgo(tx.timestamp),
      blockNumber: tx.blockNumber,
      type: 'token',
      tokenAddress: tx.tokenAddress,
      status: 'success'
    })),
    ...miningRewards.slice(0, 10).map(tx => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      timestamp: tx.timestamp,
      timeAgo: tx.timeAgo,
      blockNumber: tx.blockNumber,
      type: 'mining_reward',
      status: tx.status || 'success'
    }))
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

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
      isContract: true
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
      isContract: true,
      bytecodeSize: Math.floor((contractCode.length - 2) / 2), // バイトコードサイズ（バイト単位）
      knownContract: knownContract !== null // config.jsonで既知のコントラクトかどうか
    };
  }

  return NextResponse.json({
    account: {
      address,
      balance: formatBalance(realBalance), // 表示用（フォーマット済み）
      balanceRaw: realBalance, // 生の値
      percentage: percent.toFixed(4), // 動的計算値
      rank,       // DB値そのまま
      transactionCount: transactionCount || 0,
      blocksMined: blocksMined || 0,
      tokenTransferCount: tokenTransferCount || 0,
      firstSeen: firstActivity ? `${formatDate(firstActivity)} (${getTimeAgo(firstActivity)})` : 'Unknown',
      lastActivity: lastActivity ? `${formatDate(lastActivity)} (${getTimeAgo(lastActivity)})` : 'Unknown'
    },
    contract: contractInfo,
    transactions: allTxs,
    // 分類情報を追加
    transactionStats: {
      regularCount: regularTransactionCount || 0, // 実際の通常トランザクション数を使用
      miningCount: blocksMined || 0, // 実際のマイニングブロック数を使用
      totalCount: (regularTransactionCount || 0) + (blocksMined || 0)
    }
  });
} 