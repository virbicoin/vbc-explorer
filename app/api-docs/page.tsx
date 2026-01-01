'use client';

import { useState } from 'react';
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
} from '@heroicons/react/24/outline';

interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  description: string;
  params?: string[];
  response?: string;
  example?: string;
}

interface ApiCategory {
  name: string;
  icon: React.ReactNode;
  description: string;
  endpoints: ApiEndpoint[];
}

const apiCategories: ApiCategory[] = [
  {
    name: 'Blockscout API - Account',
    icon: <WalletIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Account API. Use ?module=account&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=account&action=balance&address=0x...',
        description: 'Get native token balance for address',
        params: ['address (required) - Account address'],
        response: '{"status":"1","message":"OK","result":"1000000000000000000"}',
        example:
          'curl "https://explorer.digitalregion.jp/api?module=account&action=balance&address=0x950302976387b43e042aea242ae8dab8e5c204d1"',
      },
      {
        method: 'GET',
        path: '/api?module=account&action=balancemulti&address=0x...,0x...',
        description: 'Get balance for multiple addresses (max 20)',
        params: ['address (required) - Comma separated addresses'],
        response: '{"status":"1","message":"OK","result":[{"account":"0x...","balance":"..."}]}',
      },
      {
        method: 'GET',
        path: '/api?module=account&action=txlist&address=0x...',
        description: 'Get transactions for address',
        params: [
          'address (required)',
          'page (optional)',
          'offset (optional)',
          'sort (optional: asc/desc)',
        ],
        response: '{"status":"1","message":"OK","result":[{...tx data...}]}',
      },
      {
        method: 'GET',
        path: '/api?module=account&action=txlistinternal&address=0x...',
        description: 'Get internal transactions for address',
        params: ['address (optional)', 'txhash (optional)', 'page (optional)', 'offset (optional)'],
        response: '{"status":"1","message":"OK","result":[{...internal tx data...}]}',
      },
      {
        method: 'GET',
        path: '/api?module=account&action=tokentx&address=0x...',
        description: 'Get token transfers for address',
        params: [
          'address (required)',
          'contractaddress (optional)',
          'page (optional)',
          'offset (optional)',
        ],
        response: '{"status":"1","message":"OK","result":[{...token tx data...}]}',
      },
      {
        method: 'GET',
        path: '/api?module=account&action=tokenbalance&address=0x...&contractaddress=0x...',
        description: 'Get specific token balance for address',
        params: ['address (required)', 'contractaddress (required)'],
        response: '{"status":"1","message":"OK","result":"1000000000000000000"}',
      },
      {
        method: 'GET',
        path: '/api?module=account&action=getminedblocks&address=0x...',
        description: 'Get blocks mined by address',
        params: ['address (required)', 'page (optional)', 'offset (optional)'],
        response:
          '{"status":"1","message":"OK","result":[{"blockNumber":"12345","timeStamp":"...","blockReward":"..."}]}',
      },
    ],
  },
  {
    name: 'Blockscout API - Block',
    icon: <CubeIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Block API. Use ?module=block&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=block&action=getblockreward&blockno=12345',
        description: 'Get block reward information',
        params: ['blockno (required) - Block number'],
        response:
          '{"status":"1","message":"OK","result":{"blockNumber":"12345","blockReward":"8000000000000000000",...}}',
      },
      {
        method: 'GET',
        path: '/api?module=block&action=getblocknobytime&timestamp=1609459200',
        description: 'Get block number by timestamp',
        params: ['timestamp (required) - Unix timestamp', 'closest (optional: before/after)'],
        response: '{"status":"1","message":"OK","result":"12345"}',
      },
    ],
  },
  {
    name: 'Blockscout API - Transaction',
    icon: <ArrowsRightLeftIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Transaction API. Use ?module=transaction&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=transaction&action=gettxinfo&txhash=0x...',
        description: 'Get transaction details',
        params: ['txhash (required) - Transaction hash'],
        response: '{"status":"1","message":"OK","result":{...tx data...}}',
      },
      {
        method: 'GET',
        path: '/api?module=transaction&action=gettxreceiptstatus&txhash=0x...',
        description: 'Get transaction receipt status',
        params: ['txhash (required) - Transaction hash'],
        response: '{"status":"1","message":"OK","result":{"status":"1"}}',
      },
    ],
  },
  {
    name: 'Blockscout API - Token',
    icon: <CircleStackIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Token API. Use ?module=token&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=token&action=gettoken&contractaddress=0x...',
        description: 'Get token information',
        params: ['contractaddress (required) - Token contract address'],
        response:
          '{"status":"1","message":"OK","result":{"name":"Token","symbol":"TKN","decimals":"18",...}}',
      },
      {
        method: 'GET',
        path: '/api?module=token&action=gettokenholders&contractaddress=0x...',
        description: 'Get token holders list',
        params: ['contractaddress (required)', 'page (optional)', 'offset (optional)'],
        response: '{"status":"1","message":"OK","result":[{"address":"0x...","balance":"..."}]}',
      },
      {
        method: 'GET',
        path: '/api?module=token&action=tokenlist',
        description: 'Get all tokens list',
        params: ['page (optional)', 'offset (optional, default: 100)'],
        response:
          '{"status":"1","message":"OK","result":[{"contractAddress":"0x...","name":"...","symbol":"...",...}]}',
      },
    ],
  },
  {
    name: 'Blockscout API - Stats',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Stats API. Use ?module=stats&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=stats&action=ethsupply',
        description: 'Get total native coin supply (in wei)',
        response: '{"status":"1","message":"OK","result":"10193657000000000000000000"}',
        example: 'curl "https://explorer.digitalregion.jp/api?module=stats&action=ethsupply"',
      },
      {
        method: 'GET',
        path: '/api?module=stats&action=tokensupply&contractaddress=0x...',
        description: 'Get token total supply',
        params: ['contractaddress (required) - Token contract address'],
        response: '{"status":"1","message":"OK","result":"1000000000000000000000000"}',
      },
      {
        method: 'GET',
        path: '/api?module=stats&action=ethprice',
        description: 'Get native coin price (placeholder)',
        response: '{"status":"1","message":"OK","result":{"ethbtc":"0","ethusd":"0",...}}',
      },
      {
        method: 'GET',
        path: '/api?module=stats&action=chainsize',
        description: 'Get chain size statistics',
        response:
          '{"status":"1","message":"OK","result":{"blockCount":"...","transactionCount":"...","chainSizeMB":"..."}}',
      },
      {
        method: 'GET',
        path: '/api?module=stats&action=dailytx',
        description: 'Get daily transaction count',
        params: [
          'startdate (optional: YYYY-MM-DD)',
          'enddate (optional: YYYY-MM-DD)',
          'sort (optional: asc/desc)',
        ],
        response:
          '{"status":"1","message":"OK","result":[{"UTCDate":"2025-01-01","transactionCount":123}]}',
      },
    ],
  },
  {
    name: 'Blockscout API - Contract',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Contract API. Use ?module=contract&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=contract&action=getabi&address=0x...',
        description: 'Get contract ABI (verified contracts only)',
        params: ['address (required) - Contract address'],
        response: '{"status":"1","message":"OK","result":"[{...ABI...}]"}',
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=getsourcecode&address=0x...',
        description: 'Get contract source code (verified contracts only)',
        params: ['address (required) - Contract address'],
        response:
          '{"status":"1","message":"OK","result":[{"SourceCode":"...","ABI":"...","ContractName":"...",...}]}',
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=getcontractcreation&contractaddresses=0x...,0x...',
        description: 'Get contract creation info (max 5)',
        params: ['contractaddresses (required) - Comma separated addresses'],
        response:
          '{"status":"1","message":"OK","result":[{"contractAddress":"...","contractCreator":"...","txHash":"..."}]}',
      },
    ],
  },
  {
    name: 'Blockscout API - Logs',
    icon: <DocumentTextIcon className="w-6 h-6" />,
    description:
      'Blockscout/Etherscan compatible Logs API. Use ?module=logs&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=logs&action=getLogs',
        description: 'Get event logs',
        params: [
          'address (optional)',
          'fromBlock (optional)',
          'toBlock (optional)',
          'topic0-3 (optional)',
          'page (optional)',
          'offset (optional)',
        ],
        response:
          '{"status":"1","message":"OK","result":[{"address":"...","topics":[...],"data":"...","blockNumber":"...",...}]}',
      },
    ],
  },
  {
    name: 'Blockscout API - Proxy (JSON-RPC)',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description: 'JSON-RPC proxy endpoints. Use ?module=proxy&action=<action> format.',
    endpoints: [
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_blockNumber',
        description: 'Get current block number (hex)',
        response: '{"status":"1","message":"OK","result":"0x136f0f"}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_getBlockByNumber&tag=latest&boolean=true',
        description: 'Get block by number',
        params: [
          'tag (required: block number or latest/earliest/pending)',
          'boolean (optional: include tx details)',
        ],
        response: '{"status":"1","message":"OK","result":{...block data...}}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_getTransactionByHash&txhash=0x...',
        description: 'Get transaction by hash',
        params: ['txhash (required)'],
        response: '{"status":"1","message":"OK","result":{...tx data...}}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_getTransactionReceipt&txhash=0x...',
        description: 'Get transaction receipt',
        params: ['txhash (required)'],
        response: '{"status":"1","message":"OK","result":{...receipt data...}}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_call&to=0x...&data=0x...',
        description: 'Execute contract call (read-only)',
        params: ['to (required)', 'data (required)', 'tag (optional: latest)'],
        response: '{"status":"1","message":"OK","result":"0x..."}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_getCode&address=0x...',
        description: 'Get contract bytecode',
        params: ['address (required)', 'tag (optional: latest)'],
        response: '{"status":"1","message":"OK","result":"0x..."}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_gasPrice',
        description: 'Get current gas price (hex)',
        response: '{"status":"1","message":"OK","result":"0x3b9aca00"}',
      },
      {
        method: 'GET',
        path: '/api?module=proxy&action=eth_estimateGas&to=0x...',
        description: 'Estimate gas for transaction',
        params: ['to (required)', 'data (optional)', 'value (optional)', 'from (optional)'],
        response: '{"status":"1","message":"OK","result":"0x5208"}',
      },
    ],
  },
  {
    name: 'Supply APIs',
    icon: <CurrencyDollarIcon className="w-6 h-6" />,
    description:
      'CoinGecko / CoinMarketCap compatible supply endpoints. Returns plain text numbers.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/total_supply',
        description: 'Total supply of VBC (plain text number)',
        response: '10193657',
        example: 'curl https://explorer.digitalregion.jp/api/total_supply',
      },
      {
        method: 'GET',
        path: '/api/circulating_supply',
        description: 'Circulating supply of VBC (plain text number)',
        response: '10193657',
        example: 'curl https://explorer.digitalregion.jp/api/circulating_supply',
      },
      {
        method: 'GET',
        path: '/api/total_supply?debug=true',
        description: 'Detailed supply information (JSON)',
        response: '{"blockNumber": "1274207", "totalSupply": 10193657, ...}',
      },
    ],
  },
  {
    name: 'Statistics APIs',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'Network statistics and blockchain metrics.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/stats',
        description: 'Basic network statistics (blocks, transactions, difficulty)',
        response: '{"latestBlock": 1274207, "avgBlockTime": "13.41", ...}',
      },
      {
        method: 'GET',
        path: '/api/blockheight',
        description: 'Current blockchain height',
        response: '{"height": 1274207}',
      },
    ],
  },
  {
    name: 'Block APIs',
    icon: <CubeIcon className="w-6 h-6" />,
    description: 'Block data and information.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/blocks',
        description: 'Latest blocks with pagination',
        params: ['page (optional)', 'limit (optional, default: 15)'],
        response: '{"blocks": [...], "total": 1274207}',
      },
      {
        method: 'GET',
        path: '/api/block/[number]',
        description: 'Specific block details by number',
        params: ['number (required)'],
        example: 'curl https://explorer.digitalregion.jp/api/block/1274207',
      },
    ],
  },
  {
    name: 'Transaction APIs',
    icon: <ArrowsRightLeftIcon className="w-6 h-6" />,
    description: 'Transaction data and history.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/transactions',
        description: 'Latest transactions with pagination',
        params: ['page (optional)', 'limit (optional, default: 15)'],
        response: '{"transactions": [...], "total": 12345}',
      },
      {
        method: 'GET',
        path: '/api/tx/[hash]',
        description: 'Transaction details by hash',
        params: ['hash (required)'],
        example: 'curl https://explorer.digitalregion.jp/api/tx/0x...',
      },
    ],
  },
  {
    name: 'Address APIs',
    icon: <WalletIcon className="w-6 h-6" />,
    description: 'Address information, balances, and transaction history.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/address/[address]',
        description: 'Address details, balance, and transaction history',
        params: ['address (required)'],
        response: '{"address": "0x...", "balance": "1000000000000000000", ...}',
      },
      {
        method: 'GET',
        path: '/api/address/[address]/transactions',
        description: 'Transaction history for an address',
        params: ['address (required)', 'page (optional)', 'limit (optional)'],
      },
      {
        method: 'GET',
        path: '/api/address/[address]/mining',
        description: 'Mining history for an address',
        params: ['address (required)'],
      },
      {
        method: 'GET',
        path: '/api/richlist',
        description: 'Wealth distribution and top addresses',
        params: ['page (optional)', 'limit (optional, default: 50)'],
      },
    ],
  },
  {
    name: 'Token APIs',
    icon: <CircleStackIcon className="w-6 h-6" />,
    description: 'ERC-20, ERC-721, and ERC-1155 token information.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/tokens',
        description: 'List all tracked tokens',
        params: ['type (optional: erc20, erc721, erc1155)'],
        response: '{"tokens": [...], "total": 50}',
      },
      {
        method: 'GET',
        path: '/api/tokens/[address]',
        description: 'Token details, metadata, and holder information',
        params: ['address (required)'],
      },
      {
        method: 'GET',
        path: '/api/tokens/[address]/balance',
        description: 'Token balance for a specific address',
        params: ['address (required)', 'holder (required)'],
      },
    ],
  },
  {
    name: 'Contract APIs',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description: 'Smart contract verification and interaction.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/contract/[address]',
        description: 'Contract details and ABI',
        params: ['address (required)'],
      },
      {
        method: 'GET',
        path: '/api/contract/status/[address]',
        description: 'Contract verification status',
        params: ['address (required)'],
      },
      {
        method: 'POST',
        path: '/api/contract/verify',
        description: 'Submit contract source code for verification',
        params: ['address', 'sourceCode', 'compilerVersion', 'optimizationEnabled'],
      },
      {
        method: 'POST',
        path: '/api/contract/interact',
        description: 'Execute contract function calls (read-only)',
        params: ['address', 'abi', 'functionName', 'args'],
      },
    ],
  },
  {
    name: 'DEX APIs',
    icon: <ArrowsRightLeftIcon className="w-6 h-6" />,
    description: 'Decentralized exchange data and trading pairs.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/config',
        description: 'DEX configuration (router, factory, tokens)',
      },
      {
        method: 'GET',
        path: '/api/dex/pairs',
        description: 'List all trading pairs with reserves',
      },
      {
        method: 'GET',
        path: '/api/dex/tokens',
        description: 'List all DEX-tradable tokens',
      },
      {
        method: 'GET',
        path: '/api/dex/chart/[pair]',
        description: 'Price chart data for a trading pair',
        params: ['pair (required)', 'interval (optional)'],
      },
      {
        method: 'GET',
        path: '/api/dex/external-price',
        description: 'External price data from Exbitron and DefiLlama',
        response:
          '{"nativePriceUsd": 0.000217, "totalTvlUsd": 98.41, "source": {"price": "exbitron", "tvl": "defillama"}}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/external-price"',
      },
    ],
  },
  {
    name: 'CMC DEX APIs',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'CoinMarketCap-compatible DEX endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/cmc/summary',
        description: 'DEX summary with 24h volume and liquidity',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/ticker',
        description: 'All trading pairs with price and volume',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/assets',
        description: 'All assets listed on DEX',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/orderbook/[pair]',
        description: 'Order book for a trading pair (AMM simulation)',
        params: ['pair (required)', 'depth (optional)'],
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/trades/[pair]',
        description: 'Recent trades for a trading pair',
        params: ['pair (required)'],
      },
    ],
  },
  {
    name: 'DefiLlama APIs',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'DefiLlama-compatible endpoints for TVL, pools, and prices.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/defillama',
        description: 'Protocol info with TVL, pools, and social links',
        response:
          '{"id": "virbicoin-dex", "name": "VirBiCoin DEX", "tvl": 98.41, "chainTvls": {...}, "pools": [...]}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/defillama"',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/tvl',
        description: 'Total Value Locked (plain number)',
        response: '98.41394513608628',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/defillama/tvl"',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/pools',
        description: 'Pool data in yields-compatible format',
        response:
          '{"status": "ok", "data": [{"pool": "virbicoin-dex-vbcg-vbc", "chain": "Virbicoin", "tvlUsd": 45.21, ...}]}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/defillama/pools"',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/prices',
        description: 'Token prices with confidence scores',
        response:
          '{"coins": {"virbicoin:0x...": {"symbol": "VBC", "price": 0.000217, "confidence": 0.9, ...}}}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/defillama/prices"',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/historical',
        description: 'Historical TVL data (30 days)',
        response:
          '{"id": "virbicoin-dex", "tvl": 98.41, "chainTvls": {"Virbicoin": {"tvl": [...]}}}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/defillama/historical"',
      },
    ],
  },
  {
    name: 'GeckoTerminal APIs',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'GeckoTerminal-compatible endpoints for DEX metadata and pools.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/info',
        description: 'DEX metadata including network, contracts, and features',
        response:
          '{"name": "VirBiCoin DEX", "network": {...}, "contracts": {...}, "features": {...}}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/geckoterminal/info"',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/pools',
        description: 'Pool data in GeckoTerminal format',
        params: ['include (optional: base_token,quote_token,dex)'],
        response:
          '{"data": [{"id": "virbicoin_0x...", "attributes": {"name": "VBCG/VBC", "reserve_in_usd": "90.42", ...}}]}',
        example: 'curl "https://explorer.digitalregion.jp/api/dex/geckoterminal/pools"',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/ohlcv/[pool]',
        description: 'OHLCV candlestick data for a pool',
        params: [
          'pool (required) - Pool contract address',
          'aggregate (optional: minutes, default 1)',
          'limit (optional: default 100)',
          'currency (optional: usd or token)',
        ],
        response:
          '{"data": {"id": "virbicoin_0x...", "attributes": {"ohlcv_list": [["timestamp", "open", "high", "low", "close", "volume"], ...]}}}',
        example:
          'curl "https://explorer.digitalregion.jp/api/dex/geckoterminal/ohlcv/0x...?aggregate=15&limit=50"',
      },
    ],
  },
  {
    name: 'Search APIs',
    icon: <MagnifyingGlassIcon className="w-6 h-6" />,
    description: 'Search functionality across the blockchain.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/search/blocks-by-miner',
        description: 'Search blocks mined by specific address',
        params: ['miner (required)', 'page (optional)', 'limit (optional)'],
      },
    ],
  },
  {
    name: 'Utility APIs',
    icon: <DocumentTextIcon className="w-6 h-6" />,
    description: 'Utility and configuration endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/config',
        description: 'Explorer configuration',
      },
      {
        method: 'GET',
        path: '/api/config/client',
        description: 'Client-side configuration (safe to expose)',
      },
      {
        method: 'POST',
        path: '/api/web3relay',
        description: 'Web3 RPC relay for blockchain queries',
        params: ['method', 'params'],
      },
      {
        method: 'POST',
        path: '/api/compile',
        description: 'Compile Solidity source code',
        params: ['sourceCode', 'compilerVersion', 'optimizationEnabled'],
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
  const baseUrl = 'https://explorer.digitalregion.jp';
  const fullUrl = `${baseUrl}${endpoint.path}`;

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 hover:bg-gray-800/70 transition-colors">
      <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span
          className={`px-2 py-1 rounded text-xs font-bold ${
            endpoint.method === 'GET'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-blue-500/20 text-blue-400'
          }`}
        >
          {endpoint.method}
        </span>
        <div className="flex-1 min-w-0">
          <code className="text-purple-400 text-sm break-all">{endpoint.path}</code>
          <p className="text-gray-400 text-sm mt-1">{endpoint.description}</p>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="mt-4 pl-12 space-y-3">
          {endpoint.params && endpoint.params.length > 0 && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-2">Parameters</h4>
              <ul className="space-y-1">
                {endpoint.params.map((param, i) => (
                  <li key={i} className="text-sm text-gray-300">
                    <code className="text-yellow-400">{param.split(' ')[0]}</code>
                    <span className="text-gray-500 ml-2">
                      {param.includes('(') ? param.substring(param.indexOf('(')) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {endpoint.response && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-2">Response</h4>
              <div className="bg-gray-900 rounded p-3 flex items-start justify-between">
                <code className="text-green-400 text-xs break-all">{endpoint.response}</code>
                <CopyButton text={endpoint.response} />
              </div>
            </div>
          )}

          {endpoint.example && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-2">Example</h4>
              <div className="bg-gray-900 rounded p-3 flex items-start justify-between">
                <code className="text-cyan-400 text-xs break-all">{endpoint.example}</code>
                <CopyButton text={endpoint.example} />
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs text-gray-500 uppercase mb-2">Try it</h4>
            <div className="bg-gray-900 rounded p-3 flex items-center justify-between">
              <code className="text-gray-400 text-xs break-all">{fullUrl}</code>
              <div className="flex items-center gap-2 ml-2">
                <CopyButton text={fullUrl} />
                {endpoint.method === 'GET' && !endpoint.path.includes('[') && (
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                    title="Open in new tab"
                  >
                    <svg
                      className="w-4 h-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-purple-500/20 rounded-xl">
              <DocumentTextIcon className="w-8 h-8 text-purple-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">API Documentation</h1>
              <p className="text-gray-400 mt-1">VirBiCoin Explorer REST API Reference</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 mt-6">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">Base URL:</span>
              <code className="px-3 py-2 bg-gray-800 rounded-lg text-purple-400 text-sm">
                https://explorer.digitalregion.jp
              </code>
              <CopyButton text="https://explorer.digitalregion.jp" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="sticky top-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Categories</h3>
              <nav className="space-y-1">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
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
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      selectedCategory === category.name
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    {category.icon}
                    <span>{category.name}</span>
                    <span className="ml-auto text-xs text-gray-600">
                      {category.endpoints.length}
                    </span>
                  </button>
                ))}
              </nav>

              <div className="mt-8 p-4 bg-gray-800/50 rounded-xl">
                <h4 className="text-sm font-semibold text-white mb-2">Quick Links</h4>
                <div className="space-y-2 text-sm">
                  <Link href="/" className="block text-purple-400 hover:text-purple-300">
                    ← Back to Explorer
                  </Link>
                  <a
                    href="https://github.com/virbicoin/vbc-explorer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-gray-400 hover:text-white"
                  >
                    GitHub Repository
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-8">
            {filteredCategories.map((category) => (
              <div key={category.name} id={category.name.toLowerCase().replace(/\s+/g, '-')}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-gray-800 rounded-lg text-purple-400">{category.icon}</div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{category.name}</h2>
                    <p className="text-gray-500 text-sm">{category.description}</p>
                  </div>
                </div>

                <div className="space-y-3">
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

      {/* Footer Note */}
      <div className="max-w-7xl mx-auto px-4 pb-12 space-y-4">
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
          <h3 className="text-blue-400 font-semibold mb-2">📝 Notes</h3>
          <ul className="text-gray-400 text-sm space-y-2">
            <li>
              • All endpoints return JSON unless otherwise specified (Supply APIs return plain text)
            </li>
            <li>• Rate limiting: 100 requests per minute for most endpoints</li>
            <li>• CORS is enabled for all endpoints</li>
            <li>• Timestamps are in Unix format (seconds since epoch)</li>
            <li>• All amounts are in wei (divide by 10^18 for VBC)</li>
          </ul>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6">
          <h3 className="text-yellow-400 font-semibold mb-2">🔒 Security</h3>
          <ul className="text-gray-400 text-sm space-y-2">
            <li>
              • All API responses include security headers (X-Content-Type-Options, X-Frame-Options,
              etc.)
            </li>
            <li>• Input validation is enforced on all endpoints (addresses, hashes, pagination)</li>
            <li>• Contract interaction is limited to read-only methods for security</li>
            <li>
              • Report security vulnerabilities to:{' '}
              <a
                href="mailto:security@digitalregion.jp"
                className="text-yellow-400 hover:underline"
              >
                security@digitalregion.jp
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
