/**
 * Runtime bytecode matching for contract verification.
 *
 * A verification is accepted only when the compiled runtime code equals the code on chain,
 * apart from what the deployment legitimately changes:
 * - immutable variables (the constructor writes their values where the compiler left zeros;
 *   positions from `evm.deployedBytecode.immutableReferences`),
 * - linked library addresses (placeholders in the compiled code; positions from
 *   `evm.deployedBytecode.linkReferences`),
 * - and, for a partial match, the CBOR metadata appended to the code (it hashes the source
 *   files and settings, so a comment or path change alters it without changing behaviour).
 *
 * The matching this replaced also accepted substrings, common prefixes, 95 % "similarity" and a
 * matching first 80 %, which let unrelated source code be published as verified.
 */

export type BytecodeMatch = 'full' | 'partial' | null;

interface ByteRange {
  start: number;
  length: number;
}

/** The fields of solc's `evm.deployedBytecode` output used for matching. */
export interface CompiledRuntimeCode {
  object?: string;
  immutableReferences?: Record<string, ByteRange[]>;
  linkReferences?: Record<string, Record<string, ByteRange[]>>;
}

function normalizeHex(value: string | undefined | null): string {
  return (value ?? '').trim().replace(/^0x/i, '').toLowerCase();
}

/**
 * Length in hex characters of the CBOR metadata solc appends to runtime code: the last two
 * bytes hold the length of the CBOR map, which starts with a map header (0xa1..0xa5).
 * Returns 0 when the code does not end with such a section.
 */
export function metadataHexLength(code: string): number {
  const hex = normalizeHex(code);
  if (hex.length < 4) return 0;
  const cborBytes = parseInt(hex.slice(-4), 16);
  if (!Number.isFinite(cborBytes) || cborBytes === 0) return 0;
  const total = (cborBytes + 2) * 2;
  if (total > hex.length) return 0;
  const header = hex.slice(hex.length - total, hex.length - total + 2);
  return /^a[1-5]$/.test(header) ? total : 0;
}

function replaceRange(hex: string, range: ByteRange, replacement: string): string {
  const from = range.start * 2;
  const to = (range.start + range.length) * 2;
  if (range.length <= 0 || to > hex.length) return hex;
  return hex.slice(0, from) + replacement + hex.slice(to);
}

/**
 * Compares on-chain runtime code with the compiler's `evm.deployedBytecode`.
 * 'full': identical including the metadata; 'partial': identical once the metadata is removed;
 * null: anything else (including empty code on either side).
 */
export function matchRuntimeBytecode(
  onchainCode: string,
  compiled: CompiledRuntimeCode | undefined | null
): BytecodeMatch {
  let onchain = normalizeHex(onchainCode);
  let built = normalizeHex(compiled?.object);
  if (!onchain || !built || !/^[0-9a-f]+$/.test(onchain)) return null;

  // Library addresses are only known after linking: take them from the chain
  for (const file of Object.values(compiled?.linkReferences ?? {})) {
    for (const ranges of Object.values(file)) {
      for (const range of ranges) {
        const from = range.start * 2;
        const to = (range.start + range.length) * 2;
        if (to > onchain.length) return null;
        built = replaceRange(built, range, onchain.slice(from, to));
      }
    }
  }
  if (!/^[0-9a-f]+$/.test(built)) return null; // unlinked placeholders left over

  // Immutables: the compiled code holds zeros where the deployed code holds the values
  for (const ranges of Object.values(compiled?.immutableReferences ?? {})) {
    for (const range of ranges) {
      onchain = replaceRange(onchain, range, '0'.repeat(range.length * 2));
    }
  }

  if (onchain === built) return 'full';

  const onchainMeta = metadataHexLength(onchain);
  const builtMeta = metadataHexLength(built);
  if (onchainMeta && builtMeta) {
    const onchainCodeOnly = onchain.slice(0, onchain.length - onchainMeta);
    const builtCodeOnly = built.slice(0, built.length - builtMeta);
    if (onchainCodeOnly.length > 0 && onchainCodeOnly === builtCodeOnly) return 'partial';
  }
  return null;
}
