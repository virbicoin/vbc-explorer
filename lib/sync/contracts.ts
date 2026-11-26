/**
 * Contract registration (`Contract` collection) shared by tools/sync.ts (contracts
 * created by a transaction) and tools/internal-txs.ts (contracts created by a
 * contract). The token standard is detected on-chain (ERC-165 for VRC-721 /
 * VRC-1155, name / symbol / decimals for VRC-20); an address that already has a
 * record, or has no code, is left alone.
 */

import { Contract } from '../../models/index';
import {
  ERC721_INTERFACE_ID,
  ERC1155_INTERFACE_ID,
  ercCodeForTokenType,
  type DetectedTokenType,
} from '../contract/erc';
import { hiddenFields } from '../security/display-name';
import { callContract, getCode } from '@/lib/web3/provider';

/**
 * Register a contract in the database
 * Called when a contract creation transaction is detected
 */
export const registerContract = async (
  contractAddress: string,
  creatorAddress: string,
  creationTxHash: string,
  blockNumber: number
): Promise<void> => {
  try {
    const normalizedAddress = contractAddress.toLowerCase();

    // Check if contract already exists
    const existing = await Contract.findOne({ address: normalizedAddress });
    if (existing) {
      return; // Already registered
    }

    // Get bytecode to verify it's a contract
    const bytecode = await getCode(contractAddress);
    if (!bytecode || bytecode === '0x' || bytecode === '0x0') {
      return; // Not a contract
    }

    // Token detection results
    let tokenType: DetectedTokenType = 'Contract';
    let tokenName = '';
    let tokenSymbol = '';
    let tokenDecimals = 0;

    // Try to detect token type
    try {
      // First, check for ERC-165 supportsInterface (for NFTs)
      const erc165ABI = [
        {
          constant: true,
          inputs: [{ name: 'interfaceId', type: 'bytes4' }],
          name: 'supportsInterface',
          outputs: [{ name: '', type: 'bool' }],
          type: 'function',
        },
      ];

      // Check for ERC-721
      try {
        const isERC721 = await callContract(erc165ABI, contractAddress, 'supportsInterface', [
          ERC721_INTERFACE_ID,
        ]);
        if (isERC721) {
          tokenType = 'ERC721';
        }
      } catch {
        // Not ERC-165 compliant or not ERC-721
      }

      // Check for ERC-1155
      if (tokenType === 'Contract') {
        try {
          const isERC1155 = await callContract(erc165ABI, contractAddress, 'supportsInterface', [
            ERC1155_INTERFACE_ID,
          ]);
          if (isERC1155) {
            tokenType = 'ERC1155';
          }
        } catch {
          // Not ERC-1155
        }
      }

      // Try ERC-20 detection
      const erc20ABI = [
        {
          constant: true,
          inputs: [],
          name: 'name',
          outputs: [{ name: '', type: 'string' }],
          type: 'function',
        },
        {
          constant: true,
          inputs: [],
          name: 'symbol',
          outputs: [{ name: '', type: 'string' }],
          type: 'function',
        },
        {
          constant: true,
          inputs: [],
          name: 'decimals',
          outputs: [{ name: '', type: 'uint8' }],
          type: 'function',
        },
      ];

      // Try to call ERC20 methods
      const [name, symbol, decimals] = await Promise.all([
        callContract(erc20ABI, contractAddress, 'name', []).catch(() => null),
        callContract(erc20ABI, contractAddress, 'symbol', []).catch(() => null),
        callContract(erc20ABI, contractAddress, 'decimals', []).catch(() => null),
      ]);

      if (name && symbol) {
        tokenName = String(name);
        tokenSymbol = String(symbol);
        tokenDecimals = decimals ? Number(decimals) : 18;

        // Only set as ERC20 if not already detected as NFT
        if (tokenType === 'Contract') {
          tokenType = 'ERC20';
        }
      }
    } catch {
      // Not an ERC20 token or method call failed
    }

    // Convert tokenType to the ERC code stored in Contract.ERC
    const ercNumber = ercCodeForTokenType(tokenType);

    // Create contract entry (names that look like URLs / contain control chars are flagged hidden)
    await Contract.create({
      address: normalizedAddress,
      blockNumber: blockNumber,
      ERC: ercNumber,
      ...hiddenFields({ name: tokenName, symbol: tokenSymbol }),
      type: tokenType === 'Contract' ? null : `VRC-${tokenType.replace('ERC', '')}`,
      creationTransaction: creationTxHash,
      contractName:
        tokenType !== 'Contract' ? tokenName || tokenSymbol || 'Unknown Token' : 'Contract',
      tokenName: tokenName || null,
      symbol: tokenSymbol || null,
      owner: creatorAddress.toLowerCase(),
      decimals: tokenDecimals,
      verified: false,
    });

    const typeLabel =
      tokenType !== 'Contract' ? ` (${tokenType}: ${tokenSymbol || tokenName})` : '';
    console.log(`📝 Contract registered: ${normalizedAddress}${typeLabel}`);
  } catch (error: any) {
    // Ignore duplicate key errors
    if (error.code !== 11000) {
      console.error(`⚠️ Failed to register contract ${contractAddress}:`, error.message);
    }
  }
};
