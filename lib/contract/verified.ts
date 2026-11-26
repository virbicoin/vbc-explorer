import { Contract } from '@/models/index';

/**
 * Whether the address already has verified source. Every verification path refuses to verify
 * such a contract again: a second verification used to replace the name and source of a
 * verified contract, and the stricter bytecode matching only protects new verifications.
 */
export async function isAlreadyVerified(address: string): Promise<boolean> {
  const doc = await Contract.findOne(
    { address: address.toLowerCase(), verified: true },
    { _id: 1 }
  ).lean();
  return doc !== null;
}
