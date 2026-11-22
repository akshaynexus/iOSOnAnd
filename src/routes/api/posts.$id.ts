// /api/posts/$id — GET one (public), PATCH update (admin; posts carry no
// author, so only an admin may rewrite one; CLI post-set sets the thumbnail:
// image_url, image_width, image_height), DELETE remove (admin).

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, json, readJson, requireAdmin } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { postFields } from '@/lib/posts';
import { appendChangelog } from '@/lib/changelog';
import type { RedditPost } from '@/lib/types';

async function loadPost(id: string): Promise<RedditPost> {
  if (!/^\d{1,15}$/.test(id)) throw new HttpError(404, 'unknown post', 'post ids are numeric');
  const row = await queryFirst<RedditPost>('SELECT * FROM reddit_posts WHERE id = ?', [Number(id)]);
  if (!row) throw new HttpError(404, 'unknown post', 'GET /api/posts to list tracked posts');
  return row;
}

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ post: await loadPost(params.id) });
}

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const post = await loadPost(params.id);
  const f = postFields(await readJson(request), false);
  const keys = Object.keys(f) as Array<keyof typeof f>;
  if (!keys.length) throw new HttpError(400, 'nothing to update', 'send any of: title, url, published, note, image_url, image_width, image_height');
  if (f.url && (await queryFirst('SELECT id FROM reddit_posts WHERE url = ? AND id != ?', [f.url, post.id]))) {
    throw new HttpError(409, 'url already tracked', 'that url belongs to another post');
  }
  await exec(`UPDATE reddit_posts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
    ...keys.map((k) => f[k]),
    post.id,
  ]);
  await appendChangelog(actorName(user), `post #${post.id} updated`);
  return json({ post: await loadPost(params.id) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const post = await loadPost(params.id);
  await exec('DELETE FROM reddit_posts WHERE id = ?', [post.id]);
  await appendChangelog(actorName(user), `post #${post.id} removed`);
  return json({ deleted: post.id });
}

export const Route = createFileRoute('/api/posts/$id')({
  server: { handlers: apiHandlers({ GET: handleGet, PATCH: handlePatch, DELETE: handleDelete }) },
});
