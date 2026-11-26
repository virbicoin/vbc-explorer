/**
 * Fills in the compiler settings of contracts verified before the settings were stored
 * (2026-11). Until then the Contract schema had no optimizationRuns / evmVersion / license, so
 * they were dropped on save, and the web form stored its own optimization flag even for a
 * standard JSON input that enabled the optimizer.
 *
 * Only records whose stored source is a standard JSON input are changed: that input is what was
 * compiled and matched, so its settings are known. Single-file records keep their unknown
 * settings (the APIs answer empty / null for them).
 */
import { Contract } from '@/models/index';
import { compileSettingsRecord, parseStandardJsonInput, spdxLicense } from './solc-utils';

export interface VerificationSettingsFix {
  optimization?: boolean;
  optimizationRuns?: number;
  evmVersion?: string;
  license?: string;
}

interface StoredContract {
  contractName?: string;
  sourceCode?: unknown;
  optimization?: unknown;
  optimizationRuns?: unknown;
  evmVersion?: unknown;
  license?: unknown;
}

/** The fields to set on a verified record, or null when nothing is known or nothing differs. */
export function verificationSettingsFix(doc: StoredContract): VerificationSettingsFix | null {
  const input = parseStandardJsonInput(doc.sourceCode);
  if (!input) return null;
  const settings = compileSettingsRecord(input);
  const fix: VerificationSettingsFix = {};
  if (doc.optimization !== settings.optimization) fix.optimization = settings.optimization;
  if (typeof doc.optimizationRuns !== 'number') fix.optimizationRuns = settings.optimizationRuns;
  if (typeof doc.evmVersion !== 'string' || !doc.evmVersion) fix.evmVersion = settings.evmVersion;
  // Missing, or read from the raw JSON text by the old verification code ("MIT\\n//")
  const brokenLicense =
    typeof doc.license !== 'string' ||
    !doc.license ||
    doc.license === 'None' ||
    /[\\\s]/.test(doc.license);
  if (brokenLicense) {
    const license = spdxLicense(doc.sourceCode, doc.contractName);
    if (license && license !== doc.license) fix.license = license;
  }
  return Object.keys(fix).length > 0 ? fix : null;
}

export interface VerificationBackfillResult {
  checked: number;
  changed: Array<{ address: string; name: string; fix: VerificationSettingsFix }>;
}

/** Applies verificationSettingsFix() to every verified record (nothing is written with dryRun). */
export async function backfillVerificationSettings(
  options: { dryRun?: boolean } = {}
): Promise<VerificationBackfillResult> {
  const result: VerificationBackfillResult = { checked: 0, changed: [] };
  const cursor = Contract.find(
    { verified: true },
    {
      address: 1,
      contractName: 1,
      sourceCode: 1,
      optimization: 1,
      optimizationRuns: 1,
      evmVersion: 1,
      license: 1,
    }
  )
    .lean()
    .cursor();
  for await (const doc of cursor) {
    result.checked += 1;
    const fix = verificationSettingsFix(doc as StoredContract);
    if (!fix) continue;
    const address = String((doc as { address?: unknown }).address);
    result.changed.push({
      address,
      name: String((doc as { contractName?: unknown }).contractName ?? ''),
      fix,
    });
    if (!options.dryRun) {
      await Contract.updateOne({ address, verified: true }, { $set: fix });
    }
  }
  return result;
}
