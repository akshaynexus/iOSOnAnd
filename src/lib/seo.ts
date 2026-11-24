// src/lib/seo.ts: page metadata for search engines and link previews.
//
// Every page route builds its `head()` with seo(): title, description,
// canonical URL, Open Graph and Twitter card tags, and robots. TanStack's
// <HeadContent /> keeps the deepest route's meta when names repeat, so the
// root route's defaults are overridden page by page.
//
// SITE_URL is the canonical origin. Set VITE_SITE_URL at build time for
// another deploy; the default is the production site.

export const SITE_NAME = 'iOSOnAnd';
export const SITE_URL = (
  (import.meta.env?.VITE_SITE_URL as string | undefined) || 'https://hackios.appaiproxy.com'
).replace(/\/+$/, '');
export const SITE_DESCRIPTION =
  'Which Android phones run iOS through OneiOS and its forks, and what works on each one: boot, display, touch, Wi-Fi, audio and more, area by area.';

/** An absolute URL on SITE_URL for a path, or the URL itself when it already is one. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/** Text cut to `max` characters on a word boundary, with an ellipsis. */
export function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export interface SeoInput {
  title: string;
  description?: string | null;
  /** Path of the canonical URL, e.g. /device/s24-ultra. Omitted: no canonical. */
  path?: string;
  /** Preview image, absolute or a site path. */
  image?: string | null;
  type?: 'website' | 'article';
  /** Keep the page out of search results (account and auth pages). */
  noindex?: boolean;
}

type Meta = Record<string, string>;
type LinkTag = Record<string, string>;

export function seo(input: SeoInput): { meta: Meta[]; links: LinkTag[] } {
  const description = clip(input.description?.trim() || SITE_DESCRIPTION);
  const meta: Meta[] = [
    { title: input.title },
    { name: 'description', content: description },
    { name: 'robots', content: input.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large' },
    { property: 'og:title', content: input.title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: input.type ?? 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { name: 'twitter:title', content: input.title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:card', content: input.image ? 'summary_large_image' : 'summary' },
  ];
  const links: LinkTag[] = [];
  if (input.path) {
    const url = absoluteUrl(input.path);
    meta.push({ property: 'og:url', content: url });
    links.push({ rel: 'canonical', href: url });
  }
  if (input.image) {
    const img = absoluteUrl(input.image);
    meta.push({ property: 'og:image', content: img }, { name: 'twitter:image', content: img });
  }
  return { meta, links };
}

/** schema.org JSON-LD as a head script. `<` is escaped so text cannot close the tag. */
export function jsonLd(data: unknown): { type: string; children: string } {
  return { type: 'application/ld+json', children: JSON.stringify(data).replace(/</g, '\\u003c') };
}
