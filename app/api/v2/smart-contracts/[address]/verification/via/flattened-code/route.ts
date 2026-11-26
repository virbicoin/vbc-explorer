import { NextRequest } from 'next/server';
import { connectDB } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { withRateLimit } from '@/lib/security/rate-limits';
import { LATEST_KNOWN_SOLC_VERSION } from '@/lib/contract/solc-utils';
import { verifySubmission } from '@/lib/contract/verify';
import { getCompilerConfig } from '@/lib/config';
import { getWeb3 } from '@/lib/web3/provider';
import {
  isTrue,
  readVerificationBody,
  v2Reply,
  v2VerificationResponse,
} from '@/lib/api/v2/verification';

// Blockscout API v2 - verify a contract from one (flattened) source file, compiled as submitted
export const POST = withRateLimit(
  'verify',
  async (request: NextRequest, { params }: { params: Promise<{ address: string }> }) => {
    try {
      const address = sanitizeAddress((await params).address);
      if (!address) return v2Reply({ message: 'Invalid contract address' }, 400);
      await connectDB();

      const body = await readVerificationBody(request);
      if (!body.source_code) return v2Reply({ message: 'Source code is required' }, 400);
      const evmVersion =
        body.evm_version && body.evm_version !== 'default'
          ? body.evm_version
          : getCompilerConfig().defaultEvmVersion || undefined;

      const outcome = await verifySubmission(
        {
          address,
          compilerVersion: body.compiler_version || LATEST_KNOWN_SOLC_VERSION,
          input: {
            language: 'Solidity',
            sources: { [`${body.contract_name || 'Contract'}.sol`]: { content: body.source_code } },
            settings: {
              optimizer: {
                enabled: isTrue(body.is_optimization_enabled),
                runs: parseInt(body.optimization_runs, 10) || 200,
              },
              evmVersion,
            },
          },
          contractName: body.contract_name || undefined,
          source: body.source_code,
          license: body.license_type,
        },
        { getCode: (target) => getWeb3().eth.getCode(target) }
      );
      return v2VerificationResponse(outcome);
    } catch (error) {
      console.error('[api/v2] verification error:', error instanceof Error ? error.message : error);
      return v2Reply({ message: 'Internal server error' }, 500);
    }
  },
  { format: 'v2' }
);
