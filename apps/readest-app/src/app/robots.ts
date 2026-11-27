import type { MetadataRoute } from 'next';

// lisetlead.com/robots.txt (owner's ask, 27 Nov 2026: référencement Google et chats IA).
// Every robot is welcome, search engines and AI assistants alike, on the public pages;
// the reader's private pages and the API stay out of their way. Cloudflare adds its
// own notice in front of these lines.

export const dynamic = 'force-static';

const SITE = (process.env['NEXT_PUBLIC_API_BASE_URL'] || 'https://lisetlead.com').replace(
  /\/$/,
  '',
);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/auth',
          '/stats',
          '/reader',
          '/user',
          '/s/',
          '/o/',
          '/send',
          '/opds',
          '/updater',
          '/offline',
          '/supprimer-mon-compte',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
