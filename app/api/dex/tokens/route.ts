import { NextResponse } from 'next/server';
import { connectDB } from '@/models/index';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { loadConfig } from '@/lib/config';
import { fetchDexConfig, setMinimalConfig, getNativeToken } from '@/lib/dex/contract-service';

// Load blacklist from config
const config = loadConfig();
const blacklistConfig =
  (config as { blacklist?: { tokens?: { address: string }[]; lpPairs?: { address: string }[] } })
    .blacklist || {};
const BLACKLISTED_TOKENS = (blacklistConfig.tokens || []).map((t) => t.address.toLowerCase());
const BLACKLISTED_LP_PAIRS = (blacklistConfig.lpPairs || []).map((p) => p.address.toLowerCase());

// Helper function to check if address is blacklisted
const isBlacklisted = (address: string): boolean => {
  const addr = address.toLowerCase();
  return BLACKLISTED_TOKENS.includes(addr) || BLACKLISTED_LP_PAIRS.includes(addr);
};

// TokenFactoryV2 ABI for getting token metadata (logoUrl)
const TOKEN_FACTORY_V2_ABI = [
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'tokenInfo',
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'decimals', type: 'uint8' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'logoUrl', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'website', type: 'string' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'isFactoryToken',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Router ABI to get factory address
const ROUTER_ABI = [
  {
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WETH',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WVBC',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Factory ABI for getting pairs
const FACTORY_ABI = [
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Pair ABI for getting tokens
const PAIR_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ERC20 ABI for getting token info
const ERC20_ABI = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Token interface for DEX
interface DexToken {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  verified?: boolean;
  holders?: number;
}

// Get all tokens that have pairs in the DEX (dynamically fetches factory from router)
async function getTokensWithPairs(
  appConfig: ReturnType<typeof loadConfig>
): Promise<{ tokens: Set<string>; wrappedNativeAddress: string }> {
  const RPC_URL =
    appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545';
  const web3 = new Web3(RPC_URL);
  const tokensWithPairs = new Set<string>();

  // Set minimal config for dex service
  setMinimalConfig({
    chainId: appConfig.network?.chainId || 1,
    rpcUrl: RPC_URL,
    explorer: appConfig.network?.explorer || 'https://etherscan.io',
    routerV2: (appConfig.dex?.router ||
      '0x0000000000000000000000000000000000000000') as `0x${string}`,
    masterChefV2: (appConfig.dex?.masterChef ||
      '0x0000000000000000000000000000000000000000') as `0x${string}`,
  });

  // Fetch dynamic config from blockchain
  const dexConfig = await fetchDexConfig();
  const DEX_FACTORY = dexConfig.factory;
  const WRAPPED_NATIVE_ADDRESS = dexConfig.wrappedNative.toLowerCase();

  try {
    const factory = new web3.eth.Contract(FACTORY_ABI, DEX_FACTORY);

    // Get total number of pairs
    const pairsLength = await factory.methods.allPairsLength().call();
    const numPairs = Number(pairsLength);

    console.log(`Found ${numPairs} pairs in DEX factory`);

    // Get all pairs and extract tokens
    for (let i = 0; i < numPairs; i++) {
      try {
        const pairAddress = (await factory.methods.allPairs(i).call()) as string;
        const pair = new web3.eth.Contract(PAIR_ABI, pairAddress);

        const [token0, token1] = await Promise.all([
          pair.methods.token0().call(),
          pair.methods.token1().call(),
        ]);

        // Add both tokens to the set (lowercase for consistency)
        tokensWithPairs.add(String(token0).toLowerCase());
        tokensWithPairs.add(String(token1).toLowerCase());
      } catch (pairError) {
        console.error(`Error getting pair ${i}:`, pairError);
      }
    }

    // If wrapped native is in a pair, also add native token (address 0x0)
    if (tokensWithPairs.has(WRAPPED_NATIVE_ADDRESS)) {
      tokensWithPairs.add('0x0000000000000000000000000000000000000000');
    }
  } catch (error) {
    console.error('Error fetching pairs from factory:', error);
  }

  return { tokens: tokensWithPairs, wrappedNativeAddress: WRAPPED_NATIVE_ADDRESS };
}

export async function GET() {
  try {
    // Load configuration
    const appConfig = loadConfig();

    // Check if DEX is enabled
    if (!appConfig.dex?.enabled) {
      return NextResponse.json({
        tokens: [],
        total: 0,
        message: 'DEX feature is not enabled',
      });
    }

    // Get tokenIcons from config for icon lookup
    const tokenIcons =
      (appConfig as { tokenIcons?: Record<string, { icon?: string; color?: string }> })
        .tokenIcons || {};
    const nativeSymbol = appConfig.currency?.symbol || 'ETH';
    const nativeIconConfig = tokenIcons[nativeSymbol] || {};

    // Get native token info from config with icon from tokenIcons
    const nativeToken = getNativeToken({
      ...appConfig.currency,
      icon: nativeIconConfig.icon,
      color: nativeIconConfig.color,
    });

    // Get tokens that have pairs (also returns wrapped native address)
    const { tokens: tokensWithPairs, wrappedNativeAddress } = await getTokensWithPairs(appConfig);

    if (tokensWithPairs.size === 0) {
      // If no pairs found, return only native token as fallback
      return NextResponse.json({
        tokens: [nativeToken],
        total: 1,
        message: 'No pairs found in DEX',
      });
    }
    await connectDB();
    const db = mongoose.connection.db;

    const resultTokens: DexToken[] = [];

    // Always add native token if wrapped native has pairs
    if (
      tokensWithPairs.has('0x0000000000000000000000000000000000000000') ||
      tokensWithPairs.has(wrappedNativeAddress)
    ) {
      resultTokens.push(nativeToken);
    }

    // Don't show wrapped native - users interact with native directly and
    // the router automatically wraps/unwraps as needed

    if (db) {
      // Get token info from database for tokens that have pairs
      // Exclude wrapped native (we show native instead) and blacklisted tokens
      const pairTokenAddresses = Array.from(tokensWithPairs).filter(
        (addr) =>
          addr !== '0x0000000000000000000000000000000000000000' &&
          addr !== wrappedNativeAddress &&
          !isBlacklisted(addr)
      );

      if (pairTokenAddresses.length > 0) {
        // Get tokens from tokens collection
        const dbTokens = await db
          .collection('tokens')
          .find({
            address: { $in: pairTokenAddresses },
          })
          .toArray();

        // Get contracts for image_url (from contracts collection)
        const dbContracts = await db
          .collection('contracts')
          .find({
            address: { $in: pairTokenAddresses },
          })
          .toArray();

        // Create a map for quick lookup
        const contractsMap = new Map(dbContracts.map((c) => [c.address.toLowerCase(), c]));

        // Try to get logoUrl from TokenFactoryV2 for launchpad tokens
        const RPC_URL =
          appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545';
        const web3 = new Web3(RPC_URL);
        const factoryV2Address = appConfig.launchpad?.factoryAddress;
        const logoUrlCache = new Map<string, string>();

        // If TokenFactoryV2 is configured, try to get logoUrl for factory tokens
        if (factoryV2Address && factoryV2Address !== '0x0000000000000000000000000000000000000000') {
          const factoryV2 = new web3.eth.Contract(TOKEN_FACTORY_V2_ABI, factoryV2Address);

          // Check all tokens in parallel for better performance
          const logoPromises = pairTokenAddresses.map(async (tokenAddr) => {
            try {
              const isFactoryToken = await factoryV2.methods.isFactoryToken(tokenAddr).call();
              if (isFactoryToken) {
                const tokenInfo = (await factoryV2.methods.tokenInfo(tokenAddr).call()) as {
                  logoUrl: string;
                };
                if (tokenInfo.logoUrl) {
                  return { address: tokenAddr.toLowerCase(), logoUrl: tokenInfo.logoUrl };
                }
              }
            } catch (err) {
              // Token might not be from V2 factory, ignore
            }
            return null;
          });

          const logoResults = await Promise.all(logoPromises);
          for (const result of logoResults) {
            if (result) {
              logoUrlCache.set(result.address, result.logoUrl);
            }
          }
        }

        // Build a map of configured token icons from tokenIcons in config.json
        const tokenIcons =
          (appConfig as { tokenIcons?: Record<string, { icon?: string; color?: string }> })
            .tokenIcons || {};
        const configuredTokenIcons = new Map<string, { icon?: string; color?: string }>();

        // Helper to get icon config by symbol
        const getIconBySymbol = (symbol: string) => tokenIcons[symbol] || {};

        // Add wrapped native icon
        if (appConfig.dex?.wrappedNative?.address && appConfig.dex.wrappedNative.symbol) {
          const iconCfg = getIconBySymbol(appConfig.dex.wrappedNative.symbol);
          configuredTokenIcons.set(appConfig.dex.wrappedNative.address.toLowerCase(), iconCfg);
        }

        // Add reward token icon
        if (appConfig.dex?.rewardToken?.address && appConfig.dex.rewardToken.symbol) {
          const iconCfg = getIconBySymbol(appConfig.dex.rewardToken.symbol);
          configuredTokenIcons.set(appConfig.dex.rewardToken.address.toLowerCase(), iconCfg);
        }

        // Add additional configured tokens
        if (appConfig.dex?.tokens) {
          for (const [, tokenData] of Object.entries(
            appConfig.dex.tokens as Record<string, { address: string; symbol?: string }>
          )) {
            if (tokenData.address && tokenData.symbol) {
              const iconCfg = getIconBySymbol(tokenData.symbol);
              configuredTokenIcons.set(tokenData.address.toLowerCase(), iconCfg);
            }
          }
        }

        for (const token of dbTokens) {
          const contractInfo = contractsMap.get(token.address.toLowerCase());
          const configuredIcon = configuredTokenIcons.get(token.address.toLowerCase());
          // Also check tokenIcons directly by symbol
          const symbolIconCfg = getIconBySymbol(token.symbol);
          // Priority: 1. config.json icon by symbol, 2. TokenFactoryV2 logoUrl, 3. contracts collection image_url, 4. config.json icon by address
          const logoURI =
            symbolIconCfg.icon ||
            logoUrlCache.get(token.address.toLowerCase()) ||
            contractInfo?.image_url ||
            configuredIcon?.icon ||
            undefined;
          // Use decimals from DB, only default to 18 if undefined/null (not if 0)
          const decimals = token.decimals !== undefined && token.decimals !== null ? token.decimals : 18;
          resultTokens.push({
            address: token.address as `0x${string}`,
            name: token.name || 'Unknown Token',
            symbol: token.symbol || '???',
            decimals,
            logoURI,
            verified: token.verified || false,
            holders: token.holders || 0,
          });
        }

        // For tokens in pairs but not in DB, fetch info from blockchain
        const tokensNotInDb = pairTokenAddresses.filter(
          (addr) => !dbTokens.some((t) => t.address.toLowerCase() === addr.toLowerCase())
        );

        if (tokensNotInDb.length > 0) {
          // Fetch token info from blockchain in parallel
          const tokenInfoPromises = tokensNotInDb.map(async (addr) => {
            try {
              const tokenContract = new web3.eth.Contract(ERC20_ABI, addr);
              const [name, symbol, decimals] = await Promise.all([
                tokenContract.methods.name().call().catch(() => 'Unknown Token'),
                tokenContract.methods.symbol().call().catch(() => '???'),
                tokenContract.methods.decimals().call().catch(() => 18),
              ]);
              return {
                address: addr as `0x${string}`,
                name: String(name),
                symbol: String(symbol),
                decimals: Number(decimals),
              };
            } catch (err) {
              console.error(`Error fetching token info for ${addr}:`, err);
              return {
                address: addr as `0x${string}`,
                name: 'Unknown Token',
                symbol: '???',
                decimals: 18,
              };
            }
          });

          const tokenInfoResults = await Promise.all(tokenInfoPromises);
          for (const tokenInfo of tokenInfoResults) {
            resultTokens.push(tokenInfo);
          }
        }
      }
    }

    return NextResponse.json({
      tokens: resultTokens,
      total: resultTokens.length,
      pairsCount: tokensWithPairs.size,
    });
  } catch (error) {
    console.error('Error fetching DEX tokens:', error);
    // Return empty list on error
    return NextResponse.json({
      tokens: [],
      total: 0,
      error: 'Failed to fetch tokens',
    });
  }
}
