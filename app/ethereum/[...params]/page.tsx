import { redirect } from 'next/navigation';

interface Params {
  params: Promise<{
    params: string[];
  }>;
}

export default async function EthereumRedirect({ params }: Params) {
  // params.params: ["tx", "0x..."], ["block", "12345"], or ["0x..."]
  const resolvedParams = await params;
  const p = resolvedParams.params || [];
  // Address (ethereum:0x...)
  if (p.length === 1 && /^0x[a-fA-F0-9]{40}$/.test(p[0])) {
    redirect(`/address/${p[0]}`);
  }
  // Transaction (ethereum:tx/0x...)
  if (p.length === 2 && p[0] === 'tx' && /^0x[a-fA-F0-9]{64}$/.test(p[1])) {
    redirect(`/tx/${p[1]}`);
  }
  // Block (ethereum:block/12345)
  if (p.length === 2 && p[0] === 'block' && /^\d+$/.test(p[1])) {
    redirect(`/block/${p[1]}`);
  }
  // Fallback: home
  redirect('/');
}

// Add a comment: This page implements EIP-3091 URI redirection for Ethereum explorers.
