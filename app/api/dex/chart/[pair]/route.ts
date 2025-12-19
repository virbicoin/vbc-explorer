// API endpoint to get historical swap data for chart display
import { NextRequest, NextResponse } from 'next/server';
import Web3 from 'web3';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// UniswapV2 Pair Swap event signature
// Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
const SWAP_EVENT_SIGNATURE = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

const PAIR_ABI = [
  {
    inputs: [],
    name: "token0",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  }
];

const ERC20_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  }
];

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Map timeframe to seconds
const TIMEFRAME_SECONDS: Record<string, number> = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
};

// Calculate price from swap event
// Returns token0/token1 price to match pairs API (baseToken price in quoteToken)
function calculatePriceFromSwap(
  amount0In: bigint,
  amount1In: bigint,
  amount0Out: bigint,
  amount1Out: bigint,
  decimals0: number,
  decimals1: number
): number | null {
  const scale0 = 10 ** decimals0;
  const scale1 = 10 ** decimals1;
  
  if (amount0In > 0n && amount1Out > 0n) {
    // Swapping token0 for token1
    // User sends token0, receives token1
    // Price = token1 received / token0 sent = token1/token0
    const amountIn = Number(amount0In) / scale0;
    const amountOut = Number(amount1Out) / scale1;
    if (amountIn > 0) {
      return amountOut / amountIn;
    }
  } else if (amount1In > 0n && amount0Out > 0n) {
    // Swapping token1 for token0
    // User sends token1, receives token0
    // Price = token1 sent / token0 received = token1/token0
    const amountIn = Number(amount1In) / scale1;
    const amountOut = Number(amount0Out) / scale0;
    if (amountOut > 0) {
      return amountIn / amountOut;
    }
  }
  
  return null;
}

// Group swaps into candles
function aggregateToCandles(
  swaps: { timestamp: number; price: number; volume: number }[],
  intervalSeconds: number,
  count: number
): CandleData[] {
  if (swaps.length === 0) return [];
  
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - count * intervalSeconds;
  
  // Create time buckets
  const buckets: Map<number, { prices: number[]; volumes: number[] }> = new Map();
  
  // Initialize buckets
  for (let t = startTime; t <= now; t += intervalSeconds) {
    const bucketTime = Math.floor(t / intervalSeconds) * intervalSeconds;
    buckets.set(bucketTime, { prices: [], volumes: [] });
  }
  
  // Fill buckets with swap data
  for (const swap of swaps) {
    const bucketTime = Math.floor(swap.timestamp / intervalSeconds) * intervalSeconds;
    const bucket = buckets.get(bucketTime);
    if (bucket) {
      bucket.prices.push(swap.price);
      bucket.volumes.push(swap.volume);
    }
  }
  
  // Convert buckets to candles
  const candles: CandleData[] = [];
  let lastClose = swaps.length > 0 ? swaps[0].price : 0;
  
  const sortedTimes = Array.from(buckets.keys()).sort((a, b) => a - b);
  
  for (const time of sortedTimes) {
    const bucket = buckets.get(time)!;
    
    if (bucket.prices.length > 0) {
      const open = bucket.prices[0];
      const close = bucket.prices[bucket.prices.length - 1];
      const high = Math.max(...bucket.prices);
      const low = Math.min(...bucket.prices);
      const volume = bucket.volumes.reduce((a, b) => a + b, 0);
      
      candles.push({ time, open, high, low, close, volume });
      lastClose = close;
    } else {
      // No trades in this period, use last close price
      candles.push({
        time,
        open: lastClose,
        high: lastClose,
        low: lastClose,
        close: lastClose,
        volume: 0,
      });
    }
  }
  
  return candles;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  try {
    const { pair: pairAddress } = await params;
    const searchParams = request.nextUrl.searchParams;
    const timeframe = searchParams.get('timeframe') || '1h';
    const count = Math.min(parseInt(searchParams.get('count') || '100'), 500);
    
    const intervalSeconds = TIMEFRAME_SECONDS[timeframe] || 3600;
    
    const appConfig = loadConfig();
    
    if (!appConfig.dex?.enabled) {
      return NextResponse.json(
        { success: false, error: 'DEX feature is not enabled' },
        { status: 404 }
      );
    }
    
    const RPC_URL = appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545';
    const web3 = new Web3(RPC_URL);
    
    // Get wrapped native token address from config
    const wrappedNativeAddress = appConfig.dex?.wrappedNative?.address?.toLowerCase() || '';
    
    // Validate pair address
    if (!web3.utils.isAddress(pairAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid pair address' },
        { status: 400 }
      );
    }
    
    const pairContract = new web3.eth.Contract(PAIR_ABI, pairAddress);
    
    // Get token addresses and decimals
    const [token0Address, token1Address] = await Promise.all([
      pairContract.methods.token0().call() as Promise<string>,
      pairContract.methods.token1().call() as Promise<string>,
    ]);
    
    const token0Contract = new web3.eth.Contract(ERC20_ABI, token0Address);
    const token1Contract = new web3.eth.Contract(ERC20_ABI, token1Address);
    
    const [decimals0Result, decimals1Result] = await Promise.all([
      token0Contract.methods.decimals().call(),
      token1Contract.methods.decimals().call(),
    ]);
    
    const decimals0 = Number(decimals0Result);
    const decimals1 = Number(decimals1Result);
    
    // Determine if price should be inverted to match pairs API
    // pairs API uses: baseToken = non-native, quoteToken = native
    // price = quoteToken per baseToken
    const token0IsWrappedNative = token0Address.toLowerCase() === wrappedNativeAddress;
    const token1IsWrappedNative = token1Address.toLowerCase() === wrappedNativeAddress;
    // If token0 is native, we need to invert the price (show token0/token1 instead of token1/token0)
    const shouldInvertPrice = token0IsWrappedNative;
    
    // Calculate block range based on timeframe
    // Estimate ~15 seconds per block (adjust based on your chain)
    const blockTime = appConfig.network?.blockTime || 15;
    const totalSeconds = count * intervalSeconds;
    const blocksToFetch = Math.ceil(totalSeconds / blockTime);
    
    const currentBlock = await web3.eth.getBlockNumber();
    const fromBlock = Math.max(0, Number(currentBlock) - blocksToFetch);
    
    // Fetch Swap events using eth_getLogs RPC call
    interface SwapLog {
      blockNumber: string;
      blockHash: string;
      data: string;
    }
    
    let swapLogs: SwapLog[] = [];
    try {
      // Use raw RPC call for getLogs
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getLogs',
          params: [{
            address: pairAddress,
            topics: [SWAP_EVENT_SIGNATURE],
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: 'latest',
          }]
        })
      });
      const result = await response.json();
      if (result.result) {
        swapLogs = result.result;
      }
    } catch (eventError) {
      // Some nodes don't support getLogs over large ranges
      console.warn('Failed to fetch swap events:', eventError);
    }
    
    // Process swap events
    const swaps: { timestamp: number; price: number; volume: number }[] = [];
    
    // Cache for block timestamps
    const blockTimestampCache: Map<string, number> = new Map();
    
    // Process events in batches to avoid rate limiting
    const batchSize = 50;
    for (let i = 0; i < swapLogs.length; i += batchSize) {
      const batch = swapLogs.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (log) => {
        try {
          const blockHash = log.blockHash;
          let timestamp: number;
          
          // Check cache first
          if (blockTimestampCache.has(blockHash)) {
            timestamp = blockTimestampCache.get(blockHash)!;
          } else {
            // blockNumber is hex string from RPC response
            const blockNum = typeof log.blockNumber === 'string' 
              ? parseInt(log.blockNumber, 16) 
              : Number(log.blockNumber);
            const block = await web3.eth.getBlock(blockNum);
            timestamp = Number(block.timestamp);
            blockTimestampCache.set(blockHash, timestamp);
          }
          
          // Decode swap event data
          // Data layout: amount0In (32 bytes) + amount1In (32 bytes) + amount0Out (32 bytes) + amount1Out (32 bytes)
          const data = log.data;
          const amount0In = BigInt('0x' + data.slice(2, 66));
          const amount1In = BigInt('0x' + data.slice(66, 130));
          const amount0Out = BigInt('0x' + data.slice(130, 194));
          const amount1Out = BigInt('0x' + data.slice(194, 258));
          
          let price = calculatePriceFromSwap(
            amount0In, amount1In, amount0Out, amount1Out,
            decimals0, decimals1
          );
          
          // Invert price if token0 is wrapped native (to match pairs API direction)
          if (price !== null && shouldInvertPrice) {
            price = 1 / price;
          }
          
          if (price !== null && price > 0) {
            // Calculate volume in base token terms
            const volume = shouldInvertPrice 
              ? Number(amount1In + amount1Out) / (10 ** decimals1)
              : Number(amount0In + amount0Out) / (10 ** decimals0);
            swaps.push({ timestamp, price, volume });
          }
        } catch (err) {
          // Skip problematic events
          console.warn('Error processing swap event:', err);
        }
      }));
    }
    
    // Sort by timestamp
    swaps.sort((a, b) => a.timestamp - b.timestamp);
    
    // If no swap events, generate from current reserves
    let candles: CandleData[] = [];
    
    if (swaps.length === 0) {
      // Get current price from reserves as fallback
      const reservesResult = await pairContract.methods.getReserves().call() as {
        reserve0: string;
        reserve1: string;
      };
      
      const reserve0 = Number(BigInt(reservesResult.reserve0)) / (10 ** decimals0);
      const reserve1 = Number(BigInt(reservesResult.reserve1)) / (10 ** decimals1);
      
      // Calculate price to match pairs API direction
      // Default: token1/token0, inverted: token0/token1
      let currentPrice = reserve0 > 0 ? reserve1 / reserve0 : 0;
      if (shouldInvertPrice) {
        currentPrice = reserve1 > 0 ? reserve0 / reserve1 : 0;
      }
      
      // Generate synthetic candles with slight variation around current price
      const now = Math.floor(Date.now() / 1000);
      
      for (let i = 0; i < count; i++) {
        const time = now - (count - 1 - i) * intervalSeconds;
        const time_aligned = Math.floor(time / intervalSeconds) * intervalSeconds;
        
        // Add small random variation (±1%)
        const variation = (Math.random() - 0.5) * 0.02 * currentPrice;
        const price = currentPrice + variation;
        
        candles.push({
          time: time_aligned,
          open: price,
          high: price * (1 + Math.random() * 0.005),
          low: price * (1 - Math.random() * 0.005),
          close: price,
          volume: 0,
        });
      }
    } else {
      // Aggregate swap data into candles
      candles = aggregateToCandles(swaps, intervalSeconds, count);
    }
    
    return NextResponse.json({
      success: true,
      data: {
        pair: pairAddress,
        timeframe,
        candles,
        swapCount: swaps.length,
        fromBlock,
        toBlock: Number(currentBlock),
      }
    });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chart data' },
      { status: 500 }
    );
  }
}
