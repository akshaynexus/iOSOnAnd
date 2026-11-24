// /api/devices/$slug/updates — maintainer updates on a phone (src/lib/updates.ts).
// GET (public) ?limit= (default 20, max 100) ?offset= -> {updates: [{id,
// device_slug, body, user, created, media: [Media]}], total, limit, offset,
// next}, newest first.
// POST {body, media_ids?: [id, ...]} (admin or a maintainer of the phone; a
// token needs media:write): text up to 2000 characters, up to 10 uploads of
// this phone from POST /api/media that are yours and in no other update.
// -> 201 {update}. CLI: update <device> --text "..." --photo FILE ...

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, json, pageInfo, pageParams, readJson, requireDeviceEditor, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { MAX_UPDATE_BODY, createUpdate, listUpdates } from '@/lib/updates';

async function handleGet({ request, params }: ApiCtx): Promise<Response> {
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [params.slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const page = pageParams(new URL(request.url).searchParams, 20, 100);
  const { updates, total } = await listUpdates(params.slug, page.limit, page.offset);
  return json({ updates, ...pageInfo(total, page.limit, page.offset, updates.length) });
}

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireDeviceEditor(request, params.slug);
  const body = await readJson(request);
  const raw = Array.isArray(body.media_ids) ? body.media_ids : body.media_ids === undefined ? [] : null;
  if (raw === null || raw.some((x: unknown) => !Number.isInteger(Number(x)))) {
    throw new HttpError(400, 'bad media_ids', 'media_ids is a list of upload ids from POST /api/media');
  }
  const update = await createUpdate(user, params.slug, str(body, 'body', MAX_UPDATE_BODY + 1), raw.map(Number));
  return json({ update }, 201);
}

export const Route = createFileRoute('/api/devices/$slug/updates')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
