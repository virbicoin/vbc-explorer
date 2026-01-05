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
  ShieldCheckIcon,
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
  badge?: string;
  endpoints: ApiEndpoint[];
}

const apiCategories: ApiCategory[] = [
  {
    name: 'Contract Verification (Hardhat/Foundry)',
    icon: <ShieldCheckIcon className="w-6 h-6" />,
    description: 'Etherscan-compatible API for contract verification. Works with Hardhat, Foundry, and other tools.',
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
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=getabi&address=...',
        description: 'Get contract ABI',
        params: ['address (required) - Contract address'],
        response: '{"status":"1","message":"OK","result":"[{...ABI...}]"}',
      },
      {
        method: 'GET',
        path: '/api?module=contract&action=getsourcecode&address=...',
        description: 'Get verified source code',
        params: ['address (required) - Contract address'],
        response: '{"status":"1","message":"OK","result":[{"SourceCode":"...","ABI":"...","ContractName":"...","CompilerVersion":"v0.8.20","OptimizationUsed":"1","Runs":"200",...}]}',
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
        response: '{"hash":"0x...","is_contract":true,"is_verified":true,"name":"MyContract","compiler_version":"0.8.20","abi":[...],...}',
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
        response: '{"hash":"0x...","is_contract":false,"coin_balance":"1000000000000000000","transactions_count":10,...}',
      },
      {
        method: 'GET',
        path: '/api/v2/addresses/[address]/transactions',
        description: 'Get address transactions',
        params: ['address (required)', 'filter (optional) - "to", "from"', 'page (optional)', 'limit (optional)'],
        response: '{"items":[...],"next_page_params":{...}}',
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
      },
      {
        method: 'GET',
        path: '/api/v2/blocks/[numberOrHash]',
        description: 'Get block by number or hash',
        params: ['numberOrHash (required)'],
        response: '{"height":12345,"hash":"0x...","timestamp":"...","miner":{...},...}',
      },
      {
        method: 'GET',
        path: '/api/v2/transactions',
        description: 'Get transactions list',
        params: ['type (optional)', 'page (optional)', 'limit (optional)'],
        response: '{"items":[...],"next_page_params":{...}}',
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
        response: '{"total_blocks":"12345","total_transactions":"67890","average_block_time":13000,...}',
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
        example: 'curl https://explorer.digitalregion.jp/api/total_supply',
      },
      {
        method: 'GET',
        path: '/api/circulating_supply',
        description: 'Circulating supply (plain text)',
        response: '10193657',
      },
    ],
  },
  {
    name: 'Explorer APIs',
    icon: <MagnifyingGlassIcon className="w-6 h-6" />,
    description: 'Explorer-specific endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/stats',
        description: 'Network statistics',
        response: '{"latestBlock": 1274207, "avgBlockTime": "13.41", ...}',
      },
      {
        method: 'GET',
        path: '/api/blocks',
        description: 'Latest blocks',
        params: ['page (optional)', 'limit (optional)'],
      },
      {
        method: 'GET',
        path: '/api/block/[number]',
        description: 'Block details',
        params: ['number (required)'],
      },
      {
        method: 'GET',
        path: '/api/transactions',
        description: 'Latest transactions',
        params: ['page (optional)', 'limit (optional)'],
      },
      {
        method: 'GET',
        path: '/api/tx/[hash]',
        description: 'Transaction details',
        params: ['hash (required)'],
      },
      {
        method: 'GET',
        path: '/api/address/[address]',
        description: 'Address details',
        params: ['address (required)'],
      },
      {
        method: 'GET',
        path: '/api/richlist',
        description: 'Top addresses by balance',
        params: ['page (optional)', 'limit (optional)'],
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
        params: ['type (optional: erc20, erc721, erc1155)'],
      },
      {
        method: 'GET',
        path: '/api/tokens/[address]',
        description: 'Token details',
        params: ['address (required)'],
      },
      {
        method: 'GET',
        path: '/api/tokens/[address]/balance',
        description: 'Token balance',
        params: ['address (required)', 'holder (required)'],
      },
    ],
  },
  {
    name: 'DEX APIs',
    icon: <ArrowsRightLeftIcon className="w-6 h-6" />,
    description: 'DEX trading data and pairs.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/config',
        description: 'DEX configuration',
      },
      {
        method: 'GET',
        path: '/api/dex/pairs',
        description: 'All trading pairs',
      },
      {
        method: 'GET',
        path: '/api/dex/tokens',
        description: 'DEX-tradable tokens',
      },
      {
        method: 'GET',
        path: '/api/dex/chart/[pair]',
        description: 'Price chart data',
        params: ['pair (required)', 'interval (optional)'],
      },
      {
        method: 'GET',
        path: '/api/dex/external-price',
        description: 'External price data',
        response: '{"nativePriceUsd": 0.000217, "totalTvlUsd": 98.41, ...}',
      },
    ],
  },
  {
    name: 'CMC/DefiLlama/GeckoTerminal APIs',
    icon: <ChartBarIcon className="w-6 h-6" />,
    description: 'Third-party compatible DEX endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/dex/cmc/summary',
        description: 'CoinMarketCap DEX summary',
      },
      {
        method: 'GET',
        path: '/api/dex/cmc/ticker',
        description: 'CoinMarketCap ticker',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama',
        description: 'DefiLlama protocol info',
      },
      {
        method: 'GET',
        path: '/api/dex/defillama/tvl',
        description: 'Total Value Locked',
        response: '98.41394513608628',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/pools',
        description: 'GeckoTerminal pools',
      },
      {
        method: 'GET',
        path: '/api/dex/geckoterminal/ohlcv/[pool]',
        description: 'OHLCV candlestick data',
        params: ['pool (required)', 'timeframe (optional)', 'limit (optional)'],
      },
    ],
  },
  {
    name: 'Utility APIs',
    icon: <CodeBracketIcon className="w-6 h-6" />,
    description: 'Utility and configuration endpoints.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/config/client',
        description: 'Client configuration',
      },
      {
        method: 'POST',
        path: '/api/web3relay',
        description: 'Web3 RPC relay',
        params: ['method', 'params'],
      },
      {
        method: 'POST',
        path: '/api/compile',
        description: 'Compile Solidity code',
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
              <p className="text-gray-400 text-sm">VirBiCoin Explorer REST API</p>
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
                https://explorer.digitalregion.jp
              </code>
              <CopyButton text="https://explorer.digitalregion.jp" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="lg:w-56 flex-shrink-0">
            <div className="sticky top-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Categories</h3>
              <nav className="space-y-1">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
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
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                      selectedCategory === category.name
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span className="flex-shrink-0">{category.icon}</span>
                    <span className="truncate">{category.name.split(' - ')[0]}</span>
                    {category.badge && (
                      <span className="ml-auto px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded">
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
                  <a
                    href="https://github.com/virbicoin/vbc-explorer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-gray-400 hover:text-white"
                  >
                    GitHub
                  </a>
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
                <p className="text-gray-400">No endpoints found matching &quot;{searchQuery}&quot;</p>
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
              <li>• Amounts in wei (÷10^18 for VBC)</li>
            </ul>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <h3 className="text-yellow-400 font-semibold text-sm mb-2">🔒 Security</h3>
            <ul className="text-gray-400 text-xs space-y-1">
              <li>• Input validation on all endpoints</li>
              <li>• Security headers included</li>
              <li>
                <a href="https://github.com/virbicoin/vbc-explorer/security" target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">
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
