/**
 * Contract verification: the one flow behind every verification route (`/api/contract/verify`,
 * Etherscan `verifysourcecode`, Blockscout v2 `flattened-code` and `standard-input`).
 *
 * The submitted source is compiled exactly as given and stored exactly as given. A contract is
 * verified only when its compiled runtime code matches the code on the chain
 * (`matchRuntimeBytecode()`), and a verified contract is never verified again. Routes read their
 * own parameters, build the standard JSON input, and turn the outcome into their response format.
 */
import { Contract } from '@/models/index';
import { compileStandardJson, describeCompileError } from './compile-worker';
import { compileSettingsRecord, spdxLicense, type CompileSettingsRecord } from './solc-utils';
import { matchRuntimeBytecode, type CompiledRuntimeCode } from './bytecode-match';
import { isAlreadyVerified } from './verified';

/** What the flow reads from solc; the submitted selection is replaced (it does not change code). */
const OUTPUT_SELECTION = {
  '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers'] },
};

export interface Submission {
  /** Contract address. */
  address: string;
  /** Requested compiler release ("0.8.30", "v0.8.30+commit.73712a01"). */
  compilerVersion: string;
  /** Standard JSON input to compile. */
  input: Record<string, unknown>;
  /** "Name" or "path/File.sol:Name". Without it, the first contract whose code matches is taken. */
  contractName?: string;
  /** Stored as the verified source, unchanged: the submitted file or standard JSON text. */
  source: string;
  /** License given with the request: an SPDX id, an Etherscan license number or a Blockscout name. */
  license?: string;
}

export interface CompilerMessage {
  type: string;
  message: string;
  formattedMessage?: string;
  sourceLocation?: unknown;
}

export interface VerifiedRecord extends CompileSettingsRecord {
  address: string;
  contractName: string;
  /** The release that compiled it ("0.8.30+commit.73712a01"). */
  compilerVersion: string;
  license: string;
  sourceCode: string;
  abi: string;
  byteCode: string;
  verified: true;
  verifiedAt: Date;
}

export type VerificationOutcome =
  | { status: 'verified'; match: 'full' | 'partial'; record: VerifiedRecord }
  | { status: 'already-verified' }
  | { status: 'no-code' }
  | { status: 'node-unavailable' }
  /** The compiler could not run or was refused (see describeCompileError). */
  | {
      status: 'compiler-error';
      httpStatus: number;
      code: string;
      message: string;
      retryAfter?: number;
    }
  | { status: 'compile-errors'; errors: CompilerMessage[] }
  | { status: 'contract-not-found'; contractName: string | null }
  | { status: 'mismatch'; compilerVersion: string; settings: CompileSettingsRecord };

export interface VerificationNode {
  /** Runtime code at an address ('0x' when there is none). */
  getCode(address: string): Promise<string | null | undefined>;
}

interface CompiledContract {
  abi?: unknown[];
  evm?: { deployedBytecode?: CompiledRuntimeCode & { object?: string } };
}

interface SolcOutput {
  errors?: Array<CompilerMessage & { severity?: string }>;
  contracts?: Record<string, Record<string, CompiledContract>>;
}

/** Licenses by Etherscan's `licenseType` number. */
const ETHERSCAN_LICENSES: Record<string, string> = {
  '1': 'None',
  '2': 'Unlicense',
  '3': 'MIT',
  '4': 'GPL-2.0',
  '5': 'GPL-3.0',
  '6': 'LGPL-2.1',
  '7': 'LGPL-3.0',
  '8': 'BSD-2-Clause',
  '9': 'BSD-3-Clause',
  '10': 'MPL-2.0',
  '11': 'OSL-3.0',
  '12': 'Apache-2.0',
  '13': 'AGPL-3.0',
  '14': 'BUSL-1.1',
};

/** Licenses by Blockscout's `license_type` name. */
const BLOCKSCOUT_LICENSES: Record<string, string> = {
  none: 'None',
  unlicense: 'Unlicense',
  mit: 'MIT',
  gnu_gpl_v2: 'GPL-2.0',
  gnu_gpl_v3: 'GPL-3.0',
  gnu_lgpl_v2_1: 'LGPL-2.1',
  gnu_lgpl_v3: 'LGPL-3.0',
  bsd_2_clause: 'BSD-2-Clause',
  bsd_3_clause: 'BSD-3-Clause',
  mpl_2_0: 'MPL-2.0',
  osl_3_0: 'OSL-3.0',
  apache_2_0: 'Apache-2.0',
  gnu_agpl_v3: 'AGPL-3.0',
  bsl_1_1: 'BUSL-1.1',
};

/** The SPDX id of a license given with a request, or null when it gives none. */
export function requestedLicense(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const known = ETHERSCAN_LICENSES[text] ?? BLOCKSCOUT_LICENSES[text.toLowerCase()];
  if (known) return known === 'None' ? null : known;
  return /^[A-Za-z0-9.+-]{1,64}$/.test(text) ? text : null;
}

/**
 * The compiled contracts the submission may mean: by name (and file, when "file:Name" is given;
 * a file given without its directory also matches), or every contract with runtime code.
 */
function candidates(output: SolcOutput, contractName?: string) {
  const separator = contractName?.lastIndexOf(':') ?? -1;
  const file = separator >= 0 ? contractName!.slice(0, separator) : undefined;
  const name = separator >= 0 ? contractName!.slice(separator + 1) : contractName;
  const found: Array<{ file: string; name: string; contract: CompiledContract }> = [];
  for (const [sourceName, contracts] of Object.entries(output.contracts ?? {})) {
    for (const [contractInOutput, contract] of Object.entries(contracts ?? {})) {
      if (name && contractInOutput !== name) continue;
      if (!contract.evm?.deployedBytecode?.object) continue; // interfaces and abstract contracts
      found.push({ file: sourceName, name: contractInOutput, contract });
    }
  }
  if (!file) return found;
  const inFile = found.filter(
    (candidate) => candidate.file === file || candidate.file.endsWith(`/${file}`)
  );
  return inFile.length > 0 ? inFile : found;
}

/** Compiles the submission, matches it against the chain and records it when it matches. */
export async function verifySubmission(
  submission: Submission,
  node: VerificationNode
): Promise<VerificationOutcome> {
  const address = submission.address.toLowerCase();
  if (await isAlreadyVerified(address)) return { status: 'already-verified' };

  let onchain: string | null | undefined;
  try {
    onchain = await node.getCode(address);
  } catch {
    return { status: 'node-unavailable' };
  }
  if (!onchain || onchain === '0x' || onchain === '0x0') return { status: 'no-code' };

  const input = {
    ...submission.input,
    settings: {
      ...((submission.input.settings as Record<string, unknown> | undefined) ?? {}),
      outputSelection: OUTPUT_SELECTION,
    },
  };
  let output: SolcOutput;
  let longVersion: string;
  try {
    const compiled = await compileStandardJson({ version: submission.compilerVersion, input });
    output = JSON.parse(compiled.output) as SolcOutput;
    longVersion = compiled.longVersion;
  } catch (error) {
    const described = describeCompileError(error);
    return {
      status: 'compiler-error',
      httpStatus: described.status,
      code: described.code,
      message: described.message,
      retryAfter: described.retryAfter,
    };
  }

  const errors = (output.errors ?? []).filter((error) => error.severity === 'error');
  if (errors.length > 0) {
    return {
      status: 'compile-errors',
      errors: errors.map((error) => ({
        type: error.type || 'CompilationError',
        message: error.message || 'Unknown compilation error',
        formattedMessage: error.formattedMessage,
        sourceLocation: error.sourceLocation,
      })),
    };
  }

  const found = candidates(output, submission.contractName);
  if (found.length === 0) {
    return { status: 'contract-not-found', contractName: submission.contractName ?? null };
  }
  const settings = compileSettingsRecord(input);
  for (const candidate of found) {
    const match = matchRuntimeBytecode(onchain, candidate.contract.evm?.deployedBytecode);
    if (!match) continue;
    const record: VerifiedRecord = {
      address,
      contractName: candidate.name,
      compilerVersion: longVersion,
      ...settings,
      license:
        requestedLicense(submission.license) ??
        spdxLicense(submission.source, candidate.name) ??
        'None',
      sourceCode: submission.source,
      abi: JSON.stringify(candidate.contract.abi ?? []),
      byteCode: onchain,
      verified: true,
      verifiedAt: new Date(),
    };
    await Contract.findOneAndUpdate({ address }, record, {
      upsert: true,
      returnDocument: 'after',
    });
    return { status: 'verified', match, record };
  }
  return { status: 'mismatch', compilerVersion: longVersion, settings };
}

/** The message of a successful verification, as every route words it. */
export const verifiedMessage = (match: 'full' | 'partial') =>
  match === 'full'
    ? 'Contract successfully verified'
    : 'Contract successfully verified (partial match: metadata differs)';
