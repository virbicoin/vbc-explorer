/**
 * Request parameters of the Etherscan / Blockscout RPC-style API (`/api?module=&action=`).
 *
 * The dispatcher (app/api/route.ts) hands every action a `Params`; a missing or malformed value
 * throws `ParamError`, which the dispatcher turns into the API's error envelope (or, for the
 * `proxy` module, a JSON-RPC "invalid params" error). Actions therefore do not repeat the
 * "missing / invalid" checks themselves.
 */
import { isValidAddress, isValidHash } from '@/lib/security';
import type { NextResponse } from 'next/server';

/** A refused parameter; `message` is the reason shown to the client. */
export class ParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParamError';
  }
}

/** Thrown to answer with a ready response (for example a rate-limit refusal). */
export class RespondWith extends Error {
  constructor(readonly response: NextResponse | Response) {
    super('respond');
    this.name = 'RespondWith';
  }
}

const BLOCK_TAGS = new Set(['latest', 'earliest', 'pending', 'safe', 'finalized']);

/**
 * Hex quantity for a decimal or hex number (leading zeros removed, which the node rejects); null
 * when the value is not a number.
 */
export function toQuantity(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!/^\d+$/.test(text) && !/^0x[0-9a-fA-F]+$/.test(text)) return null;
  return `0x${BigInt(text).toString(16)}`;
}

/** Block parameter: a tag, or a height as a hex quantity; `latest` when absent; null when malformed. */
export function toBlockParameter(tag: string | null | undefined): string | null {
  if (tag === null || tag === undefined || tag.trim() === '') return 'latest';
  const text = tag.trim().toLowerCase();
  return BLOCK_TAGS.has(text) ? text : toQuantity(text);
}

export class Params {
  constructor(readonly search: URLSearchParams) {}

  /** The value, or undefined when absent or empty. */
  optional(name: string): string | undefined {
    const value = this.search.get(name);
    return value === null || value === '' ? undefined : value;
  }

  /** The first of several accepted names that is present (Etherscan and Blockscout differ). */
  either(...names: string[]): string | undefined {
    for (const name of names) {
      const value = this.optional(name);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  required(name: string): string {
    const value = this.optional(name);
    if (value === undefined) throw new ParamError(`Missing ${name} parameter`);
    return value;
  }

  /** A required address in lower case. */
  address(name = 'address'): string {
    return this.checkAddress(name, this.required(name));
  }

  optionalAddress(name: string): string | undefined {
    const value = this.optional(name);
    return value === undefined ? undefined : this.checkAddress(name, value);
  }

  /** A comma-separated list of addresses (Etherscan allows up to `max`). */
  addresses(name: string, max = 20): string[] {
    const list = this.required(name)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (list.length === 0) throw new ParamError(`Missing ${name} parameter`);
    if (list.length > max) throw new ParamError(`Maximum of ${max} addresses`);
    return list.map((value) => this.checkAddress(name, value));
  }

  /** A required 32-byte hash in lower case. */
  hash(name = 'txhash'): string {
    const value = this.required(name);
    if (!isValidHash(value)) throw new ParamError(`Invalid ${name} format`);
    return value.toLowerCase();
  }

  /** A non-negative decimal integer. */
  integer(name: string, fallback?: number): number {
    const value = this.optional(name);
    if (value === undefined) {
      if (fallback !== undefined) return fallback;
      throw new ParamError(`Missing ${name} parameter`);
    }
    if (!/^\d{1,15}$/.test(value)) throw new ParamError(`Invalid ${name} parameter`);
    return Number(value);
  }

  /** Block parameter for the node: a tag or a hex height (`latest` when absent). */
  blockTag(name = 'tag'): string {
    const block = toBlockParameter(this.optional(name));
    if (!block) throw new ParamError(`Invalid ${name} parameter`);
    return block;
  }

  /** A required hex quantity (decimal or 0x input). */
  quantity(name: string): string {
    const quantity = toQuantity(this.required(name));
    if (!quantity) throw new ParamError(`Invalid ${name} parameter`);
    return quantity;
  }

  /** Required 0x-prefixed hex bytes. */
  hexData(name: string): string {
    const value = this.required(name);
    if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) throw new ParamError(`Invalid ${name} parameter`);
    return value;
  }

  private checkAddress(name: string, value: string): string {
    if (!isValidAddress(value)) {
      throw new ParamError(
        name === 'address' ? 'Invalid address format' : `Invalid ${name} format`
      );
    }
    return value.toLowerCase();
  }
}
