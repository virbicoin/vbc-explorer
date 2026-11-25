import { NextRequest } from 'next/server';
import { Contract } from '@/models/index';
import { sanitizeSearchQuery, escapeRegex } from '@/lib/security';
import { addressParam, json, paginate, v2Page, v2Route } from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - verified contracts, most recently verified first.
// `q` matches the start of the contract name. Hidden contracts are not listed.
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;

    const query: Doc = { verified: true, hidden: { $ne: true } };
    const q = sanitizeSearchQuery(searchParams.get('q') || '', 100).trim();
    if (q) query.contractName = { $regex: `^${escapeRegex(q)}`, $options: 'i' };

    const rows = (await Contract.find(query)
      .select('address contractName compilerVersion optimization verifiedAt')
      .sort({ verifiedAt: -1, address: 1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      smart_contract_id: last.address,
    }));

    return json({
      items: items.map((contract) => ({
        address: addressParam(contract.address, undefined, {
          isContract: true,
          isVerified: true,
          name: (contract.contractName as string) || null,
        }),
        coin_balance: null,
        compiler_version: contract.compilerVersion ? `v${contract.compilerVersion}` : null,
        has_constructor_args: null,
        language: 'solidity',
        license_type: 'none',
        market_cap: null,
        optimization_enabled: Boolean(contract.optimization),
        transactions_count: null,
        verified_at: contract.verifiedAt
          ? new Date(contract.verifiedAt as Date).toISOString()
          : null,
      })),
      next_page_params,
    });
  });
}
