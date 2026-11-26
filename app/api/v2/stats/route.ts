import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block, Transaction, Account, Contract } from '@/models/index';
import { checkRateLimit, getClientIp, getSecurityHeaders } from '@/lib/security';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { countAll } from '@/lib/db/count';
import { getPriceChange24h, getPriceFromDatabase } from '@/lib/price-service';
import {
  SUPPLY_CONFIG,
  computeTotalSupplyWei,
  getExcludedBalances,
  getUncleIssuanceWei,
} from '@/lib/supply';
import { getWeb3 } from '@/lib/web3/provider';

// Function to read config

/** The promise's value, or null when it rejects or takes longer than `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
const web3 = getWeb3();

// Blockscout API v2 - Get stats
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request, 'api', { format: 'v2' });
    if (limited) return limited;

    await connectDB();

    // Get latest block
    const latestBlock = await Block.findOne({}).sort({ number: -1 }).lean();
    const blockNumber = latestBlock?.number || 0;

    // Totals from collection metadata (lib/db/count.ts), not a full index walk
    const totalTransactions = await countAll(Transaction);
    const totalAddresses = await countAll(Account);

    // Get verified contracts count
    const verifiedContracts = await Contract.countDocuments({
      verified: true,
      hidden: { $ne: true },
    });

    // Same formula as /api/total_supply, from the database only (like the other figures here),
    // so a slow or absent node cannot stall the response.
    const totalSupplyWei = computeTotalSupplyWei(
      blockNumber,
      SUPPLY_CONFIG.premineAmount,
      await getUncleIssuanceWei()
    );
    // The excluded balances come from the node: subtract them when it answers within 2 s.
    const excludedWei = await within(
      getExcludedBalances().then((balances) => [...balances.values()].reduce((a, b) => a + b, 0n)),
      2000
    );
    const circulatingSupplyWei =
      excludedWei === null || excludedWei > totalSupplyWei
        ? totalSupplyWei
        : totalSupplyWei - excludedWei;

    // Get gas price
    let gasPrice = '1000000000'; // 1 gwei default
    try {
      gasPrice = (await web3.eth.getGasPrice()).toString();
    } catch (error) {
      console.error('Error fetching gas price:', error);
    }

    // Calculate average block time (last 100 blocks)
    let avgBlockTime = 12;
    try {
      const recentBlocks = await Block.find({})
        .sort({ number: -1 })
        .limit(100)
        .select('number timestamp')
        .lean();

      if (recentBlocks.length > 1) {
        const timeDiff =
          (recentBlocks[0].timestamp as number) -
          (recentBlocks[recentBlocks.length - 1].timestamp as number);
        avgBlockTime = timeDiff / (recentBlocks.length - 1);
      }
    } catch (error) {
      console.error('Error calculating avg block time:', error);
    }

    // Price stored by tools/price.ts (no older than 10 minutes), its 24h change and the
    // market cap of the circulating supply; null without a fresh price
    const price = await getPriceFromDatabase();
    const priceChange = await getPriceChange24h(price);
    const marketCap =
      price && price.priceUSD > 0
        ? String(Math.round((Number(circulatingSupplyWei) / 1e18) * price.priceUSD * 100) / 100)
        : null;

    // Get 24h transaction count
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const tx24h = await Transaction.countDocuments({
      timestamp: { $gte: oneDayAgo },
    });

    // Blockscout API v2 response format
    const response = {
      // Network info
      network_utilization_percentage: 0,

      // Block info
      total_blocks: blockNumber.toString(),
      average_block_time: avgBlockTime * 1000, // in milliseconds

      // Transaction info
      total_transactions: totalTransactions.toString(),
      transactions_today: tx24h.toString(),

      // Address info
      total_addresses: totalAddresses.toString(),

      // Contract info
      total_verified_contracts: verifiedContracts.toString(),

      // Supply info
      coin_price: price && price.priceUSD > 0 ? String(price.priceUSD) : null,
      coin_price_change_percentage: priceChange,
      total_supply: totalSupplyWei.toString(),
      circulating_supply: circulatingSupplyWei.toString(),
      market_cap: marketCap,

      // Gas info
      gas_prices: {
        slow: gasPrice,
        average: gasPrice,
        fast: gasPrice,
      },
      gas_used_today: '0',
      gas_price_updated_at: new Date().toISOString(),

      // Static gas price
      static_gas_price: gasPrice,

      // Secondary coin (not applicable)
      secondary_coin_price: null,

      // TVL
      tvl: null,

      // Rootstock (not applicable)
      rootstock_locked_btc: null,

      // Last new contract
      last_output_root_size: null,

      // Celo (not applicable)
      celo: null,
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
