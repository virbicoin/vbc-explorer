import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { assertDb } from '@/lib/db/get-db';

describe('assertDb', () => {
  it('returns the handle when it is present', () => {
    const fake = { databaseName: 'explorerDB' } as unknown as Db;
    expect(assertDb(fake)).toBe(fake);
  });

  it('throws a clear error when the handle is undefined', () => {
    expect(() => assertDb(undefined)).toThrow('Database connection not established');
  });

  it('throws when the handle is null', () => {
    expect(() => assertDb(null)).toThrow('Database connection not established');
  });
});
