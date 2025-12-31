import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

export async function GET() {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Cache-Control': 'public, max-age=60',
  };

  try {
    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);
    const lpTokens = (config.dex?.lpTokens || {}) as Record<
      string,
      {
        address: string;
        name: string;
        symbol: string;
        token0: string;
        token1: string;
      }
    >;

    const result: { [key: string]: object } = {};

    for (const [key, lpToken] of Object.entries(lpTokens)) {
      try {
        const pairContract = new ethers.Contract(lpToken.address, PAIR_ABI, provider);

        const reserves = await pairContract.getReserves();
        const token0Address = await pairContract.token0();
        const token1Address = await pairContract.token1();

        const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

        const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
          token0Contract.symbol(),
          token0Contract.decimals(),
          token1Contract.symbol(),
          token1Contract.decimals(),
        ]);

        const reserve0 = Number(ethers.formatUnits(reserves[0], decimals0));
        const reserve1 = Number(ethers.formatUnits(reserves[1], decimals1));

        if (reserve0 <= 0 || reserve1 <= 0) continue;

        // Calculate price: quote/base (how much quote for 1 base)
        const lastPrice = reserve1 / reserve0;

        // Format display symbols (WVBC -> VBC)
        const displaySymbol0 = symbol0 === 'WVBC' ? 'VBC' : symbol0;
        const displaySymbol1 = symbol1 === 'WVBC' ? 'VBC' : symbol1;
        const pairId = `${displaySymbol0}_${displaySymbol1}`;

        result[pairId] = {
          base_id: token0Address,
          base_name: displaySymbol0,
          base_symbol: displaySymbol0,
          quote_id: token1Address,
          quote_name: displaySymbol1,
          quote_symbol: displaySymbol1,
          last_price: lastPrice.toString(),
          base_volume: '0',
          quote_volume: '0',
          isFrozen: '0',
        };
      } catch (error) {
        console.error(`Error processing pair ${key}:`, error);
      }
    }

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error('CMC Ticker API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers });
  }
}
