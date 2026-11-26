/**
 * Solidity compiler (solc) utilities
 *
 * Pure helpers for contract verification that were previously duplicated inline
 * in `app/api/route.ts` and `app/api/contract/verify/route.ts`. Centralizing
 * them removes the duplication and — because these are pure string functions —
 * makes the verification-critical logic unit-testable.
 */

/**
 * Normalize a compiler version string.
 * Strips a leading `v` and any `+commit...` suffix.
 * e.g. `v0.8.20+commit.a1b79de6` -> `0.8.20`
 */
export function normalizeCompilerVersion(version: string): string {
  // Remove 'v' prefix if present
  let normalized = version.startsWith('v') ? version.substring(1) : version;
  // Remove commit hash if present (e.g., "0.8.20+commit.a1b79de6" -> "0.8.20")
  normalized = normalized.split('+')[0];
  return normalized;
}

/**
 * Solc version to full release name mapping.
 * These are the exact release names from
 * https://binaries.soliditylang.org/bin/list.json
 */
export const SOLC_RELEASES: Record<string, string> = {
  '0.8.33': 'v0.8.33+commit.e14f2714',
  '0.8.32': 'v0.8.32+commit.3b2e1c26',
  '0.8.31': 'v0.8.31+commit.46dfe0ff',
  '0.8.30': 'v0.8.30+commit.73712a01',
  '0.8.29': 'v0.8.29+commit.ab55807c',
  '0.8.28': 'v0.8.28+commit.7893614a',
  '0.8.27': 'v0.8.27+commit.40a35a09',
  '0.8.26': 'v0.8.26+commit.8a97fa7a',
  '0.8.25': 'v0.8.25+commit.b61c2a91',
  '0.8.24': 'v0.8.24+commit.e11b9ed9',
  '0.8.23': 'v0.8.23+commit.f704f362',
  '0.8.22': 'v0.8.22+commit.4fc1097e',
  '0.8.21': 'v0.8.21+commit.d9974bed',
  '0.8.20': 'v0.8.20+commit.a1b79de6',
  '0.8.19': 'v0.8.19+commit.7dd6d404',
  '0.8.18': 'v0.8.18+commit.87f61d96',
  '0.8.17': 'v0.8.17+commit.8df45f5f',
  '0.8.16': 'v0.8.16+commit.07a7930e',
  '0.8.15': 'v0.8.15+commit.e14f2714',
  '0.6.12': 'v0.6.12+commit.27d51765',
};

/** Newest release in SOLC_RELEASES (default when a client sends no compiler version). */
export const LATEST_KNOWN_SOLC_VERSION = Object.keys(SOLC_RELEASES)[0];

/**
 * Strip trailing compiler-emitted metadata from bytecode so on-chain and
 * recompiled bytecode can be compared. Returns lowercased, 0x-stripped hex.
 */
export function removeMetadata(bytecode: string): string {
  let cleaned = bytecode.toLowerCase();
  if (cleaned.startsWith('0x')) {
    cleaned = cleaned.substring(2);
  }

  // Look for IPFS metadata marker
  const ipfsMarkerIndex = cleaned.lastIndexOf('a264697066735822');
  if (ipfsMarkerIndex > 0) {
    return cleaned.substring(0, ipfsMarkerIndex);
  }

  // Look for Bzzr1 metadata marker
  const bzzr1MarkerIndex = cleaned.lastIndexOf('a265627a7a7231');
  if (bzzr1MarkerIndex > 0) {
    return cleaned.substring(0, bzzr1MarkerIndex);
  }

  // Look for Bzzr0 metadata marker
  const bzzr0MarkerIndex = cleaned.lastIndexOf('a265627a7a7230');
  if (bzzr0MarkerIndex > 0) {
    return cleaned.substring(0, bzzr0MarkerIndex);
  }

  // Old swarm metadata
  const swarmMarkerIndex = cleaned.lastIndexOf('a165627a7a72');
  if (swarmMarkerIndex > 0) {
    return cleaned.substring(0, swarmMarkerIndex);
  }

  return cleaned;
}

/** Compiler settings a verification compiled with, as stored on the Contract record. */
export interface CompileSettingsRecord {
  optimization: boolean;
  /** `optimizer.runs`; solc uses 200 when the input leaves it out. */
  optimizationRuns: number;
  /** `settings.evmVersion`; 'default' when the input leaves it to the compiler. */
  evmVersion: string;
}

/**
 * Reads the optimizer and EVM settings from the solc standard JSON input that was actually
 * compiled, so the stored record describes the compilation that matched the bytecode rather
 * than the request parameters or a fixed value.
 */
export function compileSettingsRecord(input: { settings?: unknown }): CompileSettingsRecord {
  const settings = (input.settings ?? {}) as {
    optimizer?: { enabled?: unknown; runs?: unknown };
    evmVersion?: unknown;
  };
  const optimizer = settings.optimizer ?? {};
  return {
    optimization: optimizer.enabled === true,
    optimizationRuns:
      typeof optimizer.runs === 'number' && Number.isFinite(optimizer.runs) ? optimizer.runs : 200,
    evmVersion:
      typeof settings.evmVersion === 'string' && settings.evmVersion
        ? settings.evmVersion
        : 'default',
  };
}

/** Etherscan's `EVMVersion` value for a stored record ('Default' when unknown or the compiler default). */
export function etherscanEvmVersion(stored: unknown): string {
  return typeof stored === 'string' && stored && stored !== 'default' ? stored : 'Default';
}

/** A stored source that is a solc standard JSON input (as saved by the standard-input paths). */
export interface StandardJsonInput {
  language: string;
  sources: Record<string, { content?: unknown }>;
  settings?: unknown;
}

/** The stored source parsed as a standard JSON input, or null for a single-file source. */
export function parseStandardJsonInput(sourceCode: unknown): StandardJsonInput | null {
  if (typeof sourceCode !== 'string' || !sourceCode.trimStart().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(sourceCode) as Partial<StandardJsonInput>;
    if (
      typeof parsed?.language === 'string' &&
      parsed.sources &&
      typeof parsed.sources === 'object'
    ) {
      return parsed as StandardJsonInput;
    }
  } catch {
    // not JSON: a single-file source
  }
  return null;
}

const SPDX = /SPDX-License-Identifier:\s*([^\s*]+)/i;

/**
 * SPDX license identifier of a verified source. A standard JSON input is searched in its decoded
 * source files (matching the raw JSON text read escaped newlines into the identifier, e.g.
 * "MIT\\n//"), preferring the file that defines `contractName` over dependencies such as
 * OpenZeppelin, which come first in the input.
 */
export function spdxLicense(sourceCode: unknown, contractName?: string): string | null {
  const input = parseStandardJsonInput(sourceCode);
  const files = input
    ? Object.values(input.sources).map((file) =>
        typeof file?.content === 'string' ? file.content : ''
      )
    : [typeof sourceCode === 'string' ? sourceCode : ''];
  const name = contractName?.includes(':') ? contractName.split(':').pop() : contractName;
  if (name && files.length > 1) {
    const defines = new RegExp(
      `\\b(?:abstract\\s+)?(?:contract|library|interface)\\s+${name.replace(/[^A-Za-z0-9_$]/g, '')}\\b`
    );
    const own = files.find((text) => defines.test(text));
    const match = own?.match(SPDX);
    if (match?.[1]) return match[1].trim();
  }
  for (const text of files) {
    const match = text.match(SPDX);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
