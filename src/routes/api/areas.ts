// /api/areas — GET the 24-area checklist, POST add one (auth).

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  handleError,
  json,
  readJson,
  requireUser,
  validSlug,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { Area } from '@/lib/types';

async function handleGet(): Promise<Response> {
  const areas = await queryAll<Area>('SELECT * FROM areas ORDER BY slug');
  return json({ areas });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  if (!validSlug(slug)) throw new HttpError(400, 'bad slug', 'use lowercase letters, digits and dashes');
  if (!name) throw new HttpError(400, 'name required', 'send {"slug","name"} plus optional notes');
  if (await queryFirst('SELECT slug FROM areas WHERE slug = ?', [slug])) {
    throw new HttpError(409, 'area exists', 'area slugs are unique');
  }
  await exec('INSERT INTO areas (slug, name, notes) VALUES (?, ?, ?)', [slug, name, String(body.notes || '')]);
  const row = await queryFirst<Area>('SELECT * FROM areas WHERE slug = ?', [slug]);
  await appendChangelog(actorName(user), `area ${slug} added`);
  return json({ area: row }, 201);
}

export const Route = createFileRoute('/api/areas')({
  server: {
    handlers: {
  GET: async () => {
    try {
      return await handleGet();
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
