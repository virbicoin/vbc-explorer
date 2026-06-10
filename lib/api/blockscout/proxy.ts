/**
 * JSON-RPC proxy handlers for the Blockscout/Etherscan-compatible API.
 *
 * Each function maps an Etherscan `proxy` action to a viem RPC call and returns
 * the result wrapped in the standard response envelope. Extracted from
 * `app/api/route.ts` to keep that dispatcher thin.
 */

import { type Address } from 'viem';
import { publicClient, successResponse, errorResponse } from './shared';

export async function proxyEthBlockNumber() {
  try {
    const blockNumber = await publicClient.getBlockNumber();
    return successResponse(`0x${blockNumber.toString(16)}`);
  } catch (error) {
    return errorResponse('Error fetching block number');
  }
}

export async function proxyEthGetBlockByNumber(tag: string, full = false) {
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

export async function proxyEthGetTransactionByHash(txhash: string) {
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

export async function proxyEthGetTransactionReceipt(txhash: string) {
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

export async function proxyEthCall(to: string, data: string, tag = 'latest') {
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

export async function proxyEthGetCode(address: string, tag = 'latest') {
  try {
    const code = await publicClient.getCode({
      address: address as Address,
    });

    return successResponse(code || '0x');
  } catch (error) {
    return errorResponse('Error fetching code');
  }
}

export async function proxyEthGasPrice() {
  try {
    const gasPrice = await publicClient.getGasPrice();
    return successResponse(`0x${gasPrice.toString(16)}`);
  } catch (error) {
    return errorResponse('Error fetching gas price');
  }
}

export async function proxyEthEstimateGas(
  to: string,
  data?: string,
  value?: string,
  from?: string
) {
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
