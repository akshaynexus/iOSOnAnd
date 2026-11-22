// /api/posts — GET the updates list (public; ?limit= default 100, max 500,
// ?offset=; -> {posts, total, limit, offset, next}), POST add a reddit link (admin,
// or a maintainer of any device). url must be https://(www.|old.)reddit.com/r/...
// or https://redd.it/<id>; it is stored in canonical form (www., no query).
// 409 on a duplicate url.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, actorName, json, paged, pageParams, readJson, requirePoster, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { postFields } from '@/lib/posts';
import { appendChangelog } from '@/lib/changelog';
import type { RedditPost } from '@/lib/types';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const page = pageParams(new URL(request.url).searchParams, 100, 500);
  const { rows, page: info } = await paged<RedditPost>('SELECT * FROM reddit_posts ORDER BY id DESC', 'SELECT COUNT(*) AS n FROM reddit_posts', [], page);
  return json({ posts: rows, ...info });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requirePoster(request);
  const body = await readJson(request);
  if (body.url === undefined && body.link !== undefined) body.url = body.link;
  const f = postFields(body, true);
  if (await queryFirst('SELECT id FROM reddit_posts WHERE url = ?', [f.url])) {
    throw new HttpError(409, 'post already tracked', 'that url is already in the updates list');
  }
  const row = await queryFirst<RedditPost>(
    'INSERT INTO reddit_posts (title, url, published, note, image_url, image_width, image_height) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    [
      f.title,
      f.url,
      f.published || new Date().toISOString().slice(0, 10),
      str(body, 'note', 1000),
      f.image_url ?? '',
      f.image_width ?? null,
      f.image_height ?? null,
    ],
  );
  if (!row) throw new HttpError(500, 'post creation failed', 'retry');
  await appendChangelog(actorName(user), `post added: ${f.title!.slice(0, 80)}`);
  return json({ post: row }, 201);
}

export const Route = createFileRoute('/api/posts')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
