/**
 * Blockscout-compatible API Endpoint
 *
 * This API follows the Blockscout/Etherscan API standard format.
 * All responses are in JSON format with status, message, and result fields.
 *
 * Usage: /api?module=<module>&action=<action>&...params
 *
 * Supported modules:
 * - account: balance, balancemulti, txlist, tokentx, tokenbalance, getminedblocks, txlistinternal
 * - block: getblockreward, getblocknobytime, eth_block_number
 * - transaction: gettxinfo, gettxreceiptstatus, getstatus
 * - token: getToken, getTokenHolders, tokeninfo, tokenlist
 * - stats: ethsupply, tokensupply, ethprice, chainsize, dailytx
 * - contract: getabi, getsourcecode, getcontractcreation
 * - logs: getLogs
 * - proxy: eth_blockNumber, eth_getBlockByNumber, eth_getTransactionByHash,
 *          eth_getTransactionReceipt, eth_call, eth_getCode, eth_gasPrice, eth_estimateGas
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  isValidAddress,
  isValidHash,
  validatePagination,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '@/lib/security';
import { errorResponse } from '@/lib/api/blockscout/shared';
import {
  getBalance,
  getBalanceMulti,
  getTxList,
  getTokenTx,
  getTokenBalance,
  getMinedBlocks,
  getTxListInternal,
} from '@/lib/api/blockscout/account';
import {
  getBlockReward,
  getBlockNoByTime,
  getTxInfo,
  getTxReceiptStatus,
  getTokenInfo,
  getTokenHolders,
  getEthSupply,
  getTokenSupply,
  getEthPrice,
  getChainSize,
  getDailyTx,
  getTokenList,
  getContractCreation,
  getLogs,
  getAbi,
  getSourceCode,
} from '@/lib/api/blockscout/handlers';
import {
  proxyEthBlockNumber,
  proxyEthGetBlockByNumber,
  proxyEthGetTransactionByHash,
  proxyEthGetTransactionReceipt,
  proxyEthCall,
  proxyEthGetCode,
  proxyEthGasPrice,
  proxyEthEstimateGas,
} from '@/lib/api/blockscout/proxy';
import { verifySourceCode, checkVerifyStatus } from '@/lib/api/blockscout/verification';

// ============================================
// Main Handler
// ============================================

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`blockscout-api:${clientIp}`, 100, 20);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: '0', message: 'Rate limit exceeded', result: null },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  const { searchParams } = new URL(request.url);
  const apiModule = searchParams.get('module')?.toLowerCase();
  const action = searchParams.get('action')?.toLowerCase();

  if (!apiModule || !action) {
    return errorResponse('Missing required parameters: module and action');
  }

  // Validate module and action names (alphanumeric only)
  if (!/^[a-z0-9_]+$/.test(apiModule) || !/^[a-z0-9_]+$/.test(action)) {
    return errorResponse('Invalid module or action format');
  }

  try {
    // Account module
    if (apiModule === 'account') {
      if (action === 'balance') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        return getBalance(address);
      }
      if (action === 'balancemulti') {
        const addresses = searchParams.get('address');
        if (!addresses) return errorResponse('Missing address parameter');
        // Validate all addresses
        const addressList = addresses.split(',');
        for (const addr of addressList) {
          if (!isValidAddress(addr.trim())) {
            return errorResponse(`Invalid address format: ${addr}`);
          }
        }
        return getBalanceMulti(addresses);
      }
      if (action === 'txlist') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        const sort = searchParams.get('sort') || 'desc';
        return getTxList(address, pagination.page, pagination.limit, sort);
      }
      if (action === 'txlistinternal') {
        const address = searchParams.get('address');
        const txhash = searchParams.get('txhash');
        if (address && !isValidAddress(address)) return errorResponse('Invalid address format');
        if (txhash && !isValidHash(txhash)) return errorResponse('Invalid txhash format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTxListInternal(
          address || undefined,
          txhash || undefined,
          pagination.page,
          pagination.limit
        );
      }
      if (action === 'tokentx') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        const contractaddress = searchParams.get('contractaddress') || undefined;
        if (contractaddress && !isValidAddress(contractaddress)) {
          return errorResponse('Invalid contractaddress format');
        }
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTokenTx(address, contractaddress, pagination.page, pagination.limit);
      }
      if (action === 'tokenbalance') {
        const address = searchParams.get('address');
        const contractaddress = searchParams.get('contractaddress');
        if (!address) return errorResponse('Missing address parameter');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        return getTokenBalance(address, contractaddress);
      }
      if (action === 'getminedblocks') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getMinedBlocks(address, pagination.page, pagination.limit);
      }
    }

    // Block module
    if (apiModule === 'block') {
      if (action === 'getblockreward') {
        const blockno = searchParams.get('blockno');
        if (!blockno) return errorResponse('Missing blockno parameter');
        return getBlockReward(blockno);
      }
      if (action === 'getblocknobytime') {
        const timestamp = searchParams.get('timestamp');
        if (!timestamp) return errorResponse('Missing timestamp parameter');
        const closest = searchParams.get('closest') || 'before';
        return getBlockNoByTime(timestamp, closest);
      }
    }

    // Transaction module
    if (apiModule === 'transaction') {
      if (action === 'gettxinfo' || action === 'getstatus') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        if (!isValidHash(txhash)) return errorResponse('Invalid txhash format');
        return getTxInfo(txhash);
      }
      if (action === 'gettxreceiptstatus') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        if (!isValidHash(txhash)) return errorResponse('Invalid txhash format');
        return getTxReceiptStatus(txhash);
      }
    }

    // Token module
    if (apiModule === 'token') {
      if (action === 'gettoken' || action === 'tokeninfo') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        return getTokenInfo(contractaddress);
      }
      if (action === 'gettokenholders') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTokenHolders(contractaddress, pagination.page, pagination.limit);
      }
      if (action === 'tokenlist') {
        const pagination = validatePagination(
          searchParams.get('page'),
          searchParams.get('offset'),
          100
        );
        return getTokenList(pagination.page, pagination.limit);
      }
    }

    // Stats module
    if (apiModule === 'stats') {
      if (action === 'ethsupply' || action === 'coinsupply') {
        return getEthSupply();
      }
      if (action === 'tokensupply') {
        const contractaddress = searchParams.get('contractaddress');
        if (!contractaddress) return errorResponse('Missing contractaddress parameter');
        if (!isValidAddress(contractaddress))
          return errorResponse('Invalid contractaddress format');
        return getTokenSupply(contractaddress);
      }
      if (action === 'ethprice' || action === 'coinprice') {
        return getEthPrice();
      }
      if (action === 'chainsize') {
        return getChainSize();
      }
      if (action === 'dailytx' || action === 'dailytxncount') {
        const startdate = searchParams.get('startdate') || undefined;
        const enddate = searchParams.get('enddate') || undefined;
        const sort = searchParams.get('sort') || 'asc';
        return getDailyTx(startdate, enddate, sort);
      }
    }

    // Contract module
    if (apiModule === 'contract') {
      if (action === 'getabi') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        return getAbi(address);
      }
      if (action === 'getsourcecode') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        if (!isValidAddress(address)) return errorResponse('Invalid address format');
        return getSourceCode(address);
      }
      if (action === 'getcontractcreation') {
        const addresses = searchParams.get('contractaddresses');
        if (!addresses) return errorResponse('Missing contractaddresses parameter');
        // Validate all addresses
        const addressList = addresses.split(',');
        for (const addr of addressList) {
          if (!isValidAddress(addr.trim())) {
            return errorResponse(`Invalid address format: ${addr}`);
          }
        }
        return getContractCreation(addresses);
      }
      // Check verification status (Etherscan/Hardhat compatible)
      if (action === 'checkverifystatus') {
        const guid = searchParams.get('guid');
        if (!guid) return errorResponse('Missing guid parameter');
        return checkVerifyStatus(guid);
      }
    }

    // Logs module
    if (apiModule === 'logs') {
      if (action === 'getlogs') {
        const address = searchParams.get('address') || undefined;
        const fromBlock = searchParams.get('fromBlock') || undefined;
        const toBlock = searchParams.get('toBlock') || undefined;
        const topic0 = searchParams.get('topic0') || undefined;
        const topic1 = searchParams.get('topic1') || undefined;
        const topic2 = searchParams.get('topic2') || undefined;
        const topic3 = searchParams.get('topic3') || undefined;
        const page = parseInt(searchParams.get('page') || '1');
        const offset = parseInt(searchParams.get('offset') || '1000');
        return getLogs(address, fromBlock, toBlock, topic0, topic1, topic2, topic3, page, offset);
      }
    }

    // Proxy module (JSON-RPC)
    if (apiModule === 'proxy') {
      if (action === 'eth_blocknumber') {
        return proxyEthBlockNumber();
      }
      if (action === 'eth_getblockbynumber') {
        const tag = searchParams.get('tag') || 'latest';
        const boolean = searchParams.get('boolean') === 'true';
        return proxyEthGetBlockByNumber(tag, boolean);
      }
      if (action === 'eth_gettransactionbyhash') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        return proxyEthGetTransactionByHash(txhash);
      }
      if (action === 'eth_gettransactionreceipt') {
        const txhash = searchParams.get('txhash');
        if (!txhash) return errorResponse('Missing txhash parameter');
        return proxyEthGetTransactionReceipt(txhash);
      }
      if (action === 'eth_call') {
        const to = searchParams.get('to');
        const data = searchParams.get('data');
        if (!to) return errorResponse('Missing to parameter');
        if (!data) return errorResponse('Missing data parameter');
        const tag = searchParams.get('tag') || 'latest';
        return proxyEthCall(to, data, tag);
      }
      if (action === 'eth_getcode') {
        const address = searchParams.get('address');
        if (!address) return errorResponse('Missing address parameter');
        const tag = searchParams.get('tag') || 'latest';
        return proxyEthGetCode(address, tag);
      }
      if (action === 'eth_gasprice') {
        return proxyEthGasPrice();
      }
      if (action === 'eth_estimategas') {
        const to = searchParams.get('to');
        if (!to) return errorResponse('Missing to parameter');
        const data = searchParams.get('data') || undefined;
        const value = searchParams.get('value') || undefined;
        const from = searchParams.get('from') || undefined;
        return proxyEthEstimateGas(to, data, value, from);
      }
    }

    return errorResponse(`Unknown module/action: ${apiModule}/${action}`);
  } catch (error) {
    console.error('[Blockscout API] Error:', error);
    return errorResponse('Internal server error');
  }
}

// POST Handler for contract verification (Etherscan/Hardhat compatible)
export async function POST(request: NextRequest) {
  // Rate limiting - stricter for verification
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`verify-api:${clientIp}`, 10, 60); // 10 requests per minute
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: '0', message: 'Rate limit exceeded', result: null },
      { status: 429, headers: getSecurityHeaders() }
    );
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let params: Record<string, string> = {};

    // Get module and action from URL query params first
    const { searchParams } = new URL(request.url);
    const queryModule = searchParams.get('module')?.toLowerCase() || '';
    const queryAction = searchParams.get('action')?.toLowerCase() || '';

    // Handle both JSON and form-data (Etherscan uses form-data)
    if (contentType.includes('application/json')) {
      params = await request.json();
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        params[key] = value.toString();
      });
    } else {
      // Try to parse as JSON anyway
      try {
        params = await request.json();
      } catch {
        return errorResponse('Invalid content type. Expected application/json or form-data');
      }
    }

    // Module and action can come from URL query params OR body params
    // URL query params take precedence (for /api?module=contract&action=verifysourcecode style)
    const apiModule = queryModule || (params.module || '').toLowerCase();
    const action = queryAction || (params.action || '').toLowerCase();

    // Contract verification
    if (apiModule === 'contract' && action === 'verifysourcecode') {
      return verifySourceCode({
        contractaddress: params.contractaddress || params.address || '',
        sourceCode: params.sourceCode || params.sourcecode || '',
        codeformat: params.codeformat || 'solidity-single-file',
        contractname: params.contractname || '',
        compilerversion: params.compilerversion || '',
        optimizationUsed: params.optimizationUsed || params.optimizationused || '0',
        runs: params.runs || '200',
        constructorArguements: params.constructorArguements || params.constructorarguments || '',
        evmversion: params.evmversion || 'paris',
        licenseType: params.licenseType || params.licensetype || '',
        libraryname1: params.libraryname1 || '',
        libraryaddress1: params.libraryaddress1 || '',
      });
    }

    // Verify proxy contract (placeholder for future implementation)
    if (apiModule === 'contract' && action === 'verifyproxycontract') {
      return errorResponse('Proxy contract verification not yet implemented');
    }

    return errorResponse(`Unknown POST module/action: ${apiModule}/${action}`);
  } catch (error) {
    console.error('[Blockscout API POST] Error:', error);
    return errorResponse('Internal server error');
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
