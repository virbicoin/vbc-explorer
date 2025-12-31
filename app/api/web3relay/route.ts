import { NextRequest, NextResponse } from 'next/server';
import Web3 from 'web3';
import { Transaction, Market } from '@/lib/models';
import { connectToDatabase } from '@/lib/db';
import { toEther, toGwei } from '@/lib/etherUnits';
import fs from 'fs';
import path from 'path';

// Function to read config
const readConfig = () => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const exampleConfigPath = path.join(process.cwd(), 'config.example.json');

    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else if (fs.existsSync(exampleConfigPath)) {
      return JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading config:', error);
  }

  // Default configuration
  return {
    nodeAddr: 'localhost',
    port: 8329,
    wsPort: 8330,
    miners: {},
  };
};

// Load config with fallback
const config = readConfig();

// Create Web3 connection
const web3 = new Web3(
  new Web3.providers.WebsocketProvider(`ws://${config.nodeAddr}:${config.wsPort}`)
);

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const body = await request.json();

    if ('tx' in body) {
      const txHash = body.tx.toLowerCase();

      let txResponse: Record<string, unknown>;
      let doc;

      try {
        doc = await Transaction.findOne({ hash: txHash }).lean(true).exec();
      } catch {
        // Database error, continue to blockchain lookup
      }

      if (!doc) {
        // Try to get from blockchain
        try {
          const tx = await web3.eth.getTransaction(txHash);
          if (!tx) {
            // Try as block hash
            const block = await web3.eth.getBlock(txHash);
            if (!block) {
              return NextResponse.json({ error: true });
            } else {
              return NextResponse.json({ error: true, isBlock: true });
            }
          }

          txResponse = tx as Record<string, unknown>;
          txResponse.value = toEther(BigInt(tx.value), 'wei');

          // Get transaction receipt
          const receipt = await web3.eth.getTransactionReceipt(txHash);
          if (receipt) {
            txResponse.gasUsed = receipt.gasUsed;
            if (receipt.status !== undefined) {
              txResponse.status = receipt.status;
            }
            if (!tx.to && receipt.contractAddress) {
              txResponse.creates = receipt.contractAddress;
            }
          }

          // Get timestamp from block
          const block = await web3.eth.getBlock(tx.blockNumber);
          if (block) {
            txResponse.timestamp = block.timestamp;
          }

          txResponse.isTrace = txResponse.input !== '0x';
        } catch {
          return NextResponse.json({ error: true });
        }
      } else {
        const docData = Array.isArray(doc) ? doc[0] : doc;
        txResponse = docData as Record<string, unknown>;
      }

      const latestBlock = (await web3.eth.getBlockNumber()) + 1n;
      txResponse.confirmations = latestBlock - BigInt(String(txResponse.blockNumber || 0));

      if (txResponse.confirmations === latestBlock) {
        txResponse.confirmation = 0;
      }

      txResponse.gasPriceGwei = toGwei(BigInt(String(txResponse.gasPrice || 0)), 'wei');
      txResponse.gasPriceEther = toEther(BigInt(String(txResponse.gasPrice || 0)), 'wei');
      txResponse.txFee = Number(txResponse.gasPriceEther) * Number(txResponse.gasUsed || 0);

      if (config.settings?.useFiat) {
        const latestPrice = await Market.findOne().sort({ timestamp: -1 });
        if (latestPrice) {
          txResponse.txFeeUSD = Number(txResponse.txFee) * Number(latestPrice.quoteUSD);
          txResponse.valueUSD = Number(txResponse.value) * Number(latestPrice.quoteUSD);
        }
      }

      return NextResponse.json(txResponse);
    } else if ('addr' in body) {
      const addr = body.addr.toLowerCase();
      const { options } = body;

      const addrData: Record<string, unknown> = {};

      if (options.indexOf('balance') > -1) {
        try {
          const balance = await web3.eth.getBalance(addr);
          addrData.balance = toEther(balance, 'wei');
        } catch {
          return NextResponse.json({ error: true });
        }
      }

      if (options.indexOf('count') > -1) {
        try {
          addrData.count = await web3.eth.getTransactionCount(addr);
        } catch {
          return NextResponse.json({ error: true });
        }
      }

      if (options.indexOf('bytecode') > -1) {
        try {
          const code = await web3.eth.getCode(addr);
          addrData.bytecode = code;
        } catch {
          return NextResponse.json({ error: true });
        }
      }

      return NextResponse.json(addrData);
    } else if ('block' in body) {
      const blockNumber = body.block;

      try {
        const block = await web3.eth.getBlock(blockNumber, true);
        if (!block) {
          return NextResponse.json({ error: true });
        }

        return NextResponse.json(block);
      } catch {
        return NextResponse.json({ error: true });
      }
    }

    return NextResponse.json({ error: true });
  } catch {
    return NextResponse.json({ error: true }, { status: 500 });
  }
}
