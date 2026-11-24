// /api/areas — GET the checklist areas (public; each has scope all | oneios | extra;
// ?limit= default and max 500, ?offset=), POST add one {slug, name, notes?,
// scope?} (admin).

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { AREA_SCOPES, HttpError, actorName, json, oneOf, paged, pageParams, readJson, requireAdmin, str, validSlug } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { appendChangelog } from '@/lib/changelog';
import type { Area } from '@/lib/types';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const page = pageParams(new URL(request.url).searchParams, 500, 500);
  const { rows, page: info } = await paged<Area>('SELECT * FROM areas ORDER BY slug', 'SELECT COUNT(*) AS n FROM areas', [], page);
  return json({ areas: rows, ...info });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const body = await readJson(request);
  const slug = str(body, 'slug', 64).toLowerCase();
  const name = str(body, 'name', 120);
  if (!validSlug(slug)) throw new HttpError(400, 'bad slug', 'use lowercase letters, digits and dashes');
  if (!name) throw new HttpError(400, 'name required', 'send {"slug","name"} plus optional notes');
  if (await queryFirst('SELECT slug FROM areas WHERE slug = ?', [slug])) {
    throw new HttpError(409, 'area exists', 'area slugs are unique');
  }
  const scope = oneOf(AREA_SCOPES, str(body, 'scope', 16) || 'all', 'scope');
  const row = await queryFirst<Area>('INSERT INTO areas (slug, name, notes, scope) VALUES (?, ?, ?, ?) RETURNING *', [
    slug,
    name,
    str(body, 'notes', 2000),
    scope,
  ]);
  await appendChangelog(actorName(user), `area ${slug} added`);
  return json({ area: row }, 201);
}

export const Route = createFileRoute('/api/areas')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
