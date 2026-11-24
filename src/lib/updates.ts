// src/lib/updates.ts — maintainer updates on a phone (device_updates): a short
// text with photos and clips attached. The files are uploaded first (POST
// /api/media, which checks type and size), then the update names them in
// media_ids; media.update_id ties them to it. The CLI's `update` command does
// both steps, so an agent posts "what changed, with proof" in one go.

import { queryAll, queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, nowIso, type UserRow } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import { MEDIA_SELECT, mapMedia, type Media, type MediaRow } from '@/lib/media';
import type { UserRef } from '@/lib/forks';

export const MAX_UPDATE_MEDIA = 10;
export const MAX_UPDATE_BODY = 2000;

interface UpdateRow {
  id: number;
  device_slug: string;
  user_id: number;
  body: string;
  created: string;
  deleted: number;
  display_name?: string | null;
  github_login?: string | null;
}

export interface DeviceUpdate {
  id: number;
  device_slug: string;
  body: string;
  user: UserRef;
  created: string;
  media: Media[];
}

const UPDATE_SELECT = 'SELECT du.*, u.display_name, u.github_login FROM device_updates du LEFT JOIN users u ON u.id = du.user_id';

async function withMedia(rows: UpdateRow[]): Promise<DeviceUpdate[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const media = await queryAll<MediaRow & { update_id: number }>(
    `${MEDIA_SELECT} WHERE m.update_id IN (${ids.map(() => '?').join(', ')}) AND m.deleted = 0 ORDER BY m.id`,
    ids,
  );
  const by = new Map<number, Media[]>();
  for (const m of media) {
    if (!by.has(m.update_id)) by.set(m.update_id, []);
    by.get(m.update_id)!.push(mapMedia(m));
  }
  return rows.map((r) => ({
    id: r.id,
    device_slug: r.device_slug,
    body: r.body,
    user: { id: r.user_id, display_name: r.display_name ?? '', github_login: r.github_login ?? null },
    created: r.created,
    media: by.get(r.id) ?? [],
  }));
}

/** A phone's updates, newest first. */
export async function listUpdates(slug: string, limit: number, offset: number): Promise<{ updates: DeviceUpdate[]; total: number }> {
  const total = (await queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM device_updates WHERE device_slug = ? AND deleted = 0', [slug]))?.n ?? 0;
  const rows = await queryAll<UpdateRow>(`${UPDATE_SELECT} WHERE du.device_slug = ? AND du.deleted = 0 ORDER BY du.id DESC LIMIT ? OFFSET ?`, [
    slug,
    limit,
    offset,
  ]);
  return { updates: await withMedia(rows), total };
}

export async function loadUpdate(slug: string, id: string | number): Promise<UpdateRow> {
  const row = await queryFirst<UpdateRow>(`${UPDATE_SELECT} WHERE du.id = ? AND du.device_slug = ? AND du.deleted = 0`, [Number(id), slug]);
  if (!row) throw new HttpError(404, 'no such update', `GET /api/devices/${slug}/updates lists them`);
  return row;
}

/**
 * Post an update. `mediaIds`: uploads of this phone, by the poster (an admin:
 * anyone's), not deleted and not in another update yet. 400 for any other id.
 */
export async function createUpdate(user: UserRow, slug: string, body: string, mediaIds: number[]): Promise<DeviceUpdate> {
  const text = body.trim();
  if (!text && !mediaIds.length) throw new HttpError(400, 'empty update', 'send {"body":"what changed"} and/or {"media_ids":[...]} from POST /api/media');
  if (text.length > MAX_UPDATE_BODY) throw new HttpError(400, 'body too long', `at most ${MAX_UPDATE_BODY} characters`);
  const ids = [...new Set(mediaIds)];
  if (ids.length > MAX_UPDATE_MEDIA) throw new HttpError(400, 'too many files', `at most ${MAX_UPDATE_MEDIA} photos or clips per update`);
  if (ids.length) {
    const ok = await queryAll<{ id: number }>(
      `SELECT id FROM media WHERE id IN (${ids.map(() => '?').join(', ')}) AND device_slug = ? AND deleted = 0 AND update_id IS NULL${isAdmin(user) ? '' : ' AND user_id = ?'}`,
      [...ids, slug, ...(isAdmin(user) ? [] : [user.id])],
    );
    const bad = ids.filter((id) => !ok.some((o) => o.id === id));
    if (bad.length) {
      throw new HttpError(400, 'bad media_ids', `media ${bad.join(', ')} are not your uploads of ${slug}, or belong to another update; upload with POST /api/media first`);
    }
  }
  const ins = await queryFirst<{ id: number }>('INSERT INTO device_updates (device_slug, user_id, body, created) VALUES (?, ?, ?, ?) RETURNING id', [
    slug,
    user.id,
    text,
    nowIso(),
  ]);
  if (!ins) throw new HttpError(500, 'update not saved', 'retry');
  if (ids.length) await exec(`UPDATE media SET update_id = ? WHERE id IN (${ids.map(() => '?').join(', ')})`, [ins.id, ...ids]);
  const files = ids.length ? ` (${ids.length} file${ids.length === 1 ? '' : 's'})` : '';
  await appendChangelog(actorName(user), `update on ${slug}${files}: ${text.slice(0, 120)}`);
  const [u] = await withMedia([(await queryFirst<UpdateRow>(`${UPDATE_SELECT} WHERE du.id = ?`, [ins.id]))!]);
  return u;
}

/** Hide an update (its author or an admin); its files stay in the gallery. */
export async function deleteUpdate(user: UserRow, slug: string, id: string): Promise<void> {
  const row = await loadUpdate(slug, id);
  if (row.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'not your update', 'only its author or an admin removes it');
  await exec('UPDATE device_updates SET deleted = 1 WHERE id = ?', [row.id]);
  await exec('UPDATE media SET update_id = NULL WHERE update_id = ?', [row.id]);
  await appendChangelog(actorName(user), `update #${row.id} on ${slug} removed`);
}
