// src/lib/reddit.ts — r/hackios fetch helper (server side of `reddit-fetch`).
// Queries the subreddit search endpoint for OneiOS mentions and returns
// unseen-post candidates (title/url/published). Fails soft: network or Reddit
// errors come back as {candidates: [], error} instead of throwing, so callers
// can surface a clear message without breaking the site.

export interface RedditCandidate {
  title: string;
  url: string;
  published: string; // YYYY-MM-DD
}

export async function fetchRedditCandidates(opts?: {
  knownUrls?: string[] | Set<string>;
  limit?: number;
  /** Subreddit without the r/ (default hackios). Letters/digits/underscore. */
  subreddit?: string;
}): Promise<{ candidates: RedditCandidate[]; error?: string }> {
  const known = opts?.knownUrls instanceof Set ? opts.knownUrls : new Set(opts?.knownUrls || []);
  const limit = Math.min(Math.max(Number(opts?.limit) || 25, 1), 50);
  const sub = (opts?.subreddit || 'hackios').trim() || 'hackios';
  if (!/^[A-Za-z0-9_]{1,21}$/.test(sub)) {
    return { candidates: [], error: `bad subreddit ${JSON.stringify(sub)}: letters/digits/underscore only` };
  }
  const url = `https://www.reddit.com/r/${sub}/search.json?q=OneiOS&restrict_sr=1&sort=new&limit=25`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        // Reddit requires a descriptive User-Agent; default fetch UA gets 429s.
        'User-Agent': 'iOSOnAnd-tracker/1.0 (community device-status tracker)',
        Accept: 'application/json',
      },
    });
  } catch (e) {
    return { candidates: [], error: `reddit fetch failed: ${msg(e)}` };
  }
  if (res.status === 429) {
    return { candidates: [], error: 'reddit rate limited (429): wait a few minutes and retry' };
  }
  if (!res.ok) {
    return { candidates: [], error: `reddit responded ${res.status}: retry later` };
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    return { candidates: [], error: 'reddit returned bad JSON: retry later' };
  }

  const children = body?.data?.children;
  if (!Array.isArray(children)) {
    return { candidates: [], error: 'unexpected reddit response shape: retry later' };
  }

  const out: RedditCandidate[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    const d = child?.data;
    if (!d || typeof d.title !== 'string') continue;
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
  return { candidates: out };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
