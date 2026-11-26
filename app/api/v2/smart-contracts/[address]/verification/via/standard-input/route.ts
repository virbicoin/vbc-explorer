import { NextRequest } from 'next/server';
import { connectDB } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { withRateLimit } from '@/lib/security/rate-limits';
import { LATEST_KNOWN_SOLC_VERSION } from '@/lib/contract/solc-utils';
import { verifySubmission } from '@/lib/contract/verify';
import { getCode } from '@/lib/web3/provider';
import { readVerificationBody, v2Reply, v2VerificationResponse } from '@/lib/api/v2/verification';

// Blockscout API v2 - verify a contract from a standard JSON input, compiled with its own
// settings and stored exactly as submitted. The input comes as `standard_input`, `files` or an
// uploaded `files[0]`; `contract_name` is "path/File.sol:Name".
export const POST = withRateLimit(
  'verify',
  async (request: NextRequest, { params }: { params: Promise<{ address: string }> }) => {
    try {
      const address = sanitizeAddress((await params).address);
      if (!address) return v2Reply({ message: 'Invalid contract address' }, 400);
      await connectDB();

      const body = await readVerificationBody(request);
      const text =
        body.standard_input ??
        body.files ??
        Object.entries(body).find(([key]) => key.startsWith('files'))?.[1];
      if (!text) {
        return v2Reply(
          { message: 'Standard JSON Input is required (files or standard_input field)' },
          400
        );
      }
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(text);
      } catch {
        return v2Reply({ message: 'Invalid Standard JSON Input format' }, 400);
      }
      if (!input || typeof input !== 'object' || !input.sources) {
        return v2Reply({ message: 'Invalid Standard JSON Input format' }, 400);
      }
      if (!body.contract_name) {
        return v2Reply(
          { message: 'Contract name is required (format: FileName.sol:ContractName)' },
          400
        );
      }

      const outcome = await verifySubmission(
        {
          address,
          compilerVersion: body.compiler_version || LATEST_KNOWN_SOLC_VERSION,
          input,
          contractName: body.contract_name,
          source: text,
          license: body.license_type,
        },
        { getCode: (target) => getCode(target) }
      );
      return v2VerificationResponse(outcome);
    } catch (error) {
      console.error('[api/v2] verification error:', error instanceof Error ? error.message : error);
      return v2Reply({ message: 'Internal server error' }, 500);
    }
  },
  { format: 'v2' }
);
