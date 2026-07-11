import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../models/index';
import { tryGetDb } from '../../../../../lib/db/get-db';
import { getWeb3 } from '../../../../../lib/web3';
import { loadConfig } from '../../../../../lib/config';
import { buildAddressTags, type AddressTagSources } from '../../../../../lib/address-tags';
import { apiCache } from '../../../../../lib/cache';
import {
  isValidAddress,
  sanitizeAddress,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '../../../../../lib/security';
import { logger } from '../../../../../lib/logger';

// BscScan-style token approval checker: scans ERC-20 Approval events for an
// owner address and reports the spenders that still hold a non-zero
// allowance (the UI offers revoking via approve(spender, 0)).
//
//   GET /api/address/[address]/approvals

// keccak256("Approval(address,address,uint256)")
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_PAIRS = 200;
const ALLOWANCE_BATCH = 8;
// Allowances at or above 2^255 are shown as "Unlimited"
const UNLIMITED_THRESHOLD = 1n << 255n;

const ERC20_ALLOWANCE_ABI = [
  {
    constant: true,
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function' as const,
    stateMutability: 'view' as const,
  },
];

interface ApprovalEntry {
  token: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  spender: string;
  spenderTag: string | null;
  allowance: string;
  isUnlimited: boolean;
  lastUpdatedBlock: number;
}

async function scanApprovals(owner: string): Promise<{
  approvals: ApprovalEntry[];
  scannedEvents: number;
}> {
  const web3 = getWeb3();
  const ownerTopic = '0x' + owner.slice(2).toLowerCase().padStart(64, '0');

  // Owner is an indexed topic, so the node can serve this from bloom filters
  const logs = (await web3.eth.getPastLogs({
    fromBlock: '0x0',
    toBlock: 'latest',
    topics: [APPROVAL_TOPIC, ownerTopic],
  })) as { address?: string; topics?: string[]; blockNumber?: bigint | number }[];

  // Latest (token, spender) pairs. ERC-20 Approval has exactly 3 topics
  // (value lives in data); ERC-721 Approval has 4 (tokenId indexed) - skip.
  const pairs = new Map<string, { token: string; spender: string; block: number }>();
  for (const log of logs) {
    const topics = log.topics || [];
    if (topics.length !== 3 || !log.address) continue;
    const token = log.address.toLowerCase();
    const spender = ('0x' + topics[2].slice(26)).toLowerCase();
    const block = Number(log.blockNumber ?? 0);
    const key = `${token}:${spender}`;
    const existing = pairs.get(key);
    if (!existing || block > existing.block) pairs.set(key, { token, spender, block });
  }

  const uniquePairs = [...pairs.values()].slice(0, MAX_PAIRS);

  // Current allowance per pair (small concurrent batches to spare the node)
  const withAllowance: (ApprovalEntry | null)[] = [];
  for (let i = 0; i < uniquePairs.length; i += ALLOWANCE_BATCH) {
    const batch = uniquePairs.slice(i, i + ALLOWANCE_BATCH);
    const results = await Promise.all(
      batch.map(async (pair) => {
        try {
          const contract = new web3.eth.Contract(ERC20_ALLOWANCE_ABI, pair.token);
          const raw = (await contract.methods.allowance(owner, pair.spender).call()) as unknown;
          const allowance = BigInt(String(raw ?? 0));
          if (allowance <= 0n) return null;
          return {
            token: pair.token,
            tokenName: 'Unknown Token',
            tokenSymbol: '???',
            decimals: 18,
            spender: pair.spender,
            spenderTag: null,
            allowance: allowance.toString(),
            isUnlimited: allowance >= UNLIMITED_THRESHOLD,
            lastUpdatedBlock: pair.block,
          } satisfies ApprovalEntry;
        } catch {
          // Not a readable ERC-20 (selfdestructed, odd proxy, ...) - skip
          return null;
        }
      })
    );
    withAllowance.push(...results);
  }
  const approvals = withAllowance.filter((a): a is ApprovalEntry => a !== null);

  // Enrich token metadata from the DB in one query
  const db = tryGetDb();
  if (db && approvals.length > 0) {
    const addresses = [...new Set(approvals.map((a) => a.token))];
    const tokens = await db
      .collection('tokens')
      .find({ address: { $in: addresses } })
      .toArray();
    const info = new Map<string, { name?: string; symbol?: string; decimals?: number }>();
    for (const t of tokens as Record<string, unknown>[]) {
      const a = ((t.address as string) || '').toLowerCase();
      if (a)
        info.set(a, {
          name: t.name as string,
          symbol: t.symbol as string,
          decimals: t.decimals as number,
        });
    }
    for (const approval of approvals) {
      const meta = info.get(approval.token);
      if (meta) {
        approval.tokenName = meta.name || approval.tokenName;
        approval.tokenSymbol = meta.symbol || approval.tokenSymbol;
        approval.decimals = meta.decimals ?? approval.decimals;
      }
    }
  }

  // Label known spenders (DEX router, MasterChef, bridge, ...)
  try {
    const config = await loadConfig();
    const tags = buildAddressTags(config as unknown as AddressTagSources);
    for (const approval of approvals) {
      approval.spenderTag = tags[approval.spender] || null;
    }
  } catch {
    // Tags are decorative - ignore config load issues
  }

  approvals.sort(
    (a, b) =>
      Number(b.isUnlimited) - Number(a.isUnlimited) || b.lastUpdatedBlock - a.lastUpdatedBlock
  );

  return { approvals, scannedEvents: logs.length };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const clientIp = getClientIp(request);
  // Each scan walks the full log index - keep the limit strict
  const rateLimit = checkRateLimit(`approvals:${clientIp}`, 60, 6);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimit.resetIn },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  const { address } = await params;
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }
  const owner = (sanitizeAddress(address) || '').toLowerCase();
  if (!owner) {
    return NextResponse.json(
      { error: 'Invalid address format' },
      { status: 400, headers: getSecurityHeaders() }
    );
  }

  try {
    await connectDB();
    // refresh=1 busts the cache (used by the UI right after a revoke confirms)
    const { searchParams } = new URL(request.url);
    if (searchParams.get('refresh') === '1') {
      apiCache.delete(`approvals:${owner}`);
    }
    const data = await apiCache.getOrSet(
      `approvals:${owner}`,
      () => scanApprovals(owner),
      CACHE_TTL_MS
    );
    return NextResponse.json(
      { ...data, address: owner, updatedAt: Date.now() },
      { headers: getSecurityHeaders() }
    );
  } catch (error) {
    logger.error('Approval scan failed', { error, owner });
    return NextResponse.json(
      { error: 'Approval scan failed. The RPC node may be unavailable.' },
      { status: 502, headers: getSecurityHeaders() }
    );
  }
}
