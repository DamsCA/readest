import type { MetadataRoute } from 'next';

// lisetlead.com/sitemap.xml (owner's ask, 27 Nov 2026: référencement Google et chats IA):
// the pages a search engine should know. /bienvenue is left out on purpose: it shows the
// prices, and a first public contact never does (owner's rule of 26 Nov 2026).

export const dynamic = 'force-static';

const SITE = (process.env['NEXT_PUBLIC_API_BASE_URL'] || 'https://lisetlead.com').replace(
  /\/$/,
  '',
);

export default function sitemap(): MetadataRoute.Sitemap {
  const maj = new Date('2026-11-27');
  return [
    { url: `${SITE}/`, lastModified: maj, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/decouvrir`, lastModified: maj, changeFrequency: 'monthly', priority: 0.9 },
    // The English classics we offer (28 Nov 2026).
    {
      url: `${SITE}/offerts`,
      lastModified: new Date('2026-11-28'),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    // /guide, the address everyone is given; /guide.html leads there (Cloudflare's own redirect).
    { url: `${SITE}/guide`, lastModified: maj, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
