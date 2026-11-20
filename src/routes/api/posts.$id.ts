// /api/posts/$id — GET one, PATCH update (auth), DELETE remove (admin).

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  handleError,
  json,
  readJson,
  requireAdmin,
  requireUser,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { RedditPost } from '@/lib/types';

type Ctx = { request: Request; params: Record<string, string> };

async function loadPost(id: string): Promise<RedditPost> {
  if (!/^\d+$/.test(id)) throw new HttpError(404, 'unknown post', 'post ids are numeric');
  const row = await queryFirst<RedditPost>('SELECT * FROM reddit_posts WHERE id = ?', [Number(id)]);
  if (!row) throw new HttpError(404, 'unknown post', 'GET /api/posts to list tracked posts');
  return row;
}

async function handleGet(_req: Request, params: Record<string, string>): Promise<Response> {
  return json({ post: await loadPost(params.id) });
}

async function handlePatch(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(req);
  const post = await loadPost(params.id);
  const body = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of ['title', 'url', 'published', 'note']) {
    if (body[f] === undefined) continue;
    const v = String(body[f]).trim();
    if (f === 'title' && !v) throw new HttpError(400, 'title required', 'title cannot be empty');
    if (f === 'url') {
      if (!/^https?:\/\//.test(v)) throw new HttpError(400, 'bad url', 'url must start with http(s)://');
      const dup = await queryFirst('SELECT id FROM reddit_posts WHERE url = ? AND id != ?', [v, post.id]);
      if (dup) throw new HttpError(409, 'url already tracked', 'that url belongs to another post');
    }
    if (f === 'published' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new HttpError(400, 'bad published', 'use YYYY-MM-DD');
    }
    sets.push(`${f} = ?`);
    vals.push(v);
  }
  if (!sets.length) throw new HttpError(400, 'nothing to update', 'send any of: title, url, published, note');
  vals.push(post.id);
  await exec(`UPDATE reddit_posts SET ${sets.join(', ')} WHERE id = ?`, vals as never[]);
  const row = await loadPost(params.id);
  await appendChangelog(actorName(user), `post #${post.id} updated`);
  return json({ post: row });
}

async function handleDelete(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireAdmin(req);
  const post = await loadPost(params.id);
  await exec('DELETE FROM reddit_posts WHERE id = ?', [post.id]);
  await appendChangelog(actorName(user), `post #${post.id} removed`);
  return json({ deleted: post.id });
}

export const Route = createFileRoute('/api/posts/$id')({
  server: {
    handlers: {
  GET: async ({ request, params }: Ctx) => {
    try {
      return await handleGet(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
  PATCH: async ({ request, params }: Ctx) => {
    try {
      return await handlePatch(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
  DELETE: async ({ request, params }: Ctx) => {
    try {
      return await handleDelete(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
