/**
 * Account module handlers for the Blockscout/Etherscan-compatible API.
 *
 * Implements the `account` actions (balance, balancemulti, txlist, tokentx,
 * tokenbalance, getminedblocks, txlistinternal). Extracted from
 * `app/api/route.ts` to keep the dispatcher thin.
 */

import { type Address } from 'viem';
import { connectDB, Block, Transaction } from '@/models/index';
import {
  configJson,
  publicClient,
  successResponse,
  errorResponse,
  getBlockRewardWeiForHeight,
} from './shared';

export async function getBalance(address: string) {
  try {
    const balance = await publicClient.getBalance({ address: address as Address });
    return successResponse(balance.toString());
  } catch (error) {
    return errorResponse('Error fetching balance');
  }
}

export async function getBalanceMulti(addresses: string) {
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

export async function getTxList(address: string, page = 1, offset = 10, sort = 'desc') {
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

export async function getTokenTx(address: string, contractaddress?: string, page = 1, offset = 10) {
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
export async function getTokenBalance(address: string, contractaddress: string) {
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
export async function getMinedBlocks(address: string, page = 1, offset = 10) {
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

    const result = blocks.map((block: Record<string, unknown>) => ({
      blockNumber: String(block.number),
      timeStamp: String(block.timestamp || ''),
      blockReward: getBlockRewardWeiForHeight(Number(block.number)),
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching mined blocks');
  }
}

// Get internal transactions (contract calls)
export async function getTxListInternal(address?: string, txhash?: string, page = 1, offset = 10) {
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
