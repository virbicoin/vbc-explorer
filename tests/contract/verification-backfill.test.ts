/**
 * Backfill of the verification settings of records verified before they were stored.
 * mongodb-memory-server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract } from '@/models/index';
import { parseStandardJsonInput, spdxLicense } from '@/lib/contract/solc-utils';
import {
  backfillVerificationSettings,
  verificationSettingsFix,
} from '@/lib/contract/verification-backfill';

const jsonSource = (settings: object, content = '// SPDX-License-Identifier: MIT\ncontract A {}') =>
  JSON.stringify({ language: 'Solidity', sources: { 'A.sol': { content } }, settings });

describe('parseStandardJsonInput / spdxLicense', () => {
  it('recognises a stored standard JSON input and leaves single files alone', () => {
    expect(parseStandardJsonInput(jsonSource({}))?.language).toBe('Solidity');
    expect(parseStandardJsonInput('// SPDX-License-Identifier: MIT\ncontract A {}')).toBeNull();
    expect(parseStandardJsonInput('{ not json')).toBeNull();
    expect(parseStandardJsonInput('{"sources":{}}')).toBeNull();
  });

  it('reads the license from the decoded files of a JSON input', () => {
    // the raw JSON text has "MIT\n//" with an escaped newline; the old regex returned that
    expect(spdxLicense(jsonSource({}))).toBe('MIT');
    expect(spdxLicense('/* SPDX-License-Identifier: GPL-3.0 */ contract A {}')).toBe('GPL-3.0');
    expect(spdxLicense('contract A {}')).toBeNull();
  });

  it('prefers the file that defines the verified contract over its dependencies', () => {
    const input = JSON.stringify({
      language: 'Solidity',
      sources: {
        '@openzeppelin/contracts/token/ERC20/ERC20.sol': {
          content: '// SPDX-License-Identifier: MIT\nabstract contract ERC20 {}',
        },
        'contracts/Pair.sol': {
          content: '// SPDX-License-Identifier: GPL-3.0\npragma solidity ^0.8.0;\ncontract Pair {}',
        },
      },
    });
    expect(spdxLicense(input, 'Pair')).toBe('GPL-3.0');
    expect(spdxLicense(input, 'contracts/Pair.sol:Pair')).toBe('GPL-3.0');
    expect(spdxLicense(input)).toBe('MIT');
  });
});

describe('verificationSettingsFix', () => {
  it('takes the settings of the stored JSON input', () => {
    expect(
      verificationSettingsFix({
        sourceCode: jsonSource({ optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' }),
        optimization: false,
      })
    ).toEqual({ optimization: true, optimizationRuns: 200, evmVersion: 'paris', license: 'MIT' });
  });

  it('keeps what is already stored and correct', () => {
    expect(
      verificationSettingsFix({
        sourceCode: jsonSource({ optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' }),
        optimization: true,
        optimizationRuns: 200,
        evmVersion: 'paris',
        license: 'MIT',
      })
    ).toBeNull();
  });

  it('repairs a license read from the raw JSON text', () => {
    expect(
      verificationSettingsFix({
        contractName: 'A',
        sourceCode: jsonSource({ optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' }),
        optimization: true,
        optimizationRuns: 200,
        evmVersion: 'paris',
        license: 'MIT\\n//',
      })
    ).toEqual({ license: 'MIT' });
  });

  it('does not guess for single-file sources', () => {
    expect(
      verificationSettingsFix({ sourceCode: '// SPDX-License-Identifier: MIT\ncontract A {}' })
    ).toBeNull();
  });
});

describe('backfillVerificationSettings', () => {
  let mongod: MongoMemoryServer;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('explorerDB_backfill_verification'), { autoIndex: false });
  }, 180_000);
  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });
  beforeEach(async () => {
    await mongoose.connection.db?.dropDatabase();
  });

  it('fixes JSON-sourced records only, and writes nothing in a dry run', async () => {
    await Contract.collection.insertMany([
      {
        address: '0x' + '1'.repeat(40),
        contractName: 'Json',
        verified: true,
        optimization: false,
        sourceCode: jsonSource({ optimizer: { enabled: true, runs: 999 }, evmVersion: 'london' }),
      },
      {
        address: '0x' + '2'.repeat(40),
        contractName: 'Single',
        verified: true,
        optimization: true,
        sourceCode: 'contract S {}',
      },
      {
        address: '0x' + '3'.repeat(40),
        contractName: 'Unverified',
        verified: false,
        sourceCode: jsonSource({ optimizer: { enabled: true } }),
      },
    ]);

    const dry = await backfillVerificationSettings({ dryRun: true });
    expect(dry.checked).toBe(2);
    expect(dry.changed.map((c) => c.name)).toEqual(['Json']);
    expect((await Contract.findOne({ contractName: 'Json' }).lean())?.optimization).toBe(false);

    const real = await backfillVerificationSettings();
    expect(real.changed).toHaveLength(1);
    expect(await Contract.findOne({ contractName: 'Json' }).lean()).toMatchObject({
      optimization: true,
      optimizationRuns: 999,
      evmVersion: 'london',
      license: 'MIT',
    });
    expect(
      (await Contract.findOne({ contractName: 'Single' }).lean())?.optimizationRuns
    ).toBeUndefined();
    expect((await backfillVerificationSettings({ dryRun: true })).changed).toHaveLength(0);
  });
});
