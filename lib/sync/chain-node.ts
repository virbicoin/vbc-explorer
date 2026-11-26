/**
 * ChainNode over the shared node client (lib/web3/provider.ts), for tools/sync.ts,
 * tools/repair-chain.ts and the uncle reward backfill. Blocks and receipts keep viem's formats
 * (quantities as bigint), which normalize.ts stores as decimal strings.
 */
import { numberToHex } from 'viem';
import { getClient } from '../web3/provider';
import { toHex, toNumber, type ChainNode, type RawBlock, type RawReceipt } from './normalize';

export function createChainNode(): ChainNode {
  const client = getClient();
  return {
    async getBlockNumber() {
      return toNumber(await client.getBlockNumber());
    },
    async getBlock(height) {
      const block = await client
        .getBlock({ blockNumber: BigInt(height), includeTransactions: true })
        .catch(() => null);
      return block ? (block as unknown as RawBlock) : null;
    },
    async getBlockHeader(height) {
      const block = await client.getBlock({ blockNumber: BigInt(height) }).catch(() => null);
      if (!block) return null;
      return {
        number: toNumber(block.number),
        hash: toHex(block.hash),
        parentHash: toHex(block.parentHash),
      };
    },
    async getTransactionReceipt(hash) {
      const receipt = await client
        .getTransactionReceipt({ hash: hash as `0x${string}` })
        .catch(() => null);
      return receipt ? (receipt as unknown as RawReceipt) : null;
    },
    async getUncle(blockHash, index) {
      const uncle = (await client.request({
        method: 'eth_getUncleByBlockHashAndIndex',
        params: [blockHash, numberToHex(index)],
      } as never)) as { number?: string; hash?: string; miner?: string } | null;
      return uncle ? { number: uncle.number, hash: uncle.hash, miner: uncle.miner } : null;
    },
  };
}
