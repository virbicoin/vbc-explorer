/**
 * Guards the "one model definition, real collection names" rule:
 * every Mongoose model lives in models/index.ts and points at a collection
 * that exists in the production database.
 */
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import * as models from '@/models/index';
import * as legacy from '@/lib/models';

/** Collection names that exist in the production explorerDB. */
const PRODUCTION_COLLECTIONS = [
  'Block',
  'Transaction',
  'Account',
  'Contract',
  'BlockStat',
  'Market',
  'DexSwap',
  'VerificationJob',
  'tokens',
  'tokentransfers',
  'tokenholders',
  'scan_progress',
];

describe('model collection names', () => {
  it('maps every model to its production collection', () => {
    expect(models.MODEL_COLLECTIONS).toEqual({
      Block: 'Block',
      Transaction: 'Transaction',
      Account: 'Account',
      Contract: 'Contract',
      BlockStat: 'BlockStat',
      Market: 'Market',
      DexSwap: 'DexSwap',
      VerificationJob: 'VerificationJob',
      Token: 'tokens',
      TokenHolder: 'tokenholders',
      TokenTransfer: 'tokentransfers',
      ScanProgress: 'scan_progress',
    });
  });

  it('uses only collection names from the production allowlist', () => {
    for (const model of models.ALL_MODELS) {
      expect(PRODUCTION_COLLECTIONS, `${model.modelName} → ${model.collection.name}`).toContain(
        model.collection.name
      );
    }
  });

  it('registers each model once and ALL_MODELS covers every registered model', () => {
    const names = models.ALL_MODELS.map((model) => model.modelName);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(Object.keys(mongoose.models).sort());
  });

  it('lib/models re-exports the same model objects', () => {
    expect(legacy.Contract).toBe(models.Contract);
    expect(legacy.Transaction).toBe(models.Transaction);
    expect(legacy.Account).toBe(models.Account);
    expect(legacy.Market).toBe(models.Market);
  });

  it('TokenTransfer uses the real document shape (tokenAddress / transactionHash)', () => {
    const paths = Object.keys(models.TokenTransfer.schema.paths);
    expect(paths).toEqual(
      expect.arrayContaining(['tokenAddress', 'transactionHash', 'from', 'to', 'blockNumber'])
    );
    expect(paths).not.toContain('contract');
  });
});
