// GET /sitemap.xml — every public page: the home page, the projects and repos tab, each device page (with
// its last update as lastmod), the docs pages and the API reference. URLs are
// on SITE_URL (src/lib/seo.ts), the same origin as each page's canonical link.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll } from '@/lib/db';
import { source } from '@/lib/source';
import { SITE_URL } from '@/lib/seo';

interface Entry {
  path: string;
  lastmod?: string | null;
  priority: string;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** YYYY-MM-DD from an ISO timestamp, or null when it does not parse. */
function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

async function build(): Promise<string> {
  const devices = await queryAll<{ slug: string; updated: string | null; status_updated: string | null }>(
    `SELECT d.slug, d.updated, (SELECT MAX(s.updated) FROM device_status s WHERE s.device_slug = d.slug) AS status_updated
       FROM devices d ORDER BY d.slug`,
  );
  const newest = devices.reduce<string | null>((m, d) => {
    const v = [d.updated, d.status_updated].filter(Boolean).sort().pop() ?? null;
    return v && (!m || v > m) ? v : m;
  }, null);

  const entries: Entry[] = [
    { path: '/', lastmod: day(newest), priority: '1.0' },
    ...devices.map((d) => ({
      path: `/device/${encodeURIComponent(d.slug)}`,
      lastmod: day([d.updated, d.status_updated].filter(Boolean).sort().pop()),
      priority: '0.8',
    })),
    ...source.getPages().map((p) => ({ path: p.url, priority: '0.5' })),
    { path: '/?tab=repos', priority: '0.7' },
    { path: '/api-reference', priority: '0.3' },
  ];

  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : '';
      return `<url><loc>${xmlEscape(SITE_URL + e.path)}</loc>${lastmod}<priority>${e.priority}</priority></url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () =>
        new Response(await build(), {
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=3600',
          },
        }),
    },
  },
});
