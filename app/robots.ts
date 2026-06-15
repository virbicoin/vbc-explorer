import type { MetadataRoute } from 'next';
import { siteMetadataBase } from '@/lib/seo';

/**
 * /robots.txt — allow crawling of all pages, keep crawlers off the JSON API,
 * and point at the sitemap. The host and sitemap URL are derived from the
 * configured explorer URL (metadataBase), so this stays generic across
 * deployments. When no explorer URL is configured, a minimal allow/disallow
 * ruleset is emitted without an absolute sitemap/host.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteMetadataBase();
  const rules = { userAgent: '*', allow: '/', disallow: '/api/' };

  if (!base) return { rules };

  return {
    rules,
    sitemap: new URL('/sitemap.xml', base).toString(),
    host: base.host,
  };
}
