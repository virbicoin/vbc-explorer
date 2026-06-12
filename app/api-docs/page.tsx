'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  DocumentTextIcon,
  CubeIcon,
  ArrowsRightLeftIcon,
  WalletIcon,
  CircleStackIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  CodeBracketIcon,
  MagnifyingGlassIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ShieldCheckIcon,
  ArrowTopRightOnSquareIcon,
  RocketLaunchIcon,
  ServerIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';

interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  description: string;
  params?: string[];
  response?: string;
  example?: string;
  sampleUrl?: string;
}

interface ApiCategory {
  name: string;
  icon: React.ReactNode;
  description: string;
  badge?: string;
  endpoints: ApiEndpoint[];
}

const apiCategories: ApiCategory[] = [
  {
    name: 'Contract Verification (Hardhat/Foundry)',
    icon: <ShieldCheckIcon className="w-6 h-6" />,
    description:
      'Etherscan-compatible API for contract verification. Works with Hardhat, Foundry, and other tools.',
    badge: 'Recommended',
    endpoints: [
      {
        method: 'POST',
        path: '/api?module=contract&action=verifysourcecode',
        description: 'Submit contract for verification',
        params: [
          'contractaddress (required) - Contract address',
          'sourceCode (required) - Source code or Standard JSON Input',
          'codeformat (optional) - "solidity-single-file" or "solidity-standard-json-input"',
          'contractname (required) - Contract name (e.g., "MyContract" or "contracts/MyContract.sol:MyContract")',
          'compilerversion (required) - Compiler version (e.g., "v0.8.20+commit.a1b79de6")',
          'optimizationUsed (optional) - "0" or "1"',
          'runs (optional) - Optimization runs (default: 200)',
          'constructorArguements (optional) - ABI-encoded constructor arguments',
        ],
        response: '{"status":"1","message":"OK","result":"guid-for-tracking"}',
        example: 'npx hardhat verify --network virbicoin 0xYourContract "arg1" "arg2"',
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=checkverifystatus&guid=...',
        description: 'Check verification status',
        params: ['guid (required) - GUID from verifysourcecode'],
        response: '{"status":"1","message":"OK","result":"Pass - Verified"}',
        sampleUrl: '/api?module=contract&action=checkverifystatus&guid=example',
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=getabi&address=...',
        description: 'Get contract ABI',
        params: ['address (required) - Contract address'],
        response: '{"status":"1","message":"OK","result":"[{...ABI...}]"}',
        sampleUrl:
          '/api?module=contract&action=getabi&address=0x0000000000000000000000000000000000000000',
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=getsourcecode&address=...',
        description: 'Get verified source code',
        params: ['address (required) - Contract address'],
        response:
          '{"status":"1","message":"OK","result":[{"SourceCode":"...","ABI":"...","ContractName":"...","CompilerVersion":"v0.8.20","OptimizationUsed":"1","Runs":"200",...}]}',
        sampleUrl:
          '/api?module=contract&action=getsourcecode&address=0x0000000000000000000000000000000000000000',
      },
    ],
  },
  {
    name: 'Blockscout API v2 - Smart Contracts',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description: 'Blockscout v2 format for contract verification and information.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v2/smart-contracts/[address]',
        description: 'Get contract information',
        params: ['address (required) - Contract address'],
        response:
          '{"hash":"0x...","is_contract":true,"is_verified":true,"name":"MyContract","compiler_version":"0.8.20","abi":[...],...}',
        sampleUrl: '/api/v2/smart-contracts/0x0000000000000000000000000000000000000000',
      },
      {
        method: 'POST',
        path: '/api/v2/smart-contracts/[address]/verification/via/flattened-code',
        description: 'Verify with flattened source code',
        params: [
          'compiler_version (required)',
          'source_code (required)',
          'is_optimization_enabled (optional)',
          'optimization_runs (optional)',
          'contract_name (optional)',
        ],
        response: '{"message":"Smart-contract verification started"}',
      },
      {
        method: 'POST',
        path: '/api/v2/smart-contracts/[address]/verification/via/standard-input',
        description: 'Verify with Standard JSON Input',
        params: [
          'compiler_version (required)',
          'contract_name (required) - Format: FileName.sol:ContractName',
          'files (required) - Standard JSON Input',
        ],
        response: '{"message":"Smart-contract verification started"}',
      },
    ],
  },
  {
    name: 'Blockscout API v2 - Addresses',
    icon: <WalletIcon className="w-6 h-6" />,
    description: 'Address information and transactions.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v2/addresses/[address]',
        description: 'Get address information',
        params: ['address (required)'],
        response:
          '{"hash":"0x...","is_contract":false,"coin_balance":"1000000000000000000","transactions_count":10,...}',
        sampleUrl: '/api/v2/addresses/0x0000000000000000000000000000000000000000',
      },
      {
        method: 'GET',
        path: '/api/v2/addresses/[address]/transactions',
        description: 'Get address transactions',
        params: [
          'address (required)',
          'filter (optional) - "to", "from"',
          'page (optional)',
          'limit (optional)',
        ],
        response: '{"items":[...],"next_page_params":{...}}',
        sampleUrl:
          '/api/v2/addresses/0x0000000000000000000000000000000000000000/transactions?limit=5',
      },
    ],
  },
  {
    name: 'Blockscout API v2 - Blocks & Transactions',
    icon: <CubeIcon className="w-6 h-6" />,
    description: 'Block and transaction data.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v2/blocks',
        description: 'Get blocks list',
        params: ['page (optional)', 'limit (optional)'],
        response: '{"items":[...],"next_page_params":{...}}',
        sampleUrl: '/api/v2/blocks?limit=5',
      },
      {
        method: 'GET',
        path: '/api/v2/blocks/[numberOrHash]',
        description: 'Get block by number or hash',
        params: ['numberOrHash (required)'],
        response: '{"height":12345,"hash":"0x...","timestamp":"...","miner":{...},...}',
        sampleUrl: '/api/v2/blocks/1',
      },
      {
        method: 'GET',
        path: '/api/v2/transactions',
        description: 'Get transactions list',
        params: ['type (optional)', 'page (optional)', 'limit (optional)'],
        response: '{"items":[...],"next_page_params":{...}}',
        sampleUrl: '/api/v2/transactions?limit=5',
      },
      {
        method: 'GET',
        path: '/api/v2/transactions/[hash]',
        description: 'Get transaction by hash',
        params: ['hash (required)'],
        response: '{"hash":"0x...","block":12345,"from":{...},"to":{...},"value":"...",...}',
      },
      {
        method: 'GET',
        path: '/api/v2/stats',
        description: 'Get network statistics',
        response:
          '{"total_blocks":"12345","total_transactions":"67890","average_block_time":12000,...}',
        sampleUrl: '/api/v2/stats',
      },
    ],
  },
  {
    name: 'Supply APIs',
    icon: <CurrencyDollarIcon className="w-6 h-6" />,
    description: 'CoinGecko/CoinMarketCap compatible supply endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/total_supply',
        description: 'Total supply (plain text)',
        response: '10193657',
        example: 'curl {BASE_URL}/api/total_supply',
        sampleUrl: '/api/total_supply',
      },
      {
        method: 'GET',
        path: '/api/circulating_supply',
        description: 'Circulating supply (plain text)',
        response: '10193657',
        sampleUrl: '/api/circulating_supply',
      },
    ],
  },
  {
    name: 'Explorer APIs - Network & Stats',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'Network statistics, gas prices, and daily data.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/stats',
        description: 'Network statistics overview',
        response:
          '{"latestBlock":1274207,"avgBlockTime":"12.41","difficulty":"...","hashrate":"...","totalTxs":...}',
        sampleUrl: '/api/stats',
      },
      {
        method: 'GET',
        path: '/api/stats/gas',
        description: 'Gas price tracker (slow/standard/fast/instant)',
        response: '{"slow":"1 Gwei","standard":"2 Gwei","fast":"3 Gwei","instant":"5 Gwei"}',
        sampleUrl: '/api/stats/gas',
      },
      {
        method: 'GET',
        path: '/api/stats/daily',
        description: 'Daily statistics (transactions, blocks, gas)',
        params: ['period (optional) - "7d", "30d", "90d" (default: 30d)'],
        response:
          '{"stats":[{"date":"2024-01-01","transactions":100,"blocks":50,"avgGasPrice":"..."}]}',
        sampleUrl: '/api/stats/daily?period=7d',
      },
      {
        method: 'GET',
        path: '/api/network/node',
        description: 'Connected node information',
        response: '{"clientVersion":"...","networkId":...,"chainId":...}',
        sampleUrl: '/api/network/node',
      },
      {
        method: 'GET',
        path: '/api/blockheight',
        description: 'Current block height (plain text)',
        response: '1274207',
        sampleUrl: '/api/blockheight',
      },
    ],
  },
  {
    name: 'Explorer APIs - Blocks & Transactions',
    icon: <CubeIcon className="w-6 h-6" />,
    description: 'Block and transaction endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/blocks',
        description: 'Get latest blocks',
        params: ['page (optional)', 'limit (optional, default: 25)'],
        response: '{"blocks":[...],"total":...,"page":...}',
        sampleUrl: '/api/blocks?limit=5',
      },
      {
        method: 'GET',
        path: '/api/block/[number]',
        description: 'Get block details by number',
        params: ['number (required) - Block number'],
        response:
          '{"number":...,"hash":"0x...","timestamp":...,"miner":"0x...","transactions":[...]}',
        sampleUrl: '/api/block/1',
      },
      {
        method: 'GET',
        path: '/api/transactions',
        description: 'Get latest transactions',
        params: ['page (optional)', 'limit (optional, default: 25)'],
        response: '{"transactions":[...],"total":...,"page":...}',
        sampleUrl: '/api/transactions?limit=5',
      },
      {
        method: 'GET',
        path: '/api/transactions/pending',
        description: 'Get pending transactions',
        response: '{"transactions":[...],"count":...}',
        sampleUrl: '/api/transactions/pending',
      },
      {
        method: 'GET',
        path: '/api/tx/[hash]',
        description: 'Get transaction details by hash',
        params: ['hash (required) - Transaction hash'],
        response:
          '{"hash":"0x...","blockNumber":...,"from":"0x...","to":"0x...","value":"...","status":...}',
      },
    ],
  },
  {
    name: 'Explorer APIs - Addresses',
    icon: <WalletIcon className="w-6 h-6" />,
    description: 'Address information, balances, and transactions.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/address/[address]',
        description: 'Get address details and balance',
        params: ['address (required) - Wallet or contract address'],
        response: '{"address":"0x...","balance":"...","txCount":...,"isContract":...}',
        sampleUrl: '/api/address/0x0000000000000000000000000000000000000000',
      },
      {
        method: 'GET',
        path: '/api/address/[address]/transactions',
        description: 'Get address transaction history',
        params: ['address (required)', 'page (optional)', 'limit (optional)'],
        response: '{"transactions":[...],"total":...}',
        sampleUrl: '/api/address/0x0000000000000000000000000000000000000000/transactions?limit=10',
      },
      {
        method: 'GET',
        path: '/api/address/[address]/tokens',
        description: 'Get tokens held by address',
        params: ['address (required)'],
        response:
          '{"tokens":[{"address":"0x...","name":"...","symbol":"...","balance":"..."},...]}',
        sampleUrl: '/api/address/0x0000000000000000000000000000000000000000/tokens',
      },
      {
        method: 'GET',
        path: '/api/address/[address]/mining',
        description: 'Get mining statistics for address',
        params: ['address (required)'],
        response: '{"blocksFound":...,"totalRewards":"..."}',
      },
      {
        method: 'GET',
        path: '/api/address/[address]/type',
        description: 'Check if address is contract or wallet',
        params: ['address (required)'],
        response: '{"type":"contract"|"wallet"}',
      },
      {
        method: 'GET',
        path: '/api/richlist',
        description: 'Top addresses by balance',
        params: ['page (optional)', 'limit (optional, default: 100)'],
        response: '{"accounts":[{"address":"0x...","balance":"...","percentage":...},...]}',
        sampleUrl: '/api/richlist?limit=10',
      },
    ],
  },
  {
    name: 'Explorer APIs - Contracts',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description: 'Contract listing and interaction.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/contracts',
        description: 'List all deployed contracts',
        params: [
          'page (optional)',
          'limit (optional)',
          'verified (optional) - true/false',
          'type (optional) - token, nft, other',
        ],
        response: '{"contracts":[...],"total":...}',
        sampleUrl: '/api/contracts?limit=10&verified=true',
      },
      {
        method: 'GET',
        path: '/api/contract/[address]',
        description: 'Get contract details',
        params: ['address (required)'],
        response: '{"address":"0x...","verified":...,"name":"...","abi":[...]}',
      },
      {
        method: 'GET',
        path: '/api/contract/status/[address]',
        description: 'Check contract verification status',
        params: ['address (required)'],
        response: '{"verified":true,"name":"MyContract","compiler":"0.8.20"}',
      },
      {
        method: 'POST',
        path: '/api/contract/verify',
        description: 'Submit contract for verification',
        params: [
          'address (required)',
          'sourceCode (required)',
          'compilerVersion (required)',
          'contractName (required)',
          'optimizationEnabled (optional)',
          'runs (optional)',
        ],
        response: '{"success":true,"message":"Contract verified successfully"}',
      },
      {
        method: 'POST',
        path: '/api/contract/interact',
        description: 'Encode/decode contract function calls',
        params: ['address (required)', 'abi (required)', 'method (required)', 'params (optional)'],
        response: '{"data":"0x..."}',
      },
    ],
  },
  {
    name: 'Token APIs',
    icon: <CircleStackIcon className="w-6 h-6" />,
    description: 'ERC-20/721/1155 token information.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/tokens',
        description: 'List all tokens',
        params: ['type (optional) - erc20, erc721, erc1155', 'page (optional)', 'limit (optional)'],
        response:
          '{"tokens":[{"address":"0x...","name":"...","symbol":"...","decimals":...,"totalSupply":"..."},...]}',
        sampleUrl: '/api/tokens?limit=10',
      },
      {
        method: 'GET',
        path: '/api/tokens/[address]',
        description: 'Get token details',
        params: ['address (required) - Token contract address'],
        response:
          '{"address":"0x...","name":"...","symbol":"...","decimals":...,"totalSupply":"...","holders":...}',
      },
      {
        method: 'GET',
        path: '/api/tokens/[address]/balance',
        description: 'Get token balance for a holder',
        params: ['address (required) - Token address', 'holder (required) - Holder address'],
        response: '{"balance":"...","formatted":"..."}',
      },
    ],
  },
  {
    name: 'Search APIs',
    icon: <MagnifyingGlassIcon className="w-6 h-6" />,
    description: 'Search endpoints for blocks, transactions, and addresses.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/search/blocks-by-miner',
        description: 'Search blocks mined by specific address',
        params: ['miner (required) - Miner address', 'page (optional)', 'limit (optional)'],
        response: '{"blocks":[...],"total":...}',
      },
    ],
  },
  {
    name: 'DEX APIs - Core',
    icon: <ArrowsRightLeftIcon className="w-6 h-6" />,
    description: 'DEX trading data, pairs, and pools.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/config',
        description: 'DEX configuration (router, factory addresses)',
        response: '{"router":"0x...","factory":"0x...","weth":"0x...","chainId":...}',
        sampleUrl: '/api/dex/config',
      },
      {
        method: 'GET',
        path: '/api/dex/pairs',
        description: 'All trading pairs with liquidity info',
        response:
          '[{"pairAddress":"0x...","token0":{...},"token1":{...},"reserve0":"...","reserve1":"..."}]',
        sampleUrl: '/api/dex/pairs',
      },
      {
        method: 'GET',
        path: '/api/dex/tokens',
        description: 'All DEX-tradable tokens',
        response:
          '[{"address":"0x...","name":"...","symbol":"...","decimals":...,"logoUrl":"..."}]',
        sampleUrl: '/api/dex/tokens',
      },
      {
        method: 'GET',
        path: '/api/dex/pools/[address]',
        description: 'Get pool details by address',
        params: ['address (required) - Pool/pair address'],
        response: '{"address":"0x...","token0":{...},"token1":{...},"reserves":{...},"tvl":"..."}',
      },
      {
        method: 'GET',
        path: '/api/dex/chart/[pair]',
        description: 'Price chart data for a pair',
        params: [
          'pair (required) - Pair address',
          'interval (optional) - 1h, 4h, 1d',
          'limit (optional)',
        ],
        response:
          '[{"timestamp":...,"open":"...","high":"...","low":"...","close":"...","volume":"..."}]',
      },
      {
        method: 'GET',
        path: '/api/dex/external-price',
        description: 'External price data (native token USD price)',
        response: '{"nativePriceUsd":0.000217,"totalTvlUsd":98.41,"source":"..."}',
        sampleUrl: '/api/dex/external-price',
      },
      {
        method: 'GET',
        path: '/api/dex/stats',
        description: 'DEX statistics (volume, TVL, trades)',
        response: '{"totalPairs":...,"totalTvl":"...","volume24h":"...","trades24h":...}',
        sampleUrl: '/api/dex/stats',
      },
    ],
  },
  {
    name: 'DEX APIs - CoinMarketCap',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'CoinMarketCap DEX API standard endpoints.',
    badge: 'CMC',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/cmc/summary',
        description: 'CMC DEX summary (all trading pairs overview)',
        response:
          '{"trading_pairs":[{"trading_pair":"...","base_currency":"...","quote_currency":"...","last_price":"...","base_volume":"...","quote_volume":"..."}]}',
        sampleUrl: '/api/dex/cmc/summary',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/ticker',
        description: 'CMC ticker (24h trading data per pair)',
        response:
          '{"WVBC_TOKEN":{"base_id":"0x...","quote_id":"0x...","last_price":"...","base_volume":"...","quote_volume":"..."}}',
        sampleUrl: '/api/dex/cmc/ticker',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/assets',
        description: 'CMC assets (all tradable tokens)',
        response:
          '{"0x...":{"name":"...","symbol":"...","unified_cryptoasset_id":...,"circulating_supply":"..."}}',
        sampleUrl: '/api/dex/cmc/assets',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/orderbook/[pair]',
        description: 'CMC orderbook (AMM simulated)',
        params: ['pair (required) - Pair identifier', 'depth (optional)'],
        response: '{"timestamp":...,"bids":[...],"asks":[...]}',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/trades/[pair]',
        description: 'CMC recent trades for a pair',
        params: ['pair (required) - Pair identifier'],
        response:
          '[{"trade_id":"...","price":"...","base_volume":"...","quote_volume":"...","timestamp":...,"type":"buy"|"sell"}]',
      },
    ],
  },
  {
    name: 'DEX APIs - DefiLlama',
    icon: <GlobeAltIcon className="w-6 h-6" />,
    description: 'DefiLlama protocol and TVL endpoints.',
    badge: 'DefiLlama',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/defillama',
        description: 'DefiLlama protocol info',
        response: '{"name":"...","slug":"...","chain":"...","tvl":...}',
        sampleUrl: '/api/dex/defillama',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/tvl',
        description: 'Total Value Locked (plain number)',
        response: '98.41394513608628',
        sampleUrl: '/api/dex/defillama/tvl',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/pools',
        description: 'All pools with TVL',
        response:
          '[{"pool":"0x...","chain":"...","project":"...","symbol":"...","tvlUsd":...,"apy":...}]',
        sampleUrl: '/api/dex/defillama/pools',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/prices',
        description: 'Token prices in USD',
        response: '{"coins":{"virbicoin:0x...":{"price":...,"symbol":"...","timestamp":...}}}',
        sampleUrl: '/api/dex/defillama/prices',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/protocol',
        description: 'Full protocol data',
        response:
          '{"name":"...","description":"...","tvl":[...],"tokensInUsd":[...],"chainTvls":{...}}',
        sampleUrl: '/api/dex/defillama/protocol',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/historical',
        description: 'Historical TVL data',
        params: ['days (optional) - Number of days'],
        response: '[{"date":"...","tvl":...}]',
        sampleUrl: '/api/dex/defillama/historical',
      },
    ],
  },
  {
    name: 'DEX APIs - GeckoTerminal',
    icon: <ServerIcon className="w-6 h-6" />,
    description: 'GeckoTerminal/CoinGecko DEX API standard endpoints.',
    badge: 'GeckoTerminal',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/info',
        description: 'API info and version',
        response: '{"name":"...","version":"...","network":"..."}',
        sampleUrl: '/api/dex/geckoterminal/info',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/networks',
        description: 'Supported networks',
        response: '{"data":[{"id":"...","type":"network","attributes":{...}}]}',
        sampleUrl: '/api/dex/geckoterminal/networks',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/dexes',
        description: 'Supported DEXes on the network',
        response: '{"data":[{"id":"...","type":"dex","attributes":{"name":"..."}}]}',
        sampleUrl: '/api/dex/geckoterminal/dexes',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/pools',
        description: 'All pools',
        response: '{"data":[{"id":"...","type":"pool","attributes":{...},"relationships":{...}}]}',
        sampleUrl: '/api/dex/geckoterminal/pools',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/pool/[address]',
        description: 'Single pool details',
        params: ['address (required) - Pool address'],
        response: '{"data":{"id":"...","type":"pool","attributes":{...}}}',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/new_pools',
        description: 'Recently created pools',
        response: '{"data":[...],"meta":{"total_pages":...}}',
        sampleUrl: '/api/dex/geckoterminal/new_pools',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/trending_pools',
        description: 'Trending pools by volume',
        response: '{"data":[...],"meta":{...}}',
        sampleUrl: '/api/dex/geckoterminal/trending_pools',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/search/pools',
        description: 'Search pools',
        params: ['query (required) - Search term'],
        response: '{"data":[...]}',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/token/[address]',
        description: 'Token info by address',
        params: ['address (required) - Token address'],
        response: '{"data":{"id":"...","type":"token","attributes":{...}}}',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/ohlcv/[pool]',
        description: 'OHLCV candlestick data',
        params: [
          'pool (required) - Pool address',
          'timeframe (optional) - minute, hour, day',
          'aggregate (optional) - Aggregation period',
          'limit (optional) - Number of candles',
        ],
        response: '{"data":{"id":"...","type":"ohlcv","attributes":{"ohlcv_list":[...]}}}',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/trades/[pool]',
        description: 'Recent trades for a pool',
        params: ['pool (required) - Pool address'],
        response: '{"data":[{"id":"...","type":"trade","attributes":{...}}]}',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/simple/price',
        description: 'Simple token price lookup',
        params: ['ids (required) - Token addresses (comma-separated)'],
        response: '{"0x...":{"usd":...,"usd_24h_change":...}}',
      },
    ],
  },
  {
    name: 'Launchpad APIs',
    icon: <RocketLaunchIcon className="w-6 h-6" />,
    description: 'Token launchpad registration and sync.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/launchpad/register',
        description: 'Register a newly created token',
        params: ['tokenAddress (required)', 'transactionHash (required)', 'creator (required)'],
        response: '{"success":true,"token":{...}}',
      },
      {
        method: 'POST',
        path: '/api/launchpad/sync',
        description: 'Sync token factory events',
        response: '{"synced":...,"tokens":[...]}',
      },
    ],
  },
  {
    name: 'Utility APIs',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description: 'Utility, configuration, and realtime endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/config/client',
        description: 'Client-side configuration (currency, network, explorer)',
        response:
          '{"currency":{"symbol":"VBC","name":"VirBiCoin"},"network":{"name":"...","chainId":...},"explorer":{"name":"..."}}',
        sampleUrl: '/api/config/client',
      },
      {
        method: 'POST',
        path: '/api/web3relay',
        description: 'Web3 RPC relay (eth_call, eth_getBalance, etc.)',
        params: ['method (required) - RPC method', 'params (required) - Method params'],
        response: '{"jsonrpc":"2.0","id":1,"result":"..."}',
      },
      {
        method: 'POST',
        path: '/api/compile',
        description: 'Compile Solidity source code',
        params: [
          'sourceCode (required)',
          'compilerVersion (required)',
          'optimizationEnabled (optional)',
          'runs (optional)',
        ],
        response: '{"success":true,"contracts":{...},"errors":[...]}',
      },
      {
        method: 'GET',
        path: '/api/realtime',
        description: 'Realtime data (latest block, pending tx count)',
        response: '{"latestBlock":...,"pendingTxs":...,"gasPrice":"..."}',
        sampleUrl: '/api/realtime',
      },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-gray-700 rounded transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="w-4 h-4 text-green-400" />
      ) : (
        <ClipboardDocumentIcon className="w-4 h-4 text-gray-400" />
      )}
    </button>
  );
}

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800/70 transition-colors">
      <div className="flex items-start gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span
          className={`px-2 py-0.5 rounded text-xs font-bold flex-shrink-0 ${
            endpoint.method === 'GET'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-blue-500/20 text-blue-400'
          }`}
        >
          {endpoint.method}
        </span>
        <div className="flex-1 min-w-0">
          <code className="text-purple-400 text-sm break-all">{endpoint.path}</code>
          <p className="text-gray-500 text-xs mt-0.5">{endpoint.description}</p>
        </div>
        {endpoint.sampleUrl && (
          <a
            href={endpoint.sampleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-gray-600 rounded transition-colors flex-shrink-0"
            title="Try it"
            onClick={(e) => e.stopPropagation()}
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4 text-blue-400" />
          </a>
        )}
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="mt-3 pl-10 space-y-2">
          {endpoint.sampleUrl && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-1">Try it</h4>
              <div className="bg-gray-900 rounded p-2 flex items-center justify-between gap-2">
                <a
                  href={endpoint.sampleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-xs break-all"
                >
                  {endpoint.sampleUrl}
                </a>
                <CopyButton text={endpoint.sampleUrl} />
              </div>
            </div>
          )}

          {endpoint.params && endpoint.params.length > 0 && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-1">Parameters</h4>
              <ul className="space-y-0.5">
                {endpoint.params.map((param, i) => (
                  <li key={i} className="text-xs text-gray-300">
                    <code className="text-yellow-400">{param.split(' ')[0]}</code>
                    <span className="text-gray-500 ml-1">
                      {param.includes('(') ? param.substring(param.indexOf('(')) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {endpoint.response && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-1">Response</h4>
              <div className="bg-gray-900 rounded p-2 flex items-start justify-between">
                <code className="text-green-400 text-xs break-all">{endpoint.response}</code>
                <CopyButton text={endpoint.response} />
              </div>
            </div>
          )}

          {endpoint.example && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-1">Example</h4>
              <div className="bg-gray-900 rounded p-2 flex items-start justify-between">
                <code className="text-cyan-400 text-xs break-all">{endpoint.example}</code>
                <CopyButton text={endpoint.example} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [explorerName, setExplorerName] = useState('Explorer');
  const [baseUrl, setBaseUrl] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('ETH');

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config/client');
        if (response.ok) {
          const data = await response.json();
          setExplorerName(data.explorer?.name || 'Explorer');
          setBaseUrl(data.network?.explorer || window.location.origin);
          setCurrencySymbol(data.currency?.symbol || 'ETH');
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
        setBaseUrl(window.location.origin);
      }
    };
    fetchConfig();
  }, []);

  const filteredCategories = apiCategories
    .map((category) => ({
      ...category,
      endpoints: category.endpoints.filter(
        (endpoint) =>
          endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
          endpoint.description.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter(
      (category) =>
        (selectedCategory === null || category.name === selectedCategory) &&
        (searchQuery === '' || category.endpoints.length > 0)
    );

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-purple-500/20 rounded-xl">
              <DocumentTextIcon className="w-8 h-8 text-purple-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">API Documentation</h1>
              <p className="text-gray-400 text-sm">{explorerName} REST API</p>
            </div>
          </div>

          {/* Search */}
          <div className="flex flex-wrap gap-4 mt-6">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">Base URL:</span>
              <code className="px-2 py-1 bg-gray-800 rounded text-purple-400 text-sm">
                {baseUrl || ''}
              </code>
              <CopyButton text={baseUrl || ''} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="lg:w-72 flex-shrink-0">
            <div className="sticky top-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Categories</h3>
              <nav className="space-y-1">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedCategory === null
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  All Endpoints
                </button>
                {apiCategories.map((category) => (
                  <button
                    key={category.name}
                    onClick={() => setSelectedCategory(category.name)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center gap-2 ${
                      selectedCategory === category.name
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span className="flex-shrink-0">{category.icon}</span>
                    <span className="flex-1 text-left">{category.name.split(' - ')[0]}</span>
                    {category.badge && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded">
                        {category.badge}
                      </span>
                    )}
                  </button>
                ))}
              </nav>

              <div className="mt-6 p-3 bg-gray-800/50 rounded-lg">
                <h4 className="text-xs font-semibold text-white mb-2">Links</h4>
                <div className="space-y-1 text-xs">
                  <Link href="/" className="block text-purple-400 hover:text-purple-300">
                    ← Explorer
                  </Link>
                  <Link href="/stats" className="block text-gray-400 hover:text-white">
                    Statistics
                  </Link>
                  <Link href="/contracts" className="block text-gray-400 hover:text-white">
                    Contracts
                  </Link>
                  <Link href="/contract/verify" className="block text-gray-400 hover:text-white">
                    Verify Contract
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-6">
            {filteredCategories.map((category) => (
              <div key={category.name} id={category.name.toLowerCase().replace(/\s+/g, '-')}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-gray-800 rounded text-purple-400">{category.icon}</div>
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      {category.name}
                      {category.badge && (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                          {category.badge}
                        </span>
                      )}
                    </h2>
                    <p className="text-gray-500 text-xs">{category.description}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {category.endpoints.map((endpoint, i) => (
                    <EndpointCard key={i} endpoint={endpoint} />
                  ))}
                </div>
              </div>
            ))}

            {filteredCategories.length === 0 && (
              <div className="text-center py-12">
                <MagnifyingGlassIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">
                  No endpoints found matching &quot;{searchQuery}&quot;
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h3 className="text-blue-400 font-semibold text-sm mb-2">📝 Notes</h3>
            <ul className="text-gray-400 text-xs space-y-1">
              <li>• Rate limit: 100 requests/minute</li>
              <li>• CORS enabled for all endpoints</li>
              <li>• Amounts in wei (÷10^18 for {currencySymbol})</li>
            </ul>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <h3 className="text-yellow-400 font-semibold text-sm mb-2">🔒 Security</h3>
            <ul className="text-gray-400 text-xs space-y-1">
              <li>• Input validation on all endpoints</li>
              <li>• Security headers included</li>
              <li>
                <a
                  href="https://github.com/virbicoin/vbc-explorer/security"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-yellow-400 hover:underline"
                >
                  Report vulnerabilities
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
