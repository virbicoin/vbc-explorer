/**
 * Etherscan / Blockscout RPC-style API (`/api?module=&action=`): the list and
 * detail actions answer from the indexed data in the standard field layout.
 * Database actions run against mongodb-memory-server; the node is a spy on the
 * shared viem client, so nothing leaves the process.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, Market, Token, TokenHolder, TokenTransfer, Transaction } from '@/models/index';
import { publicClient } from '@/lib/api/blockscout/shared';
import { GET } from '@/app/api/route';

let mongod: MongoMemoryServer;
let ipCounter = 0;

const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const ALICE = pad('a11ce', 40);
const BOB = pad('b0b', 40);
const CAROL = pad('ca401', 40);
const DAVE = pad('da4e', 40);
const DEPLOYED = pad('c0de', 40);
const ZERO = pad('', 40);
const FUNGIBLE = pad('f001', 40);
const NFT = pad('f002', 40);
const NO_DECIMALS = pad('f003', 40);
const SPAM = pad('f004', 40);
const TX_OK = pad('1', 64);
const TX_FAILED = pad('2', 64);
const TX_CREATE = pad('3', 64);
const TX_OTHER = pad('4', 64);
const TX_NO_RECEIPT = pad('5', 64);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BLOCK_TIME = 10;
const GENESIS_TIME = 1_760_000_000;
const HEAD = 10;

/** Calls the dispatcher from a fresh client IP (the rate limits are per IP). */
async function api(query: string) {
  ipCounter += 1;
  const request = new NextRequest(`https://explorer.example/api?${query}`, {
    headers: { 'x-client-ip': `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
  });
  const response = await GET(request);
  return { status: response.status, body: await response.json() };
}

function nodeAnswers(answers: Record<string, unknown>) {
  return vi.spyOn(publicClient, 'request').mockImplementation((async (args: { method: string }) => {
    if (!(args.method in answers)) throw new Error(`unexpected node call: ${args.method}`);
    const answer = answers[args.method];
    if (answer instanceof Error) throw answer;
    return answer;
  }) as never);
}

const tx = (hash: string, blockNumber: number, transactionIndex: number, rest: object) => ({
  hash,
  blockNumber,
  transactionIndex,
  blockHash: pad(`b${blockNumber}`, 64),
  nonce: blockNumber,
  value: '0',
  gas: 90_000,
  gasUsed: 21_000,
  gasPrice: '1000000000',
  timestamp: GENESIS_TIME + blockNumber * BLOCK_TIME,
  input: '0x',
  status: 1,
  ...rest,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_etherscan');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await Block.collection.insertMany(
    Array.from({ length: HEAD + 1 }, (_, number) => ({
      number,
      hash: pad(`b${number}`, 64),
      miner: DAVE,
      timestamp: GENESIS_TIME + number * BLOCK_TIME,
      gasUsed: 2_000_000,
      gasLimit: 8_000_000,
    }))
  );
  await Transaction.collection.insertMany([
    tx(TX_OK, 5, 0, { from: ALICE, to: BOB, value: '100' }),
    tx(TX_FAILED, 6, 1, {
      from: BOB,
      to: ALICE,
      status: 0,
      gasUsed: 50_000,
      input: `0xa9059cbb${'0'.repeat(128)}`,
    }),
    tx(TX_CREATE, 7, 0, { from: ALICE, to: null, creates: DEPLOYED, input: '0x6080' }),
    tx(TX_OTHER, 8, 0, { from: CAROL, to: DAVE, gasPrice: '3000000000' }),
    tx(TX_NO_RECEIPT, 9, 0, { from: ALICE, to: BOB, status: null, gasPrice: '5000000000' }),
  ]);
  await Token.collection.insertMany([
    {
      address: FUNGIBLE,
      name: 'Good Token',
      symbol: 'GOOD',
      decimals: 6,
      totalSupply: '1000000000',
      holders: 2,
      type: 'VRC-20',
      metadata: { description: 'A good token', website: 'https://good.example' },
    },
    { address: NFT, name: 'Collectible', symbol: 'COL', decimals: 0, holders: 1, type: 'ERC721' },
    { address: NO_DECIMALS, name: 'Points', symbol: 'PTS', decimals: 0, type: 'ERC20' },
    {
      address: SPAM,
      name: 'http://127.0.0.1:2375/version',
      symbol: 'SPAM',
      type: 'ERC20',
      hidden: true,
      hiddenReason: 'url-name',
    },
  ]);
  const at = (blockNumber: number) => new Date((GENESIS_TIME + blockNumber * BLOCK_TIME) * 1000);
  await TokenTransfer.collection.insertMany([
    {
      tokenAddress: FUNGIBLE,
      transactionHash: TX_FAILED,
      from: BOB,
      to: ALICE,
      value: '2500000',
      blockNumber: 6,
      timestamp: at(6),
    },
    {
      tokenAddress: FUNGIBLE,
      transactionHash: TX_OTHER,
      from: CAROL,
      to: DAVE,
      value: '42',
      blockNumber: 8,
      timestamp: at(8),
    },
    {
      tokenAddress: NFT,
      transactionHash: TX_CREATE,
      from: ZERO,
      to: ALICE,
      tokenId: 7,
      blockNumber: 7,
      timestamp: at(7),
    },
    {
      tokenAddress: SPAM,
      transactionHash: TX_OTHER,
      from: CAROL,
      to: ALICE,
      value: '5',
      blockNumber: 8,
      timestamp: at(8),
    },
  ]);
  await TokenHolder.collection.insertMany([
    { tokenAddress: FUNGIBLE, holderAddress: ALICE, balance: '2500000', percentage: 99, rank: 1 },
    { tokenAddress: FUNGIBLE, holderAddress: BOB, balance: '500', percentage: 1, rank: 2 },
    { tokenAddress: FUNGIBLE, holderAddress: CAROL, balance: '0', percentage: 0, rank: 3 },
    { tokenAddress: NFT, holderAddress: ALICE, balance: '1', percentage: 100, rank: 1 },
    { tokenAddress: SPAM, holderAddress: ALICE, balance: '5', percentage: 100, rank: 1 },
  ]);
  await Market.collection.insertOne({
    symbol: 'VBC',
    timestamp: 1_764_000_000_000,
    quoteUSD: 0.000217,
    quoteBTC: 0.0000000021,
  });
});

describe('account/txlist', () => {
  it('lists the transactions of an address, newest first, with their real outcome', async () => {
    const { body } = await api(`module=account&action=txlist&address=${ALICE}`);
    expect(body.status).toBe('1');
    expect(body.result.map((row: { hash: string }) => row.hash)).toEqual([
      TX_NO_RECEIPT,
      TX_CREATE,
      TX_FAILED,
      TX_OK,
    ]);
    const [noReceipt, creation, failed, ok] = body.result;
    expect(ok).toMatchObject({
      blockNumber: '5',
      timeStamp: String(GENESIS_TIME + 50),
      from: ALICE,
      to: BOB,
      value: '100',
      gas: '90000',
      gasUsed: '21000',
      gasPrice: '1000000000',
      isError: '0',
      txreceipt_status: '1',
      contractAddress: '',
      confirmations: '6',
      methodId: '0x',
    });
    expect(failed).toMatchObject({
      isError: '1',
      txreceipt_status: '0',
      transactionIndex: '1',
      methodId: '0xa9059cbb',
    });
    expect(creation).toMatchObject({ to: '', contractAddress: DEPLOYED });
    // saved without a receipt: not an error, receipt status unknown
    expect(noReceipt).toMatchObject({ isError: '0', txreceipt_status: '' });
  });

  it('honours sort, the block range and paging', async () => {
    const range = await api(
      `module=account&action=txlist&address=${ALICE}&sort=asc&startblock=6&endblock=7`
    );
    expect(range.body.result.map((row: { hash: string }) => row.hash)).toEqual([
      TX_FAILED,
      TX_CREATE,
    ]);
    const page = await api(
      `module=account&action=txlist&address=${ALICE}&sort=asc&page=2&offset=2`
    );
    expect(page.body.result.map((row: { hash: string }) => row.hash)).toEqual([
      TX_CREATE,
      TX_NO_RECEIPT,
    ]);
  });

  it('answers an address without transactions the Etherscan way', async () => {
    const { body } = await api(`module=account&action=txlist&address=${pad('dead', 40)}`);
    expect(body).toEqual({ status: '0', message: 'No transactions found', result: [] });
  });

  it('refuses a malformed block range', async () => {
    const { body } = await api(`module=account&action=txlist&address=${ALICE}&startblock=abc`);
    expect(body.status).toBe('0');
    expect(body.message).toBe('Invalid startblock or endblock');
  });
});

describe('account token transfers', () => {
  it('tokentx returns the token transfer events, not the transactions', async () => {
    const { body } = await api(`module=account&action=tokentx&address=${ALICE}`);
    expect(body.status).toBe('1');
    // the NFT transfer belongs to tokennfttx, the spam token is hidden
    expect(body.result).toHaveLength(1);
    expect(body.result[0]).toMatchObject({
      blockNumber: '6',
      timeStamp: String(GENESIS_TIME + 60),
      hash: TX_FAILED,
      from: BOB,
      to: ALICE,
      contractAddress: FUNGIBLE,
      value: '2500000',
      tokenName: 'Good Token',
      tokenSymbol: 'GOOD',
      tokenDecimal: '6',
      nonce: '6',
      transactionIndex: '1',
      gasUsed: '50000',
      confirmations: '5',
    });
    expect(body.result[0]).not.toHaveProperty('tokenID');
  });

  it('tokentx filters by contract, with or without an address', async () => {
    const all = await api(`module=account&action=tokentx&contractaddress=${FUNGIBLE}&sort=asc`);
    expect(all.body.result.map((row: { value: string }) => row.value)).toEqual(['2500000', '42']);
    const mine = await api(
      `module=account&action=tokentx&address=${DAVE}&contractaddress=${FUNGIBLE}`
    );
    expect(mine.body.result.map((row: { value: string }) => row.value)).toEqual(['42']);
    // a hidden token is still reported when it is asked for by address
    const spam = await api(`module=account&action=tokentx&contractaddress=${SPAM}`);
    expect(spam.body.result).toHaveLength(1);
  });

  it('tokentx needs an address or a contract', async () => {
    const { body } = await api('module=account&action=tokentx');
    expect(body).toMatchObject({
      status: '0',
      message: 'Missing address or contractaddress parameter',
    });
  });

  it('tokennfttx returns the NFT transfers with their token id', async () => {
    const { body } = await api(`module=account&action=tokennfttx&address=${ALICE}`);
    expect(body.result).toHaveLength(1);
    expect(body.result[0]).toMatchObject({
      hash: TX_CREATE,
      from: ZERO,
      to: ALICE,
      contractAddress: NFT,
      tokenID: '7',
      tokenName: 'Collectible',
      tokenSymbol: 'COL',
      tokenDecimal: '0',
    });
    expect(body.result[0]).not.toHaveProperty('value');
  });

  it('does not pass ordinary transactions off as internal or ERC-1155 ones', async () => {
    for (const action of ['txlistinternal', 'token1155tx']) {
      const { body } = await api(`module=account&action=${action}&address=${ALICE}`);
      expect(body).toEqual({ status: '0', message: 'No transactions found', result: [] });
    }
  });

  it('tokenlist returns the tokens an address holds', async () => {
    const { body } = await api(`module=account&action=tokenlist&address=${ALICE}`);
    expect(body.result).toEqual([
      {
        balance: '2500000',
        contractAddress: FUNGIBLE,
        decimals: '6',
        name: 'Good Token',
        symbol: 'GOOD',
        type: 'ERC-20',
      },
      {
        balance: '1',
        contractAddress: NFT,
        decimals: '0',
        name: 'Collectible',
        symbol: 'COL',
        type: 'ERC-721',
      },
    ]);
    const none = await api(`module=account&action=tokenlist&address=${DAVE}`);
    expect(none.body).toEqual({ status: '0', message: 'No tokens found', result: [] });
  });
});

describe('token module', () => {
  it('getToken reports zero decimals and the ERC type name', async () => {
    const { body } = await api(`module=token&action=getToken&contractaddress=${NO_DECIMALS}`);
    expect(body.result).toEqual({
      cataloged: true,
      contractAddress: NO_DECIMALS,
      name: 'Points',
      symbol: 'PTS',
      decimals: '0',
      totalSupply: '0',
      type: 'ERC-20',
    });
  });

  it('tokeninfo uses the Etherscan layout', async () => {
    const { body } = await api(`module=token&action=tokeninfo&contractaddress=${FUNGIBLE}`);
    expect(body.result).toEqual([
      {
        contractAddress: FUNGIBLE,
        tokenName: 'Good Token',
        symbol: 'GOOD',
        divisor: '6',
        tokenType: 'ERC20',
        totalSupply: '1000000000',
        blueCheckmark: 'false',
        description: 'A good token',
        website: 'https://good.example',
      },
    ]);
  });

  it('lists the holders from the holder collection in both layouts', async () => {
    const blockscout = await api(`module=token&action=getTokenHolders&contractaddress=${FUNGIBLE}`);
    expect(blockscout.body.result).toEqual([
      { address: ALICE, value: '2500000' },
      { address: BOB, value: '500' },
    ]);
    const etherscan = await api(
      `module=token&action=tokenholderlist&contractaddress=${FUNGIBLE}&page=2&offset=1`
    );
    expect(etherscan.body.result).toEqual([
      { TokenHolderAddress: BOB, TokenHolderQuantity: '500' },
    ]);
    const none = await api(`module=token&action=getTokenHolders&contractaddress=${NO_DECIMALS}`);
    expect(none.body).toEqual({ status: '0', message: 'No token holders found', result: [] });
  });

  it('leaves hidden tokens out of the token list', async () => {
    const { body } = await api('module=token&action=tokenlist');
    const addresses = body.result.map((row: { contractAddress: string }) => row.contractAddress);
    expect(addresses).toHaveLength(3);
    expect(addresses).not.toContain(SPAM);
  });
});

describe('transaction module', () => {
  it('getstatus and gettxreceiptstatus report a failed transaction as failed', async () => {
    const failed = await api(`module=transaction&action=getstatus&txhash=${TX_FAILED}`);
    expect(failed.body.result).toEqual({ isError: '1', errDescription: '' });
    const ok = await api(`module=transaction&action=getstatus&txhash=${TX_OK}`);
    expect(ok.body.result).toEqual({ isError: '0', errDescription: '' });
    const receipt = await api(`module=transaction&action=gettxreceiptstatus&txhash=${TX_FAILED}`);
    expect(receipt.body.result).toEqual({ status: '0' });
    const unknown = await api(
      `module=transaction&action=gettxreceiptstatus&txhash=${TX_NO_RECEIPT}`
    );
    expect(unknown.body.result).toEqual({ status: '' });
  });

  it('gettxinfo has the Blockscout fields, with the logs from the node', async () => {
    nodeAnswers({
      eth_getTransactionReceipt: {
        logs: [{ address: FUNGIBLE, data: '0x01', topics: [TRANSFER_TOPIC], logIndex: '0x3' }],
      },
    });
    const { body } = await api(`module=transaction&action=gettxinfo&txhash=${TX_FAILED}`);
    expect(body.result).toMatchObject({
      blockNumber: '6',
      confirmations: '5',
      from: BOB,
      to: ALICE,
      gasLimit: '90000',
      gasUsed: '50000',
      hash: TX_FAILED,
      success: false,
      timeStamp: String(GENESIS_TIME + 60),
      logs: [{ address: FUNGIBLE, data: '0x01', topics: [TRANSFER_TOPIC], index: '3' }],
    });
  });

  it('gettxinfo still answers when the node does not', async () => {
    nodeAnswers({ eth_getTransactionReceipt: new Error('node down') });
    const { body } = await api(`module=transaction&action=gettxinfo&txhash=${TX_OK}`);
    expect(body.result).toMatchObject({ hash: TX_OK, success: true, logs: [] });
  });
});

describe('block, stats and gas', () => {
  it('getblockcountdown estimates the time to a future block', async () => {
    const { body } = await api(`module=block&action=getblockcountdown&blockno=${HEAD + 10}`);
    expect(body.result).toEqual({
      CurrentBlock: String(HEAD),
      CountdownBlock: String(HEAD + 10),
      RemainingBlock: '10',
      EstimateTimeInSec: '100.0',
    });
    const past = await api('module=block&action=getblockcountdown&blockno=5');
    expect(past.body).toEqual({
      status: '0',
      message: 'NOTOK',
      result: 'Error! Block number already pass',
    });
  });

  it('eth_block_number and eth_get_balance use the JSON-RPC envelope', async () => {
    const node = nodeAnswers({ eth_blockNumber: '0xa', eth_getBalance: '0x10' });
    const head = await api('module=block&action=eth_block_number');
    expect(head.body).toMatchObject({ jsonrpc: '2.0', id: 1, result: '0xa' });
    const balance = await api(`module=account&action=eth_get_balance&address=${ALICE}&block=5`);
    expect(balance.body).toMatchObject({ jsonrpc: '2.0', id: 1, result: '0x10' });
    expect(node).toHaveBeenLastCalledWith({ method: 'eth_getBalance', params: [ALICE, '0x5'] });
  });

  it('ethprice and coinprice return the stored price', async () => {
    const etherscan = await api('module=stats&action=ethprice');
    expect(etherscan.body.result).toEqual({
      ethbtc: '0.0000000021',
      ethbtc_timestamp: '1764000000',
      ethusd: '0.000217',
      ethusd_timestamp: '1764000000',
    });
    const blockscout = await api('module=stats&action=coinprice');
    expect(blockscout.body.result).toMatchObject({
      coin_usd: '0.000217',
      coin_btc: '0.0000000021',
    });
  });

  it('gasoracle derives the tiers from recent transactions', async () => {
    const { body } = await api('module=gastracker&action=gasoracle');
    expect(body.result).toMatchObject({
      LastBlock: String(HEAD),
      SafeGasPrice: '1',
      ProposeGasPrice: '1',
      FastGasPrice: '5',
      suggestBaseFee: '0',
    });
    expect(body.result.gasUsedRatio.split(',')).toHaveLength(5);
  });

  it('getcontractcreation reports the creator and the creating transaction', async () => {
    const { body } = await api(
      `module=contract&action=getcontractcreation&contractaddresses=${DEPLOYED}`
    );
    expect(body.result).toEqual([
      {
        contractAddress: DEPLOYED,
        contractCreator: ALICE,
        txHash: TX_CREATE,
        blockNumber: '7',
        timestamp: String(GENESIS_TIME + 70),
      },
    ]);
  });
});

describe('logs/getLogs', () => {
  const log = {
    address: FUNGIBLE,
    topics: [TRANSFER_TOPIC],
    data: '0x01',
    blockNumber: '0x6',
    blockHash: pad('b6', 64),
    logIndex: '0x0',
    transactionHash: TX_FAILED,
    transactionIndex: '0x1',
  };

  it('forwards the topics by position and adds the block time and gas', async () => {
    const node = nodeAnswers({ eth_getLogs: [log] });
    const topic2 = pad('a11ce', 64);
    const { body } = await api(
      `module=logs&action=getLogs&address=${FUNGIBLE}&fromBlock=1&toBlock=latest&topic0=${TRANSFER_TOPIC}&topic2=${topic2}`
    );
    expect(node).toHaveBeenCalledWith({
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: '0x1',
          toBlock: 'latest',
          address: FUNGIBLE,
          topics: [TRANSFER_TOPIC, null, topic2],
        },
      ],
    });
    expect(body.result).toEqual([
      {
        address: FUNGIBLE,
        topics: [TRANSFER_TOPIC],
        data: '0x01',
        blockNumber: '0x6',
        blockHash: pad('b6', 64),
        timeStamp: `0x${(GENESIS_TIME + 60).toString(16)}`,
        gasPrice: '0x3b9aca00',
        gasUsed: '0xc350',
        logIndex: '0x0',
        transactionHash: TX_FAILED,
        transactionIndex: '0x1',
      },
    ]);
  });

  it('refuses an unfiltered scan, a malformed topic and the unsupported "or"', async () => {
    const node = nodeAnswers({ eth_getLogs: [] });
    const unfiltered = await api('module=logs&action=getLogs&fromBlock=1');
    expect(unfiltered.body.message).toBe('Missing address or topic parameter');
    const malformed = await api(`module=logs&action=getLogs&address=${FUNGIBLE}&topic0=0x12`);
    expect(malformed.body.message).toBe('Invalid topic format');
    const or = await api(
      `module=logs&action=getLogs&address=${FUNGIBLE}&topic0=${TRANSFER_TOPIC}&topic0_1_opr=or`
    );
    expect(or.body.status).toBe('0');
    expect(node).not.toHaveBeenCalled();
  });

  it('answers an empty result the Etherscan way', async () => {
    nodeAnswers({ eth_getLogs: [] });
    const { body } = await api(`module=logs&action=getLogs&address=${FUNGIBLE}`);
    expect(body).toEqual({ status: '0', message: 'No records found', result: [] });
  });
});

describe('proxy module', () => {
  it('returns the node result unchanged in the JSON-RPC envelope', async () => {
    const block = { number: '0xa', hash: pad('b10', 64), transactions: [] };
    const node = nodeAnswers({ eth_blockNumber: '0xa', eth_getBlockByNumber: block });
    const head = await api('module=proxy&action=eth_blockNumber');
    expect(head.body).toEqual({ jsonrpc: '2.0', id: 1, result: '0xa', status: '1', message: 'OK' });
    const byNumber = await api('module=proxy&action=eth_getBlockByNumber&tag=10&boolean=true');
    expect(byNumber.body.result).toEqual(block);
    expect(node).toHaveBeenLastCalledWith({
      method: 'eth_getBlockByNumber',
      params: ['0xa', true],
    });
  });

  it('forwards the added actions with normalized parameters', async () => {
    const node = nodeAnswers({
      eth_getTransactionCount: '0x7',
      eth_getStorageAt: pad('1', 64),
      eth_getBlockTransactionCountByNumber: '0x2',
      eth_call: '0x',
    });
    await api(`module=proxy&action=eth_getTransactionCount&address=${ALICE}&tag=latest`);
    expect(node).toHaveBeenLastCalledWith({
      method: 'eth_getTransactionCount',
      params: [ALICE, 'latest'],
    });
    await api(`module=proxy&action=eth_getStorageAt&address=${FUNGIBLE}&position=0x00&tag=0x0a`);
    expect(node).toHaveBeenLastCalledWith({
      method: 'eth_getStorageAt',
      params: [FUNGIBLE, '0x0', '0xa'],
    });
    await api('module=proxy&action=eth_getBlockTransactionCountByNumber&tag=0x6');
    expect(node).toHaveBeenLastCalledWith({
      method: 'eth_getBlockTransactionCountByNumber',
      params: ['0x6'],
    });
    await api(`module=proxy&action=eth_call&to=${FUNGIBLE}&data=0x18160ddd&tag=pending`);
    expect(node).toHaveBeenLastCalledWith({
      method: 'eth_call',
      params: [{ to: FUNGIBLE, data: '0x18160ddd' }, 'pending'],
    });
  });

  it('refuses malformed parameters without calling the node', async () => {
    const node = nodeAnswers({});
    const tag = await api('module=proxy&action=eth_getBlockByNumber&tag=newest');
    expect(tag.body).toMatchObject({ status: '0', message: 'Invalid tag parameter' });
    const data = await api(`module=proxy&action=eth_call&to=${FUNGIBLE}&data=0x123`);
    expect(data.body).toMatchObject({ status: '0', message: 'Invalid data parameter' });
    const hash = await api('module=proxy&action=eth_getTransactionByHash&txhash=0x12');
    expect(hash.body).toMatchObject({ status: '0', message: 'Invalid txhash format' });
    expect(node).not.toHaveBeenCalled();
  });

  it('reports a node error with the node message only', async () => {
    nodeAnswers({
      eth_call: Object.assign(new Error('URL: http://node:8329'), {
        details: 'execution reverted',
      }),
    });
    const { body } = await api(`module=proxy&action=eth_call&to=${FUNGIBLE}&data=0x`);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'execution reverted' },
      status: '0',
    });
    expect(JSON.stringify(body)).not.toContain('8329');
  });
});

it('names an unknown action', async () => {
  const { body } = await api('module=account&action=nosuchaction');
  expect(body).toMatchObject({
    status: '0',
    message: 'Unknown module/action: account/nosuchaction',
  });
});
