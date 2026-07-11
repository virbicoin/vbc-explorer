'use client';

import { useState, useEffect } from 'react';

/**
 * Public name tags for known addresses (Etherscan-style), served by
 * /api/config/client (see lib/address-tags.ts for how they are derived).
 * The map is fetched once per page load and shared between hook instances.
 */

let cachedTags: Record<string, string> | null = null;
let tagsPromise: Promise<Record<string, string>> | null = null;

async function fetchTags(): Promise<Record<string, string>> {
  try {
    const response = await fetch('/api/config/client');
    if (!response.ok) return {};
    const data = await response.json();
    const tags = data.addressTags;
    return tags && typeof tags === 'object' ? (tags as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function useAddressTags() {
  const [tags, setTags] = useState<Record<string, string>>(cachedTags || {});

  useEffect(() => {
    if (cachedTags) return;
    if (!tagsPromise) tagsPromise = fetchTags();
    let cancelled = false;
    tagsPromise.then((loaded) => {
      cachedTags = loaded;
      if (!cancelled) setTags(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const getTag = (address: string | null | undefined): string | null =>
    (address && tags[address.toLowerCase()]) || null;

  return { tags, getTag };
}
