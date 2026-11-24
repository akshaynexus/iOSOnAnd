// GET /robots.txt — crawl rules and the sitemap location (src/lib/seo.ts).
// The JSON API and the account pages stay out of search; every page under
// them also sends noindex.

import { createFileRoute } from '@tanstack/react-router';
import { SITE_URL } from '@/lib/seo';

const BODY = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /profile
Disallow: /login
Disallow: /signup
Disallow: /forgot-password
Disallow: /reset-password

Sitemap: ${SITE_URL}/sitemap.xml
`;

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () =>
        new Response(BODY, {
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'public, max-age=86400',
          },
        }),
    },
  },
});
