// POST /api/reddit/fetch — run the r/<subreddit> fetch (admin; CLI
// reddit-fetch). Body {subreddit?} (default hackios). Stores unseen posts,
// returns {added, posts}. 502 with {error, hint} when Reddit is unreachable.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst } from '@/lib/db';
import { HttpError, actorName, json, normalizeRedditUrl, readJson, requireAdmin, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { appendChangelog } from '@/lib/changelog';
import { fetchRedditCandidates } from '@/lib/reddit';
import type { RedditPost } from '@/lib/types';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const body = await readJson(request);
  const subreddit = str(body, 'subreddit', 21) || 'hackios';
  if (!/^[A-Za-z0-9_]{1,21}$/.test(subreddit)) {
    throw new HttpError(400, 'bad subreddit', 'letters, digits and underscore only, without r/');
  }
  const known = new Set((await queryAll<{ url: string }>('SELECT url FROM reddit_posts')).map((r) => r.url));
  const { candidates, error } = await fetchRedditCandidates({ knownUrls: known, subreddit });
  const added: RedditPost[] = [];
  for (const c of candidates) {
    const url = normalizeRedditUrl(c.url);
    if (!url || known.has(url)) continue;
    known.add(url);
    const row = await queryFirst<RedditPost>(
      'INSERT INTO reddit_posts (title, url, published, note) VALUES (?, ?, ?, ?) ON CONFLICT(url) DO NOTHING RETURNING *',
      [c.title.slice(0, 300), url, c.published, ''],
    );
    if (row) added.push(row);
  }
  await appendChangelog(actorName(user), `reddit-fetch r/${subreddit}: ${added.length} new candidate(s)`);
  if (error && added.length === 0) {
    throw new HttpError(502, error, 'reddit may be down or rate limiting; retry in a few minutes');
  }
  return json({ added: added.length, posts: added, ...(error ? { warning: error } : {}) });
}

export const Route = createFileRoute('/api/reddit/fetch')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
