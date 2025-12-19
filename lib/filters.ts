import currencyUnits, { updateCurrencyConfig, updateCurrencyUnits } from './etherUnits';
 
const RLP = require('rlp');

interface Transaction {
  hash: string;
  blockNumber: number;
  from: string;
  to: string;
  value: string | number;
  gas: number;
  timestamp: number;
  creates?: string;
}

interface TraceTransaction {
  type?: string;
  action: {
    address?: string;
    balance?: string | number;
    refundAddress?: string;
    to?: string;
    from: string;
    gas?: string | number;
    value: string | number;
  };
  result?: {
    gasUsed?: string | number;
    address?: string;
  };
  from?: string;
  to?: string;
  gas?: number;
  gasUsed?: number;
  value?: string | number;
}

interface CurrencyConfig {
  currency?: {
    name?: string;
    symbol?: string;
    unit?: string;
    decimals?: number;
  };
}

// Function to initialize currency configuration
function initializeCurrency(config: CurrencyConfig) {
  updateCurrencyConfig(config);
  updateCurrencyUnits();
}

/**
 * Filter an array of transactions for display
 */
function filterTX(txs: Transaction[]): unknown[] {
  return txs.map(tx => [
    tx.hash, 
    tx.blockNumber, 
    tx.from, 
    tx.to, 
    currencyUnits.toMainUnit(tx.value.toString(), currencyUnits.baseUnit), 
    tx.gas, 
    tx.timestamp, 
    tx.creates
  ]);
}

/**
 * Filter trace transactions for display
 */
function filterTrace(txs: TraceTransaction[]): unknown[] {
  return txs.map((tx) => {
    const t = { ...tx };
    if (t.type == 'suicide') {
      if (t.action.address) t.from = t.action.address;
      if (t.action.balance) t.value = currencyUnits.toMainUnit(t.action.balance.toString(), currencyUnits.baseUnit);
      if (t.action.refundAddress) t.to = t.action.refundAddress;
    } else {
      if (t.action.to) t.to = t.action.to;
      t.from = t.action.from;
      if (t.action.gas) t.gas = Number(t.action.gas);
      if ((t.result) && (t.result.gasUsed)) t.gasUsed = Number(t.result.gasUsed);
      if ((t.result) && (t.result.address)) t.to = t.result.address;
      t.value = currencyUnits.toMainUnit(t.action.value.toString(), currencyUnits.baseUnit);
    }
    return t;
  });
}

interface Block {
  number: number;
}

/**
 * Filter block data for display
 */
function filterBlocks(blocks: Block[], value?: number): Block[] {
  if (typeof value !== 'undefined') {
    return blocks.filter(block => block.number >= value);
  }
  return blocks;
}

/**
 * Filter internal transactions
 */
function filterInternalTx(txs: TraceTransaction[]): unknown[] {
  return txs.map((tx) => {
    const t = { ...tx };
    if (t.type == 'suicide') {
      if (t.action.address) t.from = t.action.address;
      if (t.action.balance) t.value = currencyUnits.toMainUnit(t.action.balance.toString(), currencyUnits.baseUnit);
      if (t.action.refundAddress) t.to = t.action.refundAddress;
    } else {
      if (t.action.to) t.to = t.action.to;
      t.from = t.action.from;
      if (t.action.gas) t.gas = Number(t.action.gas);
      if ((t.result) && (t.result.gasUsed)) t.gasUsed = Number(t.result.gasUsed);
      if ((t.result) && (t.result.address)) t.to = t.result.address;
      t.value = currencyUnits.toMainUnit(t.action.value.toString(), currencyUnits.baseUnit);
    }
    return t;
  });
}

/**
 * Helper function to format currency values
 */
function formatCurrency(value: string | number | bigint, unit?: string): string {
  return currencyUnits.toMainUnit(value, unit || currencyUnits.baseUnit);
}

/**
 * Helper function to format base unit values to main unit
 */
function formatValue(value: string | number | bigint): string {
  return currencyUnits.toMainUnit(value, currencyUnits.baseUnit);
}

/**
 * Helper function to format gas price
 */
function formatGasPrice(gasPrice: string | number | bigint): string {
  return currencyUnits.toBaseUnit(gasPrice, currencyUnits.baseUnit);
}

export {
  filterTX,
  filterTrace,
  filterBlocks,
  filterInternalTx,
  formatCurrency,
  formatValue,
  formatGasPrice,
  initializeCurrency
}; 