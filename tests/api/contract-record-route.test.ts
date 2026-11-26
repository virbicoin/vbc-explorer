/**
 * /api/contract/[address] only reads. Its POST handler stored the request body as a Contract
 * record without any check ("verified" contracts with any name and source, 2026-10/11).
 */
import { describe, expect, it } from 'vitest';
import * as route from '@/app/api/contract/[address]/route';

describe('/api/contract/[address]', () => {
  it('has no handler that writes', () => {
    expect(Object.keys(route).sort()).toEqual(['GET']);
  });
});
