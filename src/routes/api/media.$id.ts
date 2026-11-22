// /api/media/$id — GET one (public), DELETE (the uploader or an admin; a
// token needs media:write): a soft delete (media.deleted = 1) plus the R2
// delete, so /media/<key> answers 404 afterwards. -> {deleted: id}.

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { loadMedia, mapMedia, mediaBucket } from '@/lib/media';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ media: mapMedia(await loadMedia(params.id)) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const m = await loadMedia(params.id);
  if (m.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'not your upload', 'only the uploader or an admin deletes it');
  await exec('UPDATE media SET deleted = 1 WHERE id = ? AND deleted = 0', [m.id]);
  await mediaBucket().delete(m.r2_key);
  await appendChangelog(actorName(user), `media #${m.id} deleted (${m.device_slug})`);
  return json({ deleted: m.id });
}

export const Route = createFileRoute('/api/media/$id')({
  server: { handlers: apiHandlers({ GET: handleGet, DELETE: handleDelete }) },
});
