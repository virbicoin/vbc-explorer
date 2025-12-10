'use client';

import Link from 'next/link';
import { 
  ArrowUpIcon,
  UserIcon,
  CurrencyDollarIcon,
  CheckCircleIcon, 
  ArrowDownIcon,
  ClockIcon,
  CodeBracketIcon,
  HashtagIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { weiToVBC } from '../lib/bigint-utils';

interface TransactionData {
  hash: string;
  blockNumber: number;
  timestamp: string;
  timeAgo: string;
  from: string;
  to: string;
  value: string;
  valueRaw: string;
  gasUsed: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
  status: 'success' | 'failed';
  isContractCreation: boolean;
  contractAddress?: string;
  input: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
  internalTransactions?: Array<{
    type: string;
    from: string;
    to: string;
    value: string;
    gasUsed: string;
  }>;
}

export default function TransactionDetails({ transaction }: { transaction: TransactionData }) {
const formatAddress = (address: string) => {
  if (!address) return 'N/A';
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
};

const formatNumber = (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
    return num.toLocaleString();
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const formatGasPrice = (gasPrice: string) => {
    const num = parseFloat(gasPrice);
    if (isNaN(num)) return gasPrice;
    if (num >= 1e12) return `${(num / 1e12).toFixed(2)} TH`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GH`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)} MH`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)} KH`;
    return `${num.toFixed(2)} H`;
  };

  return (
    <>
      {/* Page Header */}
      <div className='bg-gray-800 border-b border-gray-700'>
        <div className='container mx-auto px-4 py-8'>
          <div className='flex items-center gap-3 mb-4'>
            <ArrowPathIcon className='w-8 h-8 text-green-400' />
            <h1 className='text-3xl font-bold text-gray-100'>Transaction Details</h1>
          </div>
          <div className='flex items-center gap-4'>
            <Link
              href='/'
              className='inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors'
            >
              <ArrowUpIcon className='w-4 h-4' />
              Back to Explorer
            </Link>
            <span className='text-gray-400'>
              Transaction Hash: {transaction.hash.slice(0, 16)}...{transaction.hash.slice(-16)}
            </span>
          </div>
        </div>
      </div>

      <main className='container mx-auto px-4 py-8'>
        {/* Transaction Overview */}
        <section className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-bold text-gray-100 mb-6 flex items-center gap-2'>
            <HashtagIcon className='w-6 h-6 text-green-400' />
            Transaction Overview
          </h2>

          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Transaction Hash</p>
              <Link
                href={`/tx/${transaction.hash}`}
                className='text-sm font-mono text-green-400 hover:text-green-300 break-all bg-gray-700/50 p-3 rounded border border-gray-600 block transition-colors hover:bg-gray-700'
                title={`Transaction: ${transaction.hash}`}
              >
                {transaction.hash}
              </Link>
            </div>

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Status</p>
              <div className='flex items-center gap-2'>
                {transaction.status === 'success' ? (
                  <CheckCircleIcon className='w-5 h-5 text-green-400' />
                ) : (
                  <ArrowDownIcon className='w-5 h-5 text-red-400' />
                )}
                <span className={`text-sm font-medium ${
                  transaction.status === 'success' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {transaction.status === 'success' ? 'Success' : 'Failed'}
                </span>
              </div>
            </div>

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Block Number</p>
              <Link
                href={`/block/${transaction.blockNumber}`}
                className='text-lg font-mono text-blue-400 hover:text-blue-300 hover:underline transition-colors'
              >
                #{transaction.blockNumber.toLocaleString()}
              </Link>
            </div>

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Timestamp</p>
              <div className='flex items-center'>
                <ClockIcon className='w-4 h-4 text-gray-400 mr-2' />
                <div>
                  <div className='text-sm text-gray-300'>{transaction.timeAgo}</div>
                  <div className='text-xs text-gray-500'>{formatTimestamp(parseInt(transaction.timestamp))}</div>
                </div>
              </div>
            </div>

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Value</p>
              <div className='flex items-center gap-2'>
                <CurrencyDollarIcon className='w-5 h-5 text-green-400' />
                <span className='text-lg font-mono text-green-400'>{formatNumber(weiToVBC(transaction.value))}</span>
              </div>
            </div>

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Transaction Index</p>
              <p className='text-lg font-mono text-purple-400'>{transaction.nonce}</p>
            </div>
          </div>
        </section>

        {/* From/To Information */}
        <section className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-bold text-gray-100 mb-6 flex items-center gap-2'>
            <UserIcon className='w-6 h-6 text-blue-400' />
            Address Information
          </h2>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>From</p>
              <Link
                href={`/address/${transaction.from}`}
                className='font-mono text-sm text-blue-400 hover:text-blue-300 break-all bg-gray-700/50 p-3 rounded border border-gray-600 block transition-colors hover:bg-gray-700'
                title={`View account: ${transaction.from}`}
              >
                {formatAddress(transaction.from)}
              </Link>
            </div>

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>To</p>
              <Link
                href={`/address/${transaction.to}`}
                className='font-mono text-sm text-blue-400 hover:text-blue-300 break-all bg-gray-700/50 p-3 rounded border border-gray-600 block transition-colors hover:bg-gray-700'
                title={`View account: ${transaction.to}`}
              >
                {formatAddress(transaction.to)}
              </Link>
            </div>
          </div>
        </section>

        {/* Gas Information */}
        <section className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
          <h2 className='text-xl font-bold text-gray-100 mb-6 flex items-center gap-2'>
            <CodeBracketIcon className='w-6 h-6 text-orange-400' />
            Gas Information
          </h2>

          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Gas Limit</p>
              <p className='font-mono text-sm text-orange-400'>{formatNumber(transaction.gasLimit)}</p>
            </div>

            {transaction.gasUsed && (
              <div className='space-y-2'>
                <p className='text-sm text-gray-400'>Gas Used</p>
                <p className='font-mono text-sm text-orange-400'>
                  {formatNumber(transaction.gasUsed)}
                  <span className='text-xs text-gray-400 ml-2'>
                    ({((parseInt(transaction.gasUsed) / parseInt(transaction.gasLimit)) * 100).toFixed(1)}%)
                  </span>
                </p>
              </div>
            )}

            <div className='space-y-2'>
              <p className='text-sm text-gray-400'>Gas Price</p>
              <p className='font-mono text-sm text-orange-400'>{formatGasPrice(transaction.gasPrice)}</p>
            </div>

            {transaction.nonce !== undefined && (
              <div className='space-y-2'>
                <p className='text-sm text-gray-400'>Nonce</p>
                <p className='font-mono text-sm text-green-400'>{transaction.nonce}</p>
              </div>
            )}
          </div>
        </section>

        {/* Block Information */}
        {transaction.blockNumber && (
          <section className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-8'>
            <h2 className='text-xl font-bold text-gray-100 mb-6'>Block Information</h2>

            <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
              <div className='space-y-2'>
                <p className='text-sm text-gray-400'>Block Hash</p>
                <Link
                  href={`/block/${transaction.blockNumber}`}
                  className='font-mono text-sm text-blue-400 hover:text-blue-300 break-all bg-gray-700/50 p-3 rounded border border-gray-600 block transition-colors hover:bg-gray-700'
                  title={`View block: ${transaction.blockNumber}`}
                >
                  {transaction.blockNumber}
                </Link>
              </div>

              <div className='space-y-2'>
                <p className='text-sm text-gray-400'>Mined by</p>
                <Link
                  href={`/address/${transaction.blockNumber}`}
                  className='text-green-400 hover:text-green-300 transition-colors hover:underline'
                  title={`View miner account: ${transaction.blockNumber}`}
                >
                  {/* This function is no longer used as config is removed. */}
                  {/* Keeping it for now as it might be re-introduced or removed later. */}
                  Unknown
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Input Data */}
        {transaction.input && transaction.input !== '0x' && (
          <section className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
            <h2 className='text-xl font-bold text-gray-100 mb-6'>Input Data</h2>

            <div className='bg-gray-700/50 p-4 rounded border border-gray-600'>
              <p className='font-mono text-xs text-gray-300 break-all'>{transaction.input}</p>
            </div>
          </section>
        )}
      </main>
    </>
  );
} 