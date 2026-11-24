// /api/media/$id — GET one (public). PATCH {caption?, history_id?,
// feature_id?} links an upload to the status change it is evidence for or
// the notable feature it shows (both on the upload's device; null unlinks),
// or changes its caption: the uploader, an admin or a maintainer of the
// device; a token needs media:write. A status change sets the upload's area
// to the change's. -> {media}. DELETE (the uploader or an admin): a soft
// delete (media.deleted = 1) plus the R2 delete, so /media/<key> answers 404
// afterwards. -> {deleted: id}.

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, readJson, requireDeviceEditor, requireUser, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { loadMedia, mapMedia, mediaBucket, mediaLinks } from '@/lib/media';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ media: mapMedia(await loadMedia(params.id)) });
}

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const m = await loadMedia(params.id);
  if (m.user_id !== user.id && !isAdmin(user)) await requireDeviceEditor(request, m.device_slug);
  const body = await readJson(request);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (!has('caption') && !has('history_id') && !has('feature_id')) {
    throw new HttpError(400, 'nothing to change', 'send {"history_id": N} or {"feature_id": N} (null unlinks), or {"caption": "..."}');
  }
  const caption = has('caption') ? str(body, 'caption', 500) : m.caption;
  if (has('caption') && String(body.caption ?? '').length > 500) throw new HttpError(400, 'caption too long', 'captions are limited to 500 characters');
  const history = has('history_id') ? body.history_id : m.history_id;
  const feature = has('feature_id') ? body.feature_id : m.feature_id;
  // A new status change brings its area; keeping the old one keeps the upload's area.
  const l = await mediaLinks(m.device_slug, { history, feature, area: has('history_id') && history !== null ? null : m.area_slug });
  await exec('UPDATE media SET caption = ?, history_id = ?, feature_id = ?, area_slug = ? WHERE id = ?', [
    caption,
    l.history_id,
    l.feature_id,
    l.area,
    m.id,
  ]);
  const what = [
    l.history_id !== (m.history_id ?? null) ? (l.history_id ? `status change #${l.history_id}` : 'no status change') : '',
    l.feature_id !== (m.feature_id ?? null) ? (l.feature_id ? `feature #${l.feature_id}` : 'no feature') : '',
  ].filter(Boolean);
  await appendChangelog(actorName(user), `media #${m.id} (${m.device_slug}) ${what.length ? `linked to ${what.join(' and ')}` : 'caption changed'}`);
  return json({ media: mapMedia(await loadMedia(String(m.id))) });
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
  server: { handlers: apiHandlers({ GET: handleGet, PATCH: handlePatch, DELETE: handleDelete }) },
});
