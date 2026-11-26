import { NextRequest, NextResponse } from 'next/server';
import {
  decodeFunctionData,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type Hex,
} from 'viem';
import { Transaction, Block, InternalTransaction, connectDB } from '../../../../models/index';
import { getTransactionTypeGlobal, METHOD_IDS } from '../../../../lib/transaction-utils';
import { tryGetDb } from '../../../../lib/db/get-db';
import {
  sanitizeHash,
  isValidHash,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../lib/security';
import { loadConfig, getRewardSchedule } from '../../../../lib/config';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { createWeb3FactoryClient, resolveFactoryToken } from '@/lib/launchpad/factory';
import { minerRewardWei, transactionFeesWei } from '@/lib/reward-schedule';

// Load configuration
const config = loadConfig();

/** Render a decoded calldata argument as a display string (bigints, arrays, tuples). */
function stringifyDecodedValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return `[${value.map(stringifyDecodedValue).join(', ')}]`;
  // a tuple with named components decodes as an object
  if (value && typeof value === 'object') return stringifyDecodedValue(Object.values(value));
  return String(value);
}

interface DecodedInput {
  methodName: string;
  signature: string | null;
  params: { name: string; type: string; value: string }[] | null;
}

/**
 * Decode transaction calldata Etherscan-style: against the verified contract
 * ABI when available, otherwise fall back to the shared selector map (method
 * name only).
 */
async function decodeInputData(
  input: string | undefined,
  to: string | undefined
): Promise<DecodedInput | null> {
  if (!input || input.length < 10) return null;

  if (to) {
    try {
      const db = tryGetDb();
      const verified = db
        ? await db
            .collection('Contract')
            .findOne(
              { address: to.toLowerCase(), abi: { $type: 'string', $ne: '' } },
              { projection: { abi: 1 } }
            )
        : null;
      if (verified?.abi) {
        const abi = JSON.parse(verified.abi as string) as Abi;
        const selector = input.slice(0, 10).toLowerCase();
        const fragment = abi.find(
          (item) => item.type === 'function' && toFunctionSelector(item) === selector
        );
        if (fragment?.type === 'function') {
          const { args = [] } = decodeFunctionData({ abi: [fragment], data: input as Hex });
          return {
            methodName: fragment.name,
            signature: toFunctionSignature(fragment),
            params: fragment.inputs.map((param, i) => ({
              name: param.name || `arg${i}`,
              type: param.type,
              value: stringifyDecodedValue(args[i]),
            })),
          };
        }
      }
    } catch {
      // Unparseable ABI or calldata - fall through to the selector map
    }
  }

  const known = METHOD_IDS[input.slice(0, 10).toLowerCase()];
  return known ? { methodName: known.action, signature: null, params: null } : null;
}

// Transaction interface for type safety
interface TransactionDocument {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: Date;
  blockNumber: number;
  gas?: string;
  status: number;
  input?: string;
}

// Block interface for type safety
interface BlockDocument {
  number: number;
  hash: string;
  timestamp: Date;
  miner: string;
  uncles?: string[];
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  try {
    const limited = enforceRateLimit(request, 'api');
    if (limited) return limited;

    const { hash: rawHash } = await params;
    if (!rawHash) {
      return NextResponse.json(
        { error: 'Transaction hash is required' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Validate and sanitize hash
    if (!isValidHash(rawHash)) {
      return NextResponse.json(
        { error: 'Invalid transaction hash format' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    const hash = sanitizeHash(rawHash);
    if (!hash) {
      return NextResponse.json(
        { error: 'Invalid transaction hash' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    // Connect to database with better error handling
    try {
      await connectDB();
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500, headers: getSecurityHeaders() }
      );
    }

    // Find the transaction by hash
    const transaction = (await Transaction.findOne({
      hash: hash,
    }).lean()) as TransactionDocument | null;

    if (!transaction) {
      // --- Mining Reward Transaction fallback ---
      // Try to find a block with this hash (for mining reward tx)
      const block = (await Block.findOne({ hash: hash }).lean()) as BlockDocument | null;
      if (block) {
        // Generate a pseudo-transaction for mining reward, worth what the mining list shows
        // (/api/address/[address]/mining): reward at this height + fees + uncle inclusion
        const blockTxs = (await Transaction.find({ blockNumber: block.number })
          .select('gasUsed gasPrice')
          .lean()) as Array<{ gasUsed?: number; gasPrice?: string }>;
        const reward = minerRewardWei(
          getRewardSchedule(),
          block.number,
          block.uncles?.length ?? 0,
          transactionFeesWei(blockTxs)
        );
        const miningRewardTx = {
          hash: block.hash,
          from: '0x0000000000000000000000000000000000000000',
          to: block.miner,
          value: reward.total.toString(),
          timestamp: block.timestamp,
          blockNumber: block.number,
          gas: '0',
          gasUsed: 0,
          gasPrice: '0',
          gasLimit: '0',
          nonce: 0,
          transactionIndex: 0,
          status: 'success',
          input: '',
          inputData: '0x',
          isContractCreation: false,
          logs: [],
          internalTransactions: [],
          blockHash: block.hash,
          cumulativeGasUsed: 0,
          effectiveGasPrice: '0',
          maxFeePerGas: '0',
          maxPriorityFeePerGas: '0',
          type: 0,
          accessList: [],
          v: '0x0',
          r: '0x0',
          s: '0x0',
          isMiningReward: true,
          txType: 'mining_reward',
          txAction: 'Mining Reward',
          block: {
            number: block.number,
            hash: block.hash,
            timestamp: block.timestamp,
            miner: block.miner,
          },
        };
        return NextResponse.json(miningRewardTx, { headers: getSecurityHeaders() });
      }
      // --- End mining reward fallback ---
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    // Get the actual transaction object (handle both array and single object cases)
    const actualTransaction = Array.isArray(transaction) ? transaction[0] : transaction;

    // Find the block that contains this transaction
    const block = (await Block.findOne({
      number: actualTransaction.blockNumber,
    }).lean()) as BlockDocument | null;

    // Determine transaction type
    const typeInfo = getTransactionTypeGlobal({
      from: actualTransaction.from,
      to: actualTransaction.to,
      value: actualTransaction.value || '0',
      input: actualTransaction.input,
      status: actualTransaction.status,
    });

    // Get token transfer info
    const db = tryGetDb();
    let tokenTransfers: Array<Record<string, unknown>> = [];

    // Get tokenIcons from config for centralized icon lookup
    const tokenIcons =
      (config as { tokenIcons?: Record<string, { icon?: string; color?: string }> }).tokenIcons ||
      {};
    const getIconUrl = (symbol: string): string | undefined => {
      const iconCfg = tokenIcons[symbol];
      return iconCfg?.icon || undefined;
    };

    if (db) {
      const transfers = await db
        .collection('tokentransfers')
        .find({ transactionHash: hash })
        .toArray();

      if (transfers.length > 0) {
        // Get token info
        const tokenAddresses = [...new Set(transfers.map((t) => t.tokenAddress as string))].filter(
          Boolean
        );
        const tokenInfoMap = new Map<
          string,
          {
            name: string;
            symbol: string;
            decimals: number;
            type: string;
            logoUrl?: string;
            hidden?: boolean;
          }
        >();

        if (tokenAddresses.length > 0) {
          const tokens = await db
            .collection('tokens')
            .find({
              address: { $in: tokenAddresses.map((a) => a.toLowerCase()) },
            })
            .toArray();

          for (const token of tokens) {
            const addr = ((token.address as string) || '').toLowerCase();
            if (addr) {
              tokenInfoMap.set(addr, {
                name: (token.name as string) || 'Unknown Token',
                symbol: (token.symbol as string) || '???',
                // Use nullish coalescing to handle decimals=0 correctly
                decimals: (token.decimals as number) ?? 18,
                type: (token.type as string) || 'VRC-20',
                logoUrl: (token.logoUrl as string) || undefined,
                hidden: token.hidden === true,
              });
            }
          }

          // For tokens without a logo, ask the configured Launchpad factories (current and
          // legacy, from config.json) for the on-chain metadata. This used a hardcoded address
          // of the previous TokenFactoryV2, so tokens of the current factory got no logo.
          const factoryClient = createWeb3FactoryClient();
          for (const addr of tokenAddresses) {
            const lowerAddr = addr.toLowerCase();
            const info = tokenInfoMap.get(lowerAddr);
            const symbolIconUrl = info ? getIconUrl(info.symbol) : undefined;

            // If we have config icon, use that
            if (symbolIconUrl) {
              if (info) {
                info.logoUrl = symbolIconUrl;
                tokenInfoMap.set(lowerAddr, info);
              }
            }
            // Otherwise try the Launchpad factories
            else if (!info?.logoUrl) {
              try {
                const factoryToken = await resolveFactoryToken(lowerAddr, {
                  client: factoryClient,
                });
                if (factoryToken?.logoUrl) {
                  const existingInfo = tokenInfoMap.get(lowerAddr) || {
                    name: factoryToken.name || 'Unknown Token',
                    symbol: factoryToken.symbol || '???',
                    decimals: factoryToken.decimals ?? 18,
                    type: 'VRC-20',
                  };
                  existingInfo.logoUrl = factoryToken.logoUrl;
                  tokenInfoMap.set(lowerAddr, existingInfo);
                }
              } catch {
                // Not a Launchpad token, or the node did not answer
              }
            }
          }
        }

        // Format token transfers
        tokenTransfers = transfers.map((t) => {
          const tokenAddr = ((t.tokenAddress as string) || '').toLowerCase();
          const info = tokenInfoMap.get(tokenAddr);
          return {
            from: t.from,
            to: t.to,
            tokenAddress: t.tokenAddress,
            value: t.value,
            tokenId: t.tokenId,
            name: info?.name || 'Unknown Token',
            symbol: info?.symbol || '???',
            // Use nullish coalescing to handle decimals=0 correctly
            decimals: info?.decimals ?? 18,
            type: info?.type || 'VRC-20',
            logoUrl: info?.logoUrl || undefined,
          };
        });
      }
    }

    // Decode calldata against the verified contract ABI (Etherscan-style)
    const decodedInput = await decodeInputData(actualTransaction.input, actualTransaction.to);

    // Calls, creations and selfdestructs inside the transaction (tools/internal-txs.ts)
    const internalTransactions = (
      (await InternalTransaction.find({
        transactionHash: String(actualTransaction.hash).toLowerCase(),
      })
        .sort({ index: 1 })
        .lean()) as Array<Record<string, unknown>>
    ).map((doc) => ({
      index: doc.index,
      traceAddress: doc.traceAddress,
      type: doc.type === 'call' ? String(doc.callType || 'call') : String(doc.type),
      from: doc.from,
      to: doc.to ?? doc.createdContract ?? null,
      createdContract: doc.createdContract ?? null,
      value: String(doc.value ?? '0'),
      gas: doc.gas,
      gasUsed: doc.gasUsed,
      error: doc.error ?? null,
      reverted: Boolean(doc.reverted),
    }));

    // Transform the transaction data for frontend
    const transformedTransaction = {
      ...actualTransaction,
      // Convert numeric status to string
      status: actualTransaction.status === 1 ? 'success' : 'failed',
      // Add additional fields expected by frontend
      gasLimit: actualTransaction.gas || 'N/A',
      isContractCreation: !actualTransaction.to,
      inputData: actualTransaction.input || '0x',
      decodedInput,
      logs: [], // Empty array for now, can be populated later if needed
      internalTransactions,
      // MetaMask compliant type info
      txType: typeInfo.type,
      txAction: typeInfo.action,
      // Token transfer info
      tokenTransfers: tokenTransfers,
      block: block
        ? {
            number: block.number,
            hash: block.hash,
            timestamp: block.timestamp,
            miner: block.miner,
          }
        : null,
    };

    return NextResponse.json(transformedTransaction, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
