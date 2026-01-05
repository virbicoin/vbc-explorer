'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DexConfig {
  enabled: boolean;
  factory: string;
  router: string;
  masterChef: string;
  wrappedNative: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  rewardToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  farmPools: Array<{
    pid: number;
    name: string;
    lpToken: string;
    token0Symbol: string;
    token1Symbol: string;
  }>;
}

interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
}

interface CurrencyConfig {
  name: string;
  symbol: string;
}

interface SocialConfig {
  x?: string;
  twitter?: string;
}

interface DexInfoConfig {
  name: string;
  swapFee: string;
  protocolFee: string;
  lpReward: string;
}

export default function DocsPage() {
  const [dexConfig, setDexConfig] = useState<DexConfig | null>(null);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig | null>(null);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);
  const [socialConfig, setSocialConfig] = useState<SocialConfig | null>(null);
  const [dexInfoConfig, setDexInfoConfig] = useState<DexInfoConfig | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config/client');
        if (response.ok) {
          const data = await response.json();
          setDexConfig(data.dex);
          setNetworkConfig(data.network);
          setCurrencyConfig(data.currency);
          setSocialConfig(data.social);
          // Fetch dexInfo from full config
          const fullConfigResponse = await fetch('/api/dex/config');
          if (fullConfigResponse.ok) {
            const fullConfig = await fullConfigResponse.json();
            setDexInfoConfig(fullConfig.dexInfo);
          }
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };
    fetchConfig();
  }, []);

  const networkName = networkConfig?.name || currencyConfig?.name || 'Network';
  const currencySymbol = currencyConfig?.symbol || 'ETH';
  const dexName = dexInfoConfig?.name || `${networkName} DEX`;
  const swapFee = dexInfoConfig?.swapFee || '0.3%';
  const lpReward = dexInfoConfig?.lpReward || '0.25%';
  const protocolFee = dexInfoConfig?.protocolFee || '0.05%';
  const rewardTokenSymbol = dexConfig?.rewardToken?.symbol || 'REWARD';
  const rewardTokenName = dexConfig?.rewardToken?.name || 'Reward Token';
  const wrappedSymbol = dexConfig?.wrappedNative?.symbol || `W${currencySymbol}`;
  const twitterUrl = socialConfig?.x || socialConfig?.twitter || '';

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-900/50 to-teal-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-cyan-500/20 rounded-xl">
                <svg
                  className="w-8 h-8 text-cyan-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">Documentation</h1>
                <p className="text-gray-400 mt-1">Your complete guide to {dexName}</p>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-2 bg-gray-800/50 rounded-xl p-1">
              <Link
                href="/dex"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Trade
              </Link>
              <Link
                href="/dex/pools"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Pools
              </Link>
              <Link
                href="/dex/analytics"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                Analytics
              </Link>
              <Link
                href="/dex/docs"
                className="px-4 py-2 text-sm font-medium bg-cyan-500/20 text-cyan-400 rounded-lg"
              >
                Docs
              </Link>
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Table of Contents */}
        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50 mb-8">
          <h2 className="text-lg font-bold text-white mb-4">Table of Contents</h2>
          <nav className="space-y-2">
            <a href="#overview" className="block text-green-400 hover:underline">
              1. Overview
            </a>
            <a href="#getting-started" className="block text-green-400 hover:underline">
              2. Getting Started
            </a>
            <a href="#swap" className="block text-green-400 hover:underline">
              3. How to Swap Tokens
            </a>
            <a href="#liquidity" className="block text-green-400 hover:underline">
              4. Providing Liquidity
            </a>
            <a href="#farming" className="block text-green-400 hover:underline">
              5. Yield Farming
            </a>
            <a href="#contracts" className="block text-green-400 hover:underline">
              6. Smart Contracts
            </a>
            <a href="#api" className="block text-green-400 hover:underline">
              7. API Reference
            </a>
            <a href="#faq" className="block text-green-400 hover:underline">
              8. FAQ
            </a>
          </nav>
        </div>

        {/* Content Sections */}
        <div className="space-y-12">
          {/* Overview */}
          <section id="overview" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                1
              </span>
              Overview
            </h2>
            <div className="prose prose-invert max-w-none">
              <p className="text-gray-300 leading-relaxed">
                {dexName} is a decentralized exchange built on the {networkName} network. It uses an
                Automated Market Maker (AMM) model based on the Uniswap V2 protocol, allowing users
                to trade tokens, provide liquidity, and earn rewards through yield farming.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-green-400 font-bold mb-2">Swap Fee</div>
                  <div className="text-white text-2xl font-bold">{swapFee}</div>
                  <div className="text-gray-500 text-sm">Per transaction</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-green-400 font-bold mb-2">LP Reward</div>
                  <div className="text-white text-2xl font-bold">{lpReward}</div>
                  <div className="text-gray-500 text-sm">Goes to LPs</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-green-400 font-bold mb-2">Protocol Fee</div>
                  <div className="text-white text-2xl font-bold">{protocolFee}</div>
                  <div className="text-gray-500 text-sm">Platform sustainability</div>
                </div>
              </div>
            </div>
          </section>

          {/* Getting Started */}
          <section id="getting-started" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                2
              </span>
              Getting Started
            </h2>
            <div className="space-y-4">
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
                <h3 className="font-bold text-white mb-2">Step 1: Connect Your Wallet</h3>
                <p className="text-gray-300">
                  Connect a Web3 wallet (MetaMask, WalletConnect, etc.) to the {networkName}{' '}
                  network.
                </p>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
                <h3 className="font-bold text-white mb-2">Step 2: Add {networkName} Network</h3>
                <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-gray-300 mt-2">
                  <div>Network Name: {networkName}</div>
                  <div>Chain ID: {networkConfig?.chainId || 'N/A'}</div>
                  <div>RPC URL: {networkConfig?.rpcUrl || 'N/A'}</div>
                  <div>Symbol: {currencySymbol}</div>
                  <div>Explorer: {networkConfig?.explorer || 'N/A'}</div>
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
                <h3 className="font-bold text-white mb-2">Step 3: Get {currencySymbol}</h3>
                <p className="text-gray-300">
                  Acquire {currencySymbol} tokens for gas fees and trading. {currencySymbol} is the
                  native currency of the {networkName} network.
                </p>
              </div>
            </div>
          </section>

          {/* Swap */}
          <section id="swap" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                3
              </span>
              How to Swap Tokens
            </h2>
            <div className="prose prose-invert max-w-none">
              <ol className="list-decimal list-inside space-y-3 text-gray-300">
                <li>
                  Navigate to the{' '}
                  <Link href="/dex" className="text-green-400 hover:underline">
                    DEX page
                  </Link>
                </li>
                <li>Select the &quot;Swap&quot; tab</li>
                <li>Choose the token you want to sell (From)</li>
                <li>Choose the token you want to buy (To)</li>
                <li>Enter the amount</li>
                <li>Review the exchange rate and price impact</li>
                <li>Click &quot;Swap&quot; and confirm the transaction in your wallet</li>
              </ol>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mt-4">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-yellow-400 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div>
                    <div className="font-bold text-yellow-400">Slippage Warning</div>
                    <p className="text-gray-300 text-sm">
                      Set appropriate slippage tolerance for volatile tokens. Default is 0.5%. For
                      larger trades, consider 1-3%.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Liquidity */}
          <section id="liquidity" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                4
              </span>
              Providing Liquidity
            </h2>
            <div className="prose prose-invert max-w-none">
              <p className="text-gray-300 leading-relaxed">
                Liquidity providers earn {lpReward} of all trades proportional to their share of the
                pool.
              </p>

              <h3 className="text-lg font-bold text-white mt-6 mb-3">Adding Liquidity</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                <li>Go to the &quot;Pool&quot; tab</li>
                <li>Select the token pair</li>
                <li>Enter the amount for one token (the other will auto-calculate)</li>
                <li>Approve tokens if needed</li>
                <li>Click &quot;Add Liquidity&quot;</li>
                <li>Receive LP tokens representing your share</li>
              </ol>

              <h3 className="text-lg font-bold text-white mt-6 mb-3">Removing Liquidity</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                <li>Go to the &quot;Pool&quot; tab</li>
                <li>Click &quot;Remove&quot; on your liquidity position</li>
                <li>Select the percentage to remove</li>
                <li>Confirm the transaction</li>
              </ol>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mt-4">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-blue-400 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <div className="font-bold text-blue-400">Impermanent Loss</div>
                    <p className="text-gray-300 text-sm">
                      Be aware of impermanent loss when providing liquidity. This occurs when the
                      price ratio of tokens changes from when you deposited.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Farming */}
          <section id="farming" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                5
              </span>
              Yield Farming
            </h2>
            <div className="prose prose-invert max-w-none">
              <p className="text-gray-300 leading-relaxed">
                Stake your LP tokens to earn {rewardTokenSymbol} ({rewardTokenName}) rewards.
              </p>

              <h3 className="text-lg font-bold text-white mt-6 mb-3">How to Farm</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                <li>First, add liquidity to get LP tokens</li>
                <li>Go to the &quot;Farm&quot; tab</li>
                <li>Find your LP pair in the farms list</li>
                <li>Click &quot;Stake&quot; and enter the amount</li>
                <li>Approve and confirm the transaction</li>
                <li>Harvest rewards anytime by clicking &quot;Harvest&quot;</li>
              </ol>

              {dexConfig?.farmPools && dexConfig.farmPools.length > 0 && (
                <div className="bg-gray-800/50 rounded-xl p-4 mt-6 border border-gray-700/50">
                  <h4 className="font-bold text-white mb-2">Available Farms</h4>
                  <div className="space-y-2 text-gray-300">
                    {dexConfig.farmPools.map((pool, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{pool.name}</span>
                        <span className="text-green-400">Earning {rewardTokenSymbol}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Contracts */}
          <section id="contracts" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                6
              </span>
              Smart Contracts
            </h2>
            <div className="space-y-4">
              {dexConfig?.router && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-gray-400 text-sm mb-1">Router (V2)</div>
                  <Link
                    href={`/contract/${dexConfig.router}`}
                    className="text-green-400 hover:underline font-mono text-sm break-all"
                  >
                    {dexConfig.router}
                  </Link>
                </div>
              )}
              {dexConfig?.factory && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-gray-400 text-sm mb-1">Factory</div>
                  <Link
                    href={`/contract/${dexConfig.factory}`}
                    className="text-green-400 hover:underline font-mono text-sm break-all"
                  >
                    {dexConfig.factory}
                  </Link>
                </div>
              )}
              {dexConfig?.masterChef && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-gray-400 text-sm mb-1">MasterChef (Farming)</div>
                  <Link
                    href={`/contract/${dexConfig.masterChef}`}
                    className="text-green-400 hover:underline font-mono text-sm break-all"
                  >
                    {dexConfig.masterChef}
                  </Link>
                </div>
              )}
              {dexConfig?.wrappedNative?.address && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-gray-400 text-sm mb-1">
                    Wrapped {currencySymbol} ({wrappedSymbol})
                  </div>
                  <Link
                    href={`/token/${dexConfig.wrappedNative.address}`}
                    className="text-green-400 hover:underline font-mono text-sm break-all"
                  >
                    {dexConfig.wrappedNative.address}
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* API */}
          <section id="api" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                7
              </span>
              API Reference
            </h2>
            <div className="space-y-4">
              <p className="text-gray-300">
                {dexName} provides public API endpoints compatible with GeckoTerminal and
                CoinMarketCap standards.
              </p>

              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <h4 className="font-bold text-white mb-3">GeckoTerminal Compatible (V2 API)</h4>
                <p className="text-gray-400 text-sm mb-3">
                  Full GeckoTerminal V2 API compatibility for DEX aggregator integration.
                </p>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex items-start gap-2">
                    <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs">
                      GET
                    </span>
                    <span className="text-gray-300">/api/dex/geckoterminal/pools</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs">
                      GET
                    </span>
                    <span className="text-gray-300">/api/dex/geckoterminal/ohlcv/[pool]</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <h4 className="font-bold text-white mb-3">CoinMarketCap Compatible</h4>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex items-start gap-2">
                    <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs">
                      GET
                    </span>
                    <span className="text-gray-300">/api/dex/cmc/summary</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs">
                      GET
                    </span>
                    <span className="text-gray-300">/api/dex/cmc/ticker</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <h4 className="font-bold text-white mb-3">DefiLlama Compatible</h4>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex items-start gap-2">
                    <span className="bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded text-xs">
                      GET
                    </span>
                    <span className="text-gray-300">/api/dex/defillama</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded text-xs">
                      GET
                    </span>
                    <span className="text-gray-300">/api/dex/defillama/tvl</span>
                  </div>
                </div>
              </div>

              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 mt-4">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-cyan-400 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div>
                    <div className="font-bold text-cyan-400">Full API Documentation</div>
                    <p className="text-gray-300 text-sm">
                      For complete API documentation, visit the{' '}
                      <Link href="/api-docs" className="text-cyan-400 hover:underline">
                        API Documentation page
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-8">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">
                8
              </span>
              FAQ
            </h2>
            <div className="space-y-4">
              <details className="bg-gray-800/50 rounded-xl border border-gray-700/50 group">
                <summary className="p-4 cursor-pointer font-medium text-white hover:text-green-400 transition-colors">
                  What is the swap fee?
                </summary>
                <div className="px-4 pb-4 text-gray-300">
                  The swap fee is {swapFee} per trade. Of this, {lpReward} goes to liquidity
                  providers and {protocolFee} goes to the protocol.
                </div>
              </details>

              <details className="bg-gray-800/50 rounded-xl border border-gray-700/50 group">
                <summary className="p-4 cursor-pointer font-medium text-white hover:text-green-400 transition-colors">
                  How do I get {currencySymbol} for gas fees?
                </summary>
                <div className="px-4 pb-4 text-gray-300">
                  You can acquire {currencySymbol} from exchanges that list {networkName} or through
                  mining. Check our official channels for available exchanges.
                </div>
              </details>

              <details className="bg-gray-800/50 rounded-xl border border-gray-700/50 group">
                <summary className="p-4 cursor-pointer font-medium text-white hover:text-green-400 transition-colors">
                  What is {rewardTokenSymbol}?
                </summary>
                <div className="px-4 pb-4 text-gray-300">
                  {rewardTokenSymbol} ({rewardTokenName}) is the reward token distributed to
                  liquidity providers who stake their LP tokens in the farming pools.
                </div>
              </details>

              <details className="bg-gray-800/50 rounded-xl border border-gray-700/50 group">
                <summary className="p-4 cursor-pointer font-medium text-white hover:text-green-400 transition-colors">
                  Is the DEX audited?
                </summary>
                <div className="px-4 pb-4 text-gray-300">
                  The DEX is based on the battle-tested Uniswap V2 codebase. We recommend users do
                  their own research and only invest what they can afford to lose.
                </div>
              </details>
            </div>
          </section>
        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-gray-700/50">
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link href="/dex" className="text-green-400 hover:underline">
              Trade
            </Link>
            <span className="text-gray-600">•</span>
            <Link href="/dex/pools" className="text-green-400 hover:underline">
              Pools
            </Link>
            <span className="text-gray-600">•</span>
            <Link href="/dex/analytics" className="text-green-400 hover:underline">
              Analytics
            </Link>
            {twitterUrl && (
              <>
                <span className="text-gray-600">•</span>
                <a
                  href={twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400 hover:underline"
                >
                  Twitter/X
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
