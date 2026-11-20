// POST /api/reddit/fetch — run the r/hackios fetch (CLI reddit-fetch).
// Body {subreddit?} (default hackios). Stores unseen posts, returns
// {added, posts}. 502 with {error, hint} when Reddit is unreachable.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, exec } from '@/lib/db';
import { HttpError, actorName, handleError, json, readJson, requireUser } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import { fetchRedditCandidates } from '@/lib/reddit';
import type { RedditPost } from '@/lib/types';

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const subreddit = body.subreddit ? String(body.subreddit) : 'hackios';
  const known = new Set((await queryAll<{ url: string }>('SELECT url FROM reddit_posts')).map((r) => r.url));
  const { candidates, error } = await fetchRedditCandidates({ knownUrls: known, subreddit });
  const added: RedditPost[] = [];
  for (const c of candidates) {
    try {
      await exec('INSERT INTO reddit_posts (title, url, published, note) VALUES (?, ?, ?, ?)', [
        c.title,
        c.url,
        c.published,
        '',
      ]);
      added.push({ title: c.title, url: c.url, published: c.published } as RedditPost);
    } catch {
      // Lost a race with another fetch; skip the duplicate.
    }
  }
  await appendChangelog(actorName(user), `reddit-fetch r/${subreddit}: ${added.length} new candidate(s)`);
  if (error && added.length === 0) {
    throw new HttpError(502, error, 'reddit may be down or rate limiting; retry in a few minutes');
  }
  return json({ added: added.length, posts: added, ...(error ? { warning: error } : {}) });
}

export const Route = createFileRoute('/api/reddit/fetch')({
  server: {
    handlers: {
  POST: async ({ request }: { request: Request }) => {
    try {
      return await handlePost(request);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
