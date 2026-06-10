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

/**
 * Modernize old Solidity syntax so legacy sources compile under newer compilers.
 * Strips NatSpec block comments, rewrites `var`, `suicide`, `throw`, and relaxes
 * strict 0.8.x pragmas to `^0.8.0`.
 */
export function modernizeSyntax(sourceCode: string): string {
  let modernized = sourceCode;

  // Strip NatSpec comments to avoid DocstringParsingError
  modernized = modernized.replace(/\/\*\*[\s\S]*?\*\//g, '');

  // Replace var with appropriate types where possible
  modernized = modernized.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, 'uint256 $1 =');

  // Replace suicide with selfdestruct
  modernized = modernized.replace(/suicide\(/g, 'selfdestruct(');

  // Replace throw with revert
  modernized = modernized.replace(/\bthrow\b/g, 'revert()');

  // Convert strict pragma to flexible pragma for 0.8.x versions
  modernized = modernized.replace(/pragma\s+solidity\s+(\d+\.\d+\.\d+)\s*;/g, (match, version) => {
    const parts = version.split('.');
    if (parts[0] === '0' && parts[1] === '8') {
      return 'pragma solidity ^0.8.0;';
    }
    return match;
  });

  modernized = modernized.replace(
    /pragma\s+solidity\s+=\s*(\d+\.\d+\.\d+)\s*;/g,
    (match, version) => {
      const parts = version.split('.');
      if (parts[0] === '0' && parts[1] === '8') {
        return 'pragma solidity ^0.8.0;';
      }
      return match;
    }
  );

  return modernized;
}

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
