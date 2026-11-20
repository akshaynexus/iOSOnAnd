// /api/posts — GET reddit-post list, POST add (auth). 409 on duplicate url.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst } from '@/lib/db';
import {
  HttpError,
  actorName,
  handleError,
  insertReturningId,
  json,
  readJson,
  requireUser,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { RedditPost } from '@/lib/types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function handleGet(req: Request): Promise<Response> {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 100, 1), 200);
  const posts = await queryAll<RedditPost>(`SELECT * FROM reddit_posts ORDER BY id DESC LIMIT ${limit}`);
  return json({ posts });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const title = String(body.title || '').trim();
  const url = String(body.url || body.link || '').trim();
  if (!title) throw new HttpError(400, 'title required', 'send {"title","url"} plus optional published/note');
  if (!/^https?:\/\//.test(url)) throw new HttpError(400, 'bad url', 'url must start with http(s)://');
  const published = body.published ? String(body.published) : today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) {
    throw new HttpError(400, 'bad published', 'use YYYY-MM-DD');
  }
  if (await queryFirst('SELECT id FROM reddit_posts WHERE url = ?', [url])) {
    throw new HttpError(409, 'post already tracked', 'that url is already in the updates list');
  }
  const id = await insertReturningId(
    'INSERT INTO reddit_posts (title, url, published, note) VALUES (?, ?, ?, ?)',
    [title, url, published, String(body.note || '')],
  );
  const row = id
    ? await queryFirst<RedditPost>('SELECT * FROM reddit_posts WHERE id = ?', [id])
    : await queryFirst<RedditPost>('SELECT * FROM reddit_posts ORDER BY id DESC LIMIT 1');
  if (!row) throw new HttpError(500, 'post creation failed', 'retry');
  await appendChangelog(actorName(user), `post added: ${title.slice(0, 80)}`);
  return json({ post: row }, 201);
}

export const Route = createFileRoute('/api/posts')({
  server: {
    handlers: {
  GET: async ({ request }: { request: Request }) => {
    try {
      return await handleGet(request);
    } catch (e) {
      return handleError(e);
    }
  },
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
