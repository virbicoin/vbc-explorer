#!/usr/bin/env node
const { Web3 } = require('web3');
const mongoose = require('mongoose');
const fs = require('fs');

// Load config
const configPath = './config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const RPC_URL = config.network?.rpcUrl || config.web3Provider?.url;
let MONGO_URI = config.database?.uri || 'mongodb://localhost:27017/vbc-explorer';

// Expand environment variables
if (MONGO_URI.includes('${')) {
  MONGO_URI = MONGO_URI.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
}
// Fallback if still invalid
if (!MONGO_URI.startsWith('mongodb://') && !MONGO_URI.startsWith('mongodb+srv://')) {
  MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vbc-explorer';
}

const LP_TOKEN = process.argv[2] || '0xa67d40496bd61f9c30efdb040cfcfe6701653d55';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const ERC20_ABI = [
  { constant: true, inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], type: 'function' },
  { constant: true, inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], type: 'function' },
  { constant: true, inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], type: 'function' },
  { constant: true, inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], type: 'function' },
  { constant: true, inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], type: 'function' }
];

async function syncLPToken() {
  console.log('Syncing LP Token:', LP_TOKEN);
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const web3 = new Web3(RPC_URL);
  const contract = new web3.eth.Contract(ERC20_ABI, LP_TOKEN);

  // Get token info
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    contract.methods.name().call(),
    contract.methods.symbol().call(),
    contract.methods.decimals().call(),
    contract.methods.totalSupply().call()
  ]);

  console.log('Token Info:', { name, symbol, decimals, totalSupply: totalSupply.toString() });

  // Get transfer logs
  console.log('Fetching transfer logs...');
  const logs = await web3.eth.getPastLogs({
    address: LP_TOKEN,
    topics: [TRANSFER_TOPIC],
    fromBlock: 0,
    toBlock: 'latest'
  });
  console.log('Found', logs.length, 'transfer events');

  // Calculate balances
  const balances = new Map();
  for (const log of logs) {
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    const value = BigInt(log.data);

    if (from !== '0x0000000000000000000000000000000000000000') {
      balances.set(from, (balances.get(from) || 0n) - value);
    }
    if (to !== '0x0000000000000000000000000000000000000000') {
      balances.set(to, (balances.get(to) || 0n) + value);
    }
  }

  // Filter holders with positive balance
  const holders = [];
  for (const [address, balance] of balances) {
    if (balance > 0n) {
      holders.push({ address, balance: balance.toString() });
    }
  }
  // Sort by balance descending
  holders.sort((a, b) => {
    const balA = BigInt(a.balance);
    const balB = BigInt(b.balance);
    return balB > balA ? 1 : balB < balA ? -1 : 0;
  });
  console.log('Found', holders.length, 'holders');

  // Update token in database
  const tokenCollection = mongoose.connection.db.collection('tokens');
  await tokenCollection.updateOne(
    { address: LP_TOKEN.toLowerCase() },
    {
      $set: {
        address: LP_TOKEN.toLowerCase(),
        name: name,
        symbol: symbol,
        decimals: Number(decimals),
        totalSupply: totalSupply.toString(),
        holders: holders.length,
        type: 'VRC-20',
        verified: false
      }
    },
    { upsert: true }
  );
  console.log('Token updated in database');

  // Update token holders
  const holdersCollection = mongoose.connection.db.collection('tokenholders');
  await holdersCollection.deleteMany({ token: LP_TOKEN.toLowerCase() });
  
  if (holders.length > 0) {
    const holderDocs = holders.map((h, i) => ({
      token: LP_TOKEN.toLowerCase(),
      address: h.address,
      balance: h.balance,
      rank: i + 1
    }));
    await holdersCollection.insertMany(holderDocs);
  }
  console.log('Holders updated in database');

  // Get block info for transfers
  const blockCache = new Map();
  async function getBlockTimestamp(blockNumber) {
    if (blockCache.has(blockNumber)) return blockCache.get(blockNumber);
    const block = await web3.eth.getBlock(blockNumber);
    const timestamp = Number(block.timestamp);
    blockCache.set(blockNumber, timestamp);
    return timestamp;
  }

  // Update token transfers
  const transfersCollection = mongoose.connection.db.collection('tokentransfers');
  await transfersCollection.deleteMany({ token: LP_TOKEN.toLowerCase() });

  if (logs.length > 0) {
    console.log('Processing transfers...');
    const transferDocs = [];
    for (const log of logs) {
      const timestamp = await getBlockTimestamp(Number(log.blockNumber));
      transferDocs.push({
        token: LP_TOKEN.toLowerCase(),
        from: '0x' + log.topics[1].slice(26).toLowerCase(),
        to: '0x' + log.topics[2].slice(26).toLowerCase(),
        value: BigInt(log.data).toString(),
        blockNumber: Number(log.blockNumber),
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        timestamp: timestamp
      });
    }
    await transfersCollection.insertMany(transferDocs);
  }
  console.log('Transfers updated in database');

  await mongoose.disconnect();
  console.log('Done!');
}

syncLPToken().catch(err => {
  console.error('Error:', err);
  mongoose.disconnect();
  process.exit(1);
});
