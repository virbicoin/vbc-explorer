// Generic cryptocurrency units converter using native BigInt
// Supports configurable currency-specific unit naming conventions

interface UnitMap {
  [key: string]: string;
}

interface CurrencyConfig {
  currency?: {
    name?: string;
    symbol?: string;
    unit?: string;
    decimals?: number;
  };
}

interface CurrencyUnits {
  unitMap: UnitMap;
  currencyName: string;
  currencySymbol: string;
  baseUnit: string;
  mainUnit: string;
  decimals: number;
  getValueOfUnit(unit: string): bigint;
  toMainUnit(number: string | number | bigint, unit?: string): string;
  toBaseUnit(number: string | number | bigint, unit?: string): string;
  // Legacy compatibility methods
  toEther(number: string | number | bigint, unit?: string): string;
  toWei(number: string | number | bigint, unit?: string): string;
}

// Default configuration (can be overridden by config)
let currencyConfig = {
  name: 'VirBiCoin',
  symbol: 'VBC',
  unit: 'niku',
  decimals: 18
};

// Function to update currency configuration
export function updateCurrencyConfig(config: CurrencyConfig) {
  if (config.currency) {
    currencyConfig = {
      name: config.currency.name || 'Ether',
      symbol: config.currency.symbol || 'ETH',
      unit: config.currency.unit || 'wei',
      decimals: config.currency.decimals || 18
    };
  }
}

const createCurrencyUnits = (): CurrencyUnits => {
  const mainUnitValue = BigInt(10 ** currencyConfig.decimals);
  
  return {
    unitMap: {
      // Currency-specific naming
      [currencyConfig.unit]: '1',
      [`k${currencyConfig.unit}`]: '1000',
      [`m${currencyConfig.unit}`]: '1000000',
      [`g${currencyConfig.unit}`]: '1000000000',
      [currencyConfig.symbol.toLowerCase()]: mainUnitValue.toString(),

      // Legacy Ethereum-compatible names for compatibility
      'wei': '1',
      'kwei': '1000',
      'ada': '1000',
      'femtoether': '1000',
      'mwei': '1000000',
      'babbage': '1000000',
      'picoether': '1000000',
      'gwei': '1000000000',
      'shannon': '1000000000',
      'nanoether': '1000000000',
      'nano': '1000000000',
      'szabo': '1000000000000',
      'microether': '1000000000000',
      'micro': '1000000000000',
      'finney': '1000000000000000',
      'milliether': '1000000000000000',
      'milli': '1000000000000000',
      'ether': mainUnitValue.toString(),
      'kether': (mainUnitValue * 1000n).toString(),
      'grand': (mainUnitValue * 1000n).toString(),
      'einstein': (mainUnitValue * 1000n).toString(),
      'mether': (mainUnitValue * 1000000000n).toString(),
      'gether': (mainUnitValue * 1000000000000000n).toString(),
      'tether': (mainUnitValue * 1000000000000000000000n).toString(),
    },

    currencyName: currencyConfig.name,
    currencySymbol: currencyConfig.symbol,
    baseUnit: currencyConfig.unit,
    mainUnit: currencyConfig.symbol.toLowerCase(),
    decimals: currencyConfig.decimals,

    getValueOfUnit(unit: string): bigint {
      unit = unit ? unit.toLowerCase() : this.mainUnit;
      const unitValue = this.unitMap[unit];
      if (unitValue === undefined) {
        throw new Error(`Invalid unit: ${unit}. Supported units: ${JSON.stringify(this.unitMap, null, 2)}`);
      }
      return BigInt(unitValue);
    },

    toMainUnit(number: string | number | bigint, unit?: string): string {
      const baseValue = BigInt(this.toBaseUnit(number, unit));
      const mainValue = baseValue / this.getValueOfUnit(this.mainUnit);
      return (Number(mainValue) / (10 ** this.decimals)).toString();
    },

    toBaseUnit(number: string | number | bigint, unit?: string): string {
      const inputValue = BigInt(String(number));
      const multiplier = this.getValueOfUnit(unit || this.mainUnit);
      const result = inputValue * multiplier;
      return result.toString();
    },

    // Legacy compatibility methods
    toEther(number: string | number | bigint, unit?: string): string {
      return this.toMainUnit(number, unit);
    },

    toWei(number: string | number | bigint, unit?: string): string {
      return this.toBaseUnit(number, unit);
    }
  };
};

// Initialize with default configuration
let currencyUnits = createCurrencyUnits();

// Function to update currency units when config changes
export function updateCurrencyUnits() {
  currencyUnits = createCurrencyUnits();
}

// Export individual functions for compatibility
export const toEther = (number: string | number | bigint, unit?: string): string => {
  return currencyUnits.toEther(number, unit);
};

export const toGwei = (number: string | number | bigint, unit?: string): string => {
  return currencyUnits.toBaseUnit(number, unit);
};

export default currencyUnits;
