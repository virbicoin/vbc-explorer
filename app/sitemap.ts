import type { MetadataRoute } from 'next';
import { siteMetadataBase } from '@/lib/seo';

/**
 * /sitemap.xml — the stable hub/landing routes worth advertising to crawlers.
 * Per-entity pages (block / tx / address / token) are unbounded and discovered
 * through on-page links, so they are intentionally not enumerated here. URLs
 * are made absolute against the configured explorer URL (metadataBase).
 */
type HubRoute = {
  path: string;
  priority: number;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
};

const HUB_ROUTES: HubRoute[] = [
  { path: '/', priority: 1, changeFrequency: 'always' },
  { path: '/blocks', priority: 0.9, changeFrequency: 'always' },
  { path: '/transactions', priority: 0.9, changeFrequency: 'always' },
  { path: '/tokens', priority: 0.8, changeFrequency: 'hourly' },
  { path: '/contracts', priority: 0.7, changeFrequency: 'daily' },
  { path: '/stats', priority: 0.7, changeFrequency: 'hourly' },
  { path: '/richlist', priority: 0.6, changeFrequency: 'daily' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteMetadataBase();
  return HUB_ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: base ? new URL(path, base).toString() : path,
    changeFrequency,
    priority,
  }));
}
