// src/lib/reddit.ts — r/hackios fetch helper (server side of `reddit-fetch`).
// Finds the subreddit's posts that mention OneiOS, newest first, and returns
// the unseen ones as candidates (title/url/published). It reads the Arctic
// Shift archive of Reddit (arctic-shift.photon-reddit.com), which answers
// from networks Reddit refuses, and falls back to Reddit's own search when the
// archive fails. Fails soft: when both fail the candidates are empty and
// `error` says why, so callers can surface a clear message without breaking
// the site.

export interface RedditCandidate {
  title: string;
  url: string;
  published: string; // YYYY-MM-DD
}

const UA = 'iOSOnAnd-tracker/1.0 (community device-status tracker)';
const ARCTIC = 'https://arctic-shift.photon-reddit.com/api';

interface RawPost {
  title?: unknown;
  permalink?: unknown;
  url?: unknown;
  url_overridden_by_dest?: unknown;
  created_utc?: unknown;
}

/** The archive: posts whose title or text mention the query, newest first. */
async function fromArchive(sub: string, query: string): Promise<RawPost[]> {
  const q = new URLSearchParams({ subreddit: sub, query, sort: 'desc', limit: '50' });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ARCTIC}/posts/search?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    // 429, 5xx, and its 422 "Timeout. Maybe slow down a bit": one short retry.
    if ((res.status === 429 || res.status === 422 || res.status >= 500) && attempt < 1) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new Error(`archive responded ${res.status}`);
    const body = (await res.json()) as { data?: RawPost[] };
    if (!Array.isArray(body?.data)) throw new Error('unexpected archive response shape');
    return body.data;
  }
}

/** Reddit's own search, the fallback. */
async function fromReddit(sub: string, query: string): Promise<RawPost[]> {
  const res = await fetch(`https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=25`, {
    // Reddit requires a descriptive User-Agent; default fetch UA gets 429s.
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (res.status === 429) throw new Error('reddit rate limited (429): wait a few minutes and retry');
  if (!res.ok) throw new Error(`reddit responded ${res.status}`);
  const body = (await res.json()) as { data?: { children?: Array<{ data?: RawPost }> } };
  const children = body?.data?.children;
  if (!Array.isArray(children)) throw new Error('unexpected reddit response shape');
  return children.map((c) => c?.data ?? {});
}

export async function fetchRedditCandidates(opts?: {
  knownUrls?: string[] | Set<string>;
  limit?: number;
  /** Subreddit without the r/ (default hackios). Letters/digits/underscore. */
  subreddit?: string;
}): Promise<{ candidates: RedditCandidate[]; error?: string; source?: 'archive' | 'reddit' }> {
  const known = opts?.knownUrls instanceof Set ? opts.knownUrls : new Set(opts?.knownUrls || []);
  const limit = Math.min(Math.max(Number(opts?.limit) || 25, 1), 50);
  const sub = (opts?.subreddit || 'hackios').trim() || 'hackios';
  if (!/^[A-Za-z0-9_]{1,21}$/.test(sub)) {
    return { candidates: [], error: `bad subreddit ${JSON.stringify(sub)}: letters/digits/underscore only` };
  }

  let posts: RawPost[];
  let source: 'archive' | 'reddit' = 'archive';
  try {
    posts = await fromArchive(sub, 'OneiOS');
  } catch (archiveError) {
    try {
      posts = await fromReddit(sub, 'OneiOS');
      source = 'reddit';
    } catch (redditError) {
      return { candidates: [], error: `archive: ${msg(archiveError)}; reddit: ${msg(redditError)}` };
    }
  }

  const out: RedditCandidate[] = [];
  const seen = new Set<string>();
  for (const d of posts) {
    if (typeof d.title !== 'string') continue;
    const url =
      typeof d.permalink === 'string' && d.permalink
        ? `https://www.reddit.com${d.permalink}`
        : String(d.url_overridden_by_dest || d.url || '').trim();
    if (!url || seen.has(url) || known.has(url)) continue;
    seen.add(url);
    let published = '';
    if (typeof d.created_utc === 'number' && Number.isFinite(d.created_utc)) {
      published = new Date(d.created_utc * 1000).toISOString().slice(0, 10);
    }
    out.push({ title: d.title, url, published });
    if (out.length >= limit) break;
  }
  return { candidates: out, source };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
