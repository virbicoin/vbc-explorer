import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { isConnected } from '@/lib/db';

describe('isConnected', () => {
  it('returns true only for the mongoose "connected" readyState', () => {
    expect(isConnected(mongoose.ConnectionStates.connected)).toBe(true);
  });

  it('returns false for disconnected/connecting/disconnecting states', () => {
    expect(isConnected(mongoose.ConnectionStates.disconnected)).toBe(false);
    expect(isConnected(mongoose.ConnectionStates.connecting)).toBe(false);
    expect(isConnected(mongoose.ConnectionStates.disconnecting)).toBe(false);
  });
});
