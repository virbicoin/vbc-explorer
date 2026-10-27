/**
 * ChainNode adapter over a web3 v4 instance (used by tools/sync.ts and
 * tools/repair-chain.ts).
 */

import type Web3 from 'web3';
import { toHex, toNumber, type ChainNode, type RawBlock, type RawReceipt } from './normalize';

export function createWeb3Node(web3: Web3): ChainNode {
  return {
    async getBlockNumber() {
      return toNumber(await web3.eth.getBlockNumber());
    },
    async getBlock(height) {
      const block = await web3.eth.getBlock(height, true);
      return block ? (block as unknown as RawBlock) : null;
    },
    async getBlockHeader(height) {
      const block = await web3.eth.getBlock(height, false);
      if (!block) return null;
      return {
        number: toNumber(block.number),
        hash: toHex(block.hash),
        parentHash: toHex(block.parentHash),
      };
    },
    async getTransactionReceipt(hash) {
      const receipt = await web3.eth.getTransactionReceipt(hash);
      return receipt ? (receipt as unknown as RawReceipt) : null;
    },
  };
}
