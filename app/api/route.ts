/**
 * Etherscan / Blockscout RPC-style API: `/api?module=<module>&action=<action>&...`.
 *
 * Every action is a row of the tables below. Parameters are read through `Params`, which throws
 * `ParamError` for a missing or malformed value; the dispatcher answers that with the API's error
 * envelope (`status: '0'`, the reason in `message`, Etherscan's text in `result`), or with a
 * JSON-RPC "invalid params" error in the `proxy` module. Unknown modules and actions get
 * Etherscan's "Error! Missing Or invalid Module/Action name".
 *
 * Modules and actions (Etherscan and Blockscout names; both are accepted where they differ):
 * - account: balance, balancemulti, balancehistory, eth_get_balance, txlist, txlistinternal,
 *   pendingtxlist, txsbeaconwithdrawal, tokentx, tokennfttx, token1155tx, tokenbalance,
 *   tokenbalancehistory, tokenlist, addresstokenbalance, addresstokennftbalance,
 *   addresstokennftinventory, fundedby, listaccounts, getminedblocks
 * - block: getblockreward, getblockcountdown, getblocknobytime, eth_block_number
 * - transaction: gettxinfo, gettxreceiptstatus, getstatus
 * - token: getToken, getTokenHolders, tokeninfo, tokenholderlist, tokenholdercount, tokenlist
 * - stats: ethsupply, coinsupply, tokensupply, ethprice, coinprice, chainsize, dailytx,
 *   dailytxncount, totalfees
 * - gastracker: gasoracle
 * - contract: getabi, getsourcecode, getcontractcreation, listcontracts, checkverifystatus,
 *   checkproxyverification; POST verifysourcecode, verifyproxycontract
 * - logs: getLogs
 * - proxy: the JSON-RPC reads in lib/api/blockscout/proxy.ts
 *
 * txlistinternal reads the internal transactions tools/internal-txs.ts indexes from call traces,
 * token1155tx the VRC-1155 transfers tools/tokens.ts syncs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePagination } from '@/lib/security';
import { errorResponse, emptyListResponse, rpcErrorResponse } from '@/lib/api/blockscout/shared';
import { Params, ParamError, RespondWith } from '@/lib/api/blockscout/params';
import {
  getBalance,
  getBalanceMulti,
  getBalanceHistory,
  getEthGetBalance,
  getTxList,
  getTokenTransfers,
  getInternalTransactions,
  getPendingTxList,
  getAccountTokenList,
  getTokenBalance,
  getTokenBalanceHistory,
  getAddressTokenBalance,
  getAddressNftBalance,
  getAddressNftInventory,
  getFundedBy,
  listAccounts,
  getMinedBlocks,
  type ListOptions,
} from '@/lib/api/blockscout/account';
import {
  getBlockReward,
  getBlockNoByTime,
  getBlockCountdown,
  getEthBlockNumber,
  getTxInfo,
  getTxStatus,
  getTxReceiptStatus,
  getTokenInfo,
  getTokenInfoEtherscan,
  getTokenHolders,
  getTokenHolderCount,
  getEthSupply,
  getTokenSupply,
  getEthPrice,
  getChainSize,
  getDailyTx,
  getTotalFees,
  getTokenList,
  getGasOracle,
  getContractCreation,
  listContracts,
  getLogs,
  getAbi,
  getSourceCode,
} from '@/lib/api/blockscout/handlers';
import { PROXY_ACTIONS, forwardRpc } from '@/lib/api/blockscout/proxy';
import {
  verifySourceCode,
  checkVerifyStatus,
  verifyProxyContract,
  checkProxyVerification,
} from '@/lib/api/blockscout/verification';
import { enforceRateLimit, withRateLimit } from '@/lib/security/rate-limits';

/** Rows per page Etherscan allows, and returns when a list is asked for without paging. */
const MAX_ROWS = 10000;
/** Pages above this size also count against the stricter `bulk` bucket. */
const BULK_ROWS = 1000;

/** `startblock` / `endblock`: undefined when absent. */
function blockBound(p: Params, name: string): number | undefined {
  const value = p.optional(name);
  if (value === undefined) return undefined;
  if (!/^\d{1,15}$/.test(value)) throw new ParamError('Invalid startblock or endblock');
  return Number(value);
}

/**
 * Paging (`page`, `offset`), order (`sort`) and block range (`startblock`, `endblock`) of the list
 * actions, with Etherscan's limits; `maxRows` caps actions whose rows are large.
 */
function listOptions(request: NextRequest, p: Params, maxRows = MAX_ROWS): ListOptions {
  const pagination = validatePagination(p.optional('page'), p.optional('offset'), maxRows, {
    defaultLimit: maxRows,
  });
  if (pagination.tooDeep) {
    throw new ParamError(`Page too deep: page × offset must not exceed ${pagination.maxOffset}`);
  }
  const startblock = blockBound(p, 'startblock');
  const endblock = blockBound(p, 'endblock');
  if (pagination.limit > BULK_ROWS) {
    const limited = enforceRateLimit(request, 'bulk', { format: 'etherscan' });
    if (limited) throw new RespondWith(limited);
  }
  return {
    page: pagination.page,
    offset: pagination.limit,
    sort: p.optional('sort')?.toLowerCase() === 'asc' ? 'asc' : 'desc',
    startblock,
    endblock,
  };
}

type Action = (p: Params, request: NextRequest) => Promise<Response> | Response;

const TRANSFER_KINDS = { tokentx: 'erc20', tokennfttx: 'erc721', token1155tx: 'erc1155' } as const;

const ACTIONS: Record<string, Record<string, Action>> = {
  account: {
    balance: (p) => getBalance(p.address()),
    balancemulti: (p) => getBalanceMulti(p.addresses('address').join(',')),
    balancehistory: (p) => getBalanceHistory(p.address(), p.integer('blockno')),
    eth_get_balance: (p) => getEthGetBalance(p.address(), p.blockTag('block')),
    txlist: (p, request) => getTxList(p.address(), listOptions(request, p)),
    txlistinternal: (p, request) => {
      const address = p.optionalAddress('address');
      const txhash = p.optional('txhash') === undefined ? undefined : p.hash('txhash');
      const options = listOptions(request, p);
      if (
        !address &&
        !txhash &&
        options.startblock === undefined &&
        options.endblock === undefined
      ) {
        throw new ParamError('Missing address, txhash or startblock / endblock parameter');
      }
      return getInternalTransactions({ address, txhash }, options);
    },
    pendingtxlist: (p, request) => getPendingTxList(p.address(), listOptions(request, p)),
    // a proof-of-work chain has no beacon withdrawals
    txsbeaconwithdrawal: (p) => {
      p.address();
      return emptyListResponse();
    },
    ...Object.fromEntries(
      Object.entries(TRANSFER_KINDS).map(([action, kind]): [string, Action] => [
        action,
        (p, request) => {
          const address = p.optionalAddress('address');
          const contract = p.optionalAddress('contractaddress');
          if (!address && !contract) {
            throw new ParamError('Missing address or contractaddress parameter');
          }
          return getTokenTransfers(kind, address, contract, listOptions(request, p));
        },
      ])
    ),
    tokenbalance: (p) => getTokenBalance(p.address(), p.address('contractaddress')),
    tokenbalancehistory: (p) =>
      getTokenBalanceHistory(p.address(), p.address('contractaddress'), p.integer('blockno')),
    tokenlist: (p) => getAccountTokenList(p.address()),
    addresstokenbalance: (p, request) =>
      getAddressTokenBalance(p.address(), listOptions(request, p)),
    addresstokennftbalance: (p, request) =>
      getAddressNftBalance(p.address(), listOptions(request, p)),
    addresstokennftinventory: (p, request) =>
      getAddressNftInventory(p.address(), p.address('contractaddress'), listOptions(request, p)),
    fundedby: (p) => getFundedBy(p.address()),
    listaccounts: (p, request) => listAccounts(listOptions(request, p)),
    getminedblocks: (p, request) => {
      const { page, offset } = listOptions(request, p);
      return getMinedBlocks(p.address(), page, offset);
    },
  },

  block: {
    getblockreward: (p) => getBlockReward(String(p.integer('blockno'))),
    getblockcountdown: (p) => getBlockCountdown(String(p.integer('blockno'))),
    getblocknobytime: (p) =>
      getBlockNoByTime(
        String(p.integer('timestamp')),
        p.optional('closest') === 'after' ? 'after' : 'before'
      ),
    eth_block_number: () => getEthBlockNumber(),
  },

  transaction: {
    gettxinfo: (p) => getTxInfo(p.hash()),
    getstatus: (p) => getTxStatus(p.hash()),
    gettxreceiptstatus: (p) => getTxReceiptStatus(p.hash()),
  },

  token: {
    gettoken: (p) => getTokenInfo(p.address('contractaddress')),
    tokeninfo: (p) => getTokenInfoEtherscan(p.address('contractaddress')),
    gettokenholders: (p, request) => {
      const { page, offset } = listOptions(request, p);
      return getTokenHolders(p.address('contractaddress'), page, offset, 'blockscout');
    },
    tokenholderlist: (p, request) => {
      const { page, offset } = listOptions(request, p);
      return getTokenHolders(p.address('contractaddress'), page, offset, 'etherscan');
    },
    tokenholdercount: (p) => getTokenHolderCount(p.address('contractaddress')),
    tokenlist: (p, request) => {
      const { page, offset } = listOptions(request, p);
      return getTokenList(page, offset);
    },
  },

  stats: {
    ethsupply: () => getEthSupply(),
    coinsupply: () => getEthSupply(),
    tokensupply: (p) => getTokenSupply(p.address('contractaddress')),
    ethprice: () => getEthPrice('etherscan'),
    coinprice: () => getEthPrice('blockscout'),
    chainsize: () => getChainSize(),
    dailytx: (p) =>
      getDailyTx(p.optional('startdate'), p.optional('enddate'), p.optional('sort') ?? 'asc'),
    dailytxncount: (p) =>
      getDailyTx(p.optional('startdate'), p.optional('enddate'), p.optional('sort') ?? 'asc'),
    totalfees: (p) => getTotalFees(p.required('date')),
  },

  gastracker: {
    gasoracle: () => getGasOracle(),
  },

  contract: {
    getabi: (p) => getAbi(p.address()),
    getsourcecode: (p) => getSourceCode(p.address()),
    getcontractcreation: (p) => getContractCreation(p.addresses('contractaddresses', 5).join(',')),
    listcontracts: (p, request) => {
      const { page, offset } = listOptions(request, p, 1000);
      return listContracts(p.optional('filter')?.toLowerCase(), page, offset);
    },
    checkverifystatus: (p) => checkVerifyStatus(p.required('guid')),
    checkproxyverification: (p) => checkProxyVerification(p.required('guid')),
  },

  logs: {
    getlogs: (p) => {
      const address = p.optionalAddress('address');
      // only the default `and` between topics can be expressed as one node filter
      for (const operator of [
        'topic0_1_opr',
        'topic0_2_opr',
        'topic0_3_opr',
        'topic1_2_opr',
        'topic1_3_opr',
        'topic2_3_opr',
      ]) {
        const value = p.optional(operator);
        if (value && value.toLowerCase() !== 'and') {
          throw new ParamError(`Unsupported ${operator}: only "and" is available`);
        }
      }
      return getLogs(
        address,
        p.optional('fromBlock'),
        p.optional('toBlock'),
        p.optional('topic0'),
        p.optional('topic1'),
        p.optional('topic2'),
        p.optional('topic3'),
        p.integer('page', 1),
        p.integer('offset', 1000)
      );
    },
  },
};

/** POST actions (Etherscan sends contract verification as a form). */
const POST_ACTIONS: Record<
  string,
  Record<string, (params: Record<string, string>) => Promise<Response>>
> = {
  contract: {
    verifysourcecode: (params) =>
      verifySourceCode({
        contractaddress: params.contractaddress || params.address || '',
        sourceCode: params.sourceCode || params.sourcecode || '',
        codeformat: params.codeformat || 'solidity-single-file',
        contractname: params.contractname || '',
        compilerversion: params.compilerversion || '',
        optimizationUsed: params.optimizationUsed || params.optimizationused || '0',
        runs: params.runs || '200',
        constructorArguements: params.constructorArguements || params.constructorarguments || '',
        // '' = not given: a standard JSON input keeps its own settings, a single file gets
        // config.json compiler.defaultEvmVersion or the compiler's default
        evmversion: params.evmversion || '',
        licenseType: params.licenseType || params.licensetype || '',
        libraryname1: params.libraryname1 || '',
        libraryaddress1: params.libraryaddress1 || '',
      }),
    verifyproxycontract: async (params) => {
      const p = new Params(new URLSearchParams(params));
      return verifyProxyContract(p.address('address'), p.optionalAddress('expectedimplementation'));
    },
  },
};

/** Answers a refused request in the module's format. */
function refusal(error: unknown, proxyModule: boolean): Response {
  if (error instanceof RespondWith) return error.response;
  if (error instanceof ParamError) {
    return proxyModule ? rpcErrorResponse(error.message, -32602) : errorResponse(error.message);
  }
  console.error('[Etherscan API] Error:', error);
  return errorResponse('Internal server error');
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api', { format: 'etherscan' });
  if (limited) return limited;

  const p = new Params(new URL(request.url).searchParams);
  const apiModule = p.optional('module')?.toLowerCase() ?? '';
  const action = p.optional('action')?.toLowerCase() ?? '';

  if (apiModule === 'proxy') {
    const build = PROXY_ACTIONS[action];
    if (!build) return errorResponse('Unknown action');
    try {
      return await forwardRpc(build(p));
    } catch (error) {
      return refusal(error, true);
    }
  }

  const actions = ACTIONS[apiModule];
  if (!actions) return errorResponse('Unknown module');
  const handler = actions[action];
  if (!handler) return errorResponse('Unknown action');
  try {
    return await handler(p, request);
  } catch (error) {
    return refusal(error, false);
  }
}

/** Form or JSON body; null when it is neither. */
async function readBody(request: NextRequest): Promise<Record<string, string> | null> {
  const contentType = request.headers.get('content-type') || '';
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const params: Record<string, string> = {};
    (await request.formData()).forEach((value, key) => {
      params[key] = value.toString();
    });
    return params;
  }
  try {
    return (await request.json()) as Record<string, string>;
  } catch {
    return null;
  }
}

// Contract verification (Etherscan / Hardhat / Foundry compatible)
export const POST = withRateLimit(
  'verify',
  async (request: NextRequest) => {
    try {
      const params = await readBody(request);
      if (!params) {
        return errorResponse('Invalid content type. Expected application/json or form-data');
      }
      // module / action may come from the query (/api?module=contract&action=...) or the body
      const query = new URL(request.url).searchParams;
      const apiModule = (query.get('module') || params.module || '').toLowerCase();
      const action = (query.get('action') || params.action || '').toLowerCase();

      const actions = POST_ACTIONS[apiModule];
      if (!actions) return errorResponse('Unknown module');
      const handler = actions[action];
      if (!handler) return errorResponse('Unknown action');
      return await handler(params);
    } catch (error) {
      return refusal(error, false);
    }
  },
  { format: 'etherscan' }
);

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
