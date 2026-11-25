/**
 * Account module handlers for the Blockscout/Etherscan-compatible API.
 *
 * Implements the `account` actions (balance, balancemulti, eth_get_balance,
 * txlist, txlistinternal, tokentx, tokennfttx, token1155tx, tokenbalance,
 * tokenlist, getminedblocks). Extracted from `app/api/route.ts` to keep the
 * dispatcher thin.
 */

import { type Address } from 'viem';
import { connectDB, Block, Transaction, Token, TokenHolder, TokenTransfer } from '@/models/index';
import { ercTokenType } from '@/lib/api/token-standard';
import {
  publicClient,
  successResponse,
  errorResponse,
  emptyListResponse,
  rpcResponse,
  rpcErrorResponse,
  txStatusFields,
  methodId,
  getHeadNumber,
  confirmations,
  getBlockRewardWeiForHeight,
} from './shared';

/** Paging, order and block range shared by the list actions. */
export interface ListOptions {
  page: number;
  offset: number;
  sort: 'asc' | 'desc';
  startblock?: number;
  endblock?: number;
}

function blockRange(options: ListOptions): Record<string, number> | null {
  const range: Record<string, number> = {};
  if (options.startblock !== undefined) range.$gte = options.startblock;
  if (options.endblock !== undefined) range.$lte = options.endblock;
  return Object.keys(range).length > 0 ? range : null;
}

function toUnixSeconds(value: unknown): string {
  if (typeof value === 'number') return String(value > 1e12 ? Math.floor(value / 1000) : value);
  if (value instanceof Date || typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? '' : String(Math.floor(ms / 1000));
  }
  return '';
}

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

/** Blockscout `eth_get_balance`: the node's answer in the JSON-RPC envelope. */
export async function getEthGetBalance(address: string, block: string) {
  try {
    const balance = await publicClient.request({
      method: 'eth_getBalance',
      params: [address as Address, block as `0x${string}`],
    });
    return rpcResponse(balance);
  } catch (error) {
    return rpcErrorResponse('Balance not found');
  }
}

export async function getTxList(address: string, options: ListOptions) {
  try {
    await connectDB();
    const account = address.toLowerCase();
    const direction = options.sort === 'asc' ? 1 : -1;
    const filter: Record<string, unknown> = { $or: [{ from: account }, { to: account }] };
    const range = blockRange(options);
    if (range) filter.blockNumber = range;

    const [txs, head] = await Promise.all([
      Transaction.find(filter)
        .sort({ blockNumber: direction, transactionIndex: direction })
        .skip((options.page - 1) * options.offset)
        .limit(options.offset)
        .lean(),
      getHeadNumber(),
    ]);
    if (txs.length === 0) return emptyListResponse();

    const result = txs.map((tx: Record<string, unknown>) => ({
      blockNumber: String(tx.blockNumber),
      timeStamp: String(tx.timestamp ?? ''),
      hash: tx.hash,
      nonce: String(tx.nonce ?? 0),
      blockHash: tx.blockHash || '',
      transactionIndex: String(tx.transactionIndex ?? 0),
      from: tx.from,
      to: tx.to || '',
      value: tx.value?.toString() || '0',
      gas: String(tx.gas ?? 0),
      gasPrice: tx.gasPrice?.toString() || '0',
      ...txStatusFields(tx.status),
      input: tx.input || '0x',
      // address of the contract a creation transaction deployed
      contractAddress: tx.creates || '',
      // not stored (the sync keeps only the transaction's own gas)
      cumulativeGasUsed: '0',
      gasUsed: String(tx.gasUsed ?? 0),
      confirmations: confirmations(head, tx.blockNumber),
      methodId: methodId(tx.input),
      functionName: '',
    }));

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching transactions');
  }
}

/**
 * Token transfer events of an address and/or a token contract, from the
 * `tokentransfers` collection: `tokentx` (fungible, `value`) and `tokennfttx`
 * (ERC-721, `tokenID`). Transfers of tokens hidden as spam are left out unless
 * that contract is asked for by address.
 */
export async function getTokenTransfers(
  kind: 'erc20' | 'erc721',
  address: string | undefined,
  contractaddress: string | undefined,
  options: ListOptions
) {
  try {
    await connectDB();
    const direction = options.sort === 'asc' ? 1 : -1;
    // tokenId is only set on NFT transfers
    const filter: Record<string, unknown> = { tokenId: kind === 'erc721' ? { $ne: null } : null };
    if (address) {
      const account = address.toLowerCase();
      filter.$or = [{ from: account }, { to: account }];
    }
    if (contractaddress) {
      filter.tokenAddress = contractaddress.toLowerCase();
    } else {
      const hidden = (await Token.find({ hidden: true }).distinct('address')) as string[];
      if (hidden.length > 0) filter.tokenAddress = { $nin: hidden };
    }
    const range = blockRange(options);
    if (range) filter.blockNumber = range;

    const transfers = (await TokenTransfer.find(filter)
      // by time only, so the per-address indexes ({ from | to, timestamp }) serve the order
      .sort({ timestamp: direction })
      .skip((options.page - 1) * options.offset)
      .limit(options.offset)
      .lean()) as Array<Record<string, unknown>>;
    if (transfers.length === 0) return emptyListResponse();

    const tokenAddresses = [...new Set(transfers.map((t) => String(t.tokenAddress)))];
    const hashes = [...new Set(transfers.map((t) => String(t.transactionHash)))];
    const [tokens, txs, head] = await Promise.all([
      Token.find({ address: { $in: tokenAddresses } }).lean(),
      Transaction.find({ hash: { $in: hashes } })
        .select('hash nonce blockHash transactionIndex gas gasPrice gasUsed input')
        .lean(),
      getHeadNumber(),
    ]);
    const tokenByAddress = new Map(
      (tokens as Array<Record<string, unknown>>).map((token) => [String(token.address), token])
    );
    const txByHash = new Map(
      (txs as Array<Record<string, unknown>>).map((tx) => [String(tx.hash), tx])
    );

    const result = transfers.map((transfer) => {
      const token = tokenByAddress.get(String(transfer.tokenAddress));
      const tx = txByHash.get(String(transfer.transactionHash));
      const amount =
        kind === 'erc721'
          ? { tokenID: String(transfer.tokenId) }
          : { value: transfer.value?.toString() || '0' };
      return {
        blockNumber: String(transfer.blockNumber),
        timeStamp: toUnixSeconds(transfer.timestamp),
        hash: transfer.transactionHash,
        nonce: String(tx?.nonce ?? 0),
        blockHash: tx?.blockHash || '',
        from: transfer.from,
        contractAddress: transfer.tokenAddress,
        to: transfer.to,
        ...amount,
        tokenName: token?.name || '',
        tokenSymbol: token?.symbol || '',
        tokenDecimal: kind === 'erc721' ? '0' : String(token?.decimals ?? 18),
        transactionIndex: String(tx?.transactionIndex ?? 0),
        gas: String(tx?.gas ?? 0),
        gasPrice: tx?.gasPrice?.toString() || '0',
        gasUsed: String(tx?.gasUsed ?? 0),
        cumulativeGasUsed: '0',
        input: 'deprecated',
        methodId: methodId(tx?.input),
        functionName: '',
        confirmations: confirmations(head, transfer.blockNumber),
      };
    });

    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token transfers');
  }
}

/**
 * Lists the explorer has no data for answer like an address without any:
 * internal transactions need call traces, and ERC-1155 transfers are not
 * synced. Returning ordinary transactions instead would make clients count
 * the same value twice.
 */
export function getUnindexedList() {
  return emptyListResponse();
}

/** Blockscout `account/tokenlist`: the tokens an address holds. */
export async function getAccountTokenList(address: string) {
  try {
    await connectDB();
    const holdings = (
      (await TokenHolder.find({
        holderAddress: address.toLowerCase(),
        balance: { $nin: ['0', ''], $exists: true },
      }).lean()) as Array<Record<string, unknown>>
    ).filter((holding) => /^[1-9]\d*$/.test(String(holding.balance)));

    const tokens = (await Token.find({
      address: { $in: holdings.map((holding) => String(holding.tokenAddress)) },
    }).lean()) as Array<Record<string, unknown>>;
    const tokenByAddress = new Map(tokens.map((token) => [String(token.address), token]));

    const result = holdings
      .filter((holding) => !tokenByAddress.get(String(holding.tokenAddress))?.hidden)
      .map((holding) => {
        const token = tokenByAddress.get(String(holding.tokenAddress));
        return {
          balance: String(holding.balance),
          contractAddress: holding.tokenAddress,
          decimals: token ? String(token.decimals ?? 18) : '',
          name: token?.name || '',
          symbol: token?.symbol || '',
          type: ercTokenType(token?.type as string | undefined),
        };
      })
      .sort((a, b) => String(a.contractAddress).localeCompare(String(b.contractAddress)));

    if (result.length === 0) return emptyListResponse('No tokens found');
    return successResponse(result);
  } catch (error) {
    return errorResponse('Error fetching token list');
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
      miner: address.toLowerCase(),
    })
      .sort({ number: -1 })
      .skip(skip)
      .limit(offset)
      .lean();
    if (blocks.length === 0) return emptyListResponse();

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
