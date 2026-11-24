// /api/devices/$slug — GET detail (statuses + forks + claims + maintainers +
// supported_by + media + recent posts, public), PATCH update (admin or a
// maintainer of $slug; base and image_* are admin-only; CLI device-set),
// DELETE remove (admin).

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst, exec } from '@/lib/db';
import { mediaBucket } from '@/lib/media';
import {
  HttpError,
  REPO_KINDS,
  STATES,
  actorName,
  json,
  nowIso,
  isAdmin,
  oneOf,
  readJson,
  requireAdmin,
  requireDeviceEditor,
  str,
} from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { DEVICE_ADMIN_FIELDS, DEVICE_TEXT, deviceField, withDetails } from '@/lib/devices';
import { appendChangelog } from '@/lib/changelog';
import type { Device } from '@/lib/types';

async function loadDevice(slug: string): Promise<Device> {
  const device = await queryFirst<Device>('SELECT * FROM devices WHERE slug = ?', [slug]);
  if (!device) throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  return device;
}

async function handleGet({ params }: ApiCtx): Promise<Response> {
  const [device] = await withDetails([await loadDevice(params.slug)], true);
  return json({ device });
}

const PATCHABLE: Record<string, number> = {
  name: 120,
  model: 64,
  soc: 64,
  repo_kind: 32,
  status: 32,
  best_result: 2000,
  notes: 4000,
};

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  const slug = params.slug;
  const user = await requireDeviceEditor(request, slug);
  const body = await readJson(request);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [f, max] of Object.entries(PATCHABLE)) {
    if (body[f] === undefined) continue;
    const v = str(body, f, max);
    if (f === 'status') oneOf(STATES, v, 'status');
    if (f === 'repo_kind') oneOf(REPO_KINDS, v, 'repo_kind');
    if (f === 'name' && !v) throw new HttpError(400, 'name required', 'device name cannot be empty');
    sets.push(`${f} = ?`);
    vals.push(v);
  }
  for (const f of Object.keys(DEVICE_TEXT)) {
    if (body[f] === undefined) continue;
    if (DEVICE_ADMIN_FIELDS.includes(f) && !isAdmin(user)) {
      throw new HttpError(403, 'admin required', `only an admin sets ${f}; maintainers may set ios_version and the other fields`);
    }
    sets.push(`${f} = ?`);
    vals.push(deviceField(body, f));
  }
  if (!sets.length) {
    throw new HttpError(400, 'nothing to update', `send any of: ${[...Object.keys(PATCHABLE), ...Object.keys(DEVICE_TEXT)].join(', ')}`);
  }
  sets.push('updated = ?');
  vals.push(nowIso(), slug);
  await exec(`UPDATE devices SET ${sets.join(', ')} WHERE slug = ?`, vals);
  const row = await loadDevice(slug);
  await appendChangelog(actorName(user), `device ${slug} updated (${sets.length - 1} field(s))`);
  return json({ device: row });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const slug = params.slug;
  await loadDevice(slug);
  await exec('DELETE FROM device_status WHERE device_slug = ?', [slug]);
  await exec('DELETE FROM claims WHERE device_slug = ?', [slug]);
  await exec('UPDATE forks SET device_slug = NULL WHERE device_slug = ?', [slug]);
  await exec('DELETE FROM repo_devices WHERE device_slug = ?', [slug]);
  await exec('UPDATE repo_claims SET device_slug = NULL WHERE device_slug = ?', [slug]);
  // Uploads go with the device: the R2 objects and the media rows.
  const media = await queryAll<{ id: number; r2_key: string }>('SELECT id, r2_key FROM media WHERE device_slug = ? AND deleted = 0', [slug]);
  if (media.length) {
    try {
      await mediaBucket().delete(media.map((m) => m.r2_key));
    } catch (e) {
      console.error('media delete failed:', e);
    }
  }
  await exec('UPDATE media SET update_id = NULL WHERE device_slug = ?', [slug]);
  await exec('DELETE FROM device_updates WHERE device_slug = ?', [slug]);
  await exec('DELETE FROM media WHERE device_slug = ?', [slug]);
  await exec('DELETE FROM devices WHERE slug = ?', [slug]);
  await appendChangelog(actorName(user), `device ${slug} removed`);
  return json({ deleted: slug });
}

export const Route = createFileRoute('/api/devices/$slug')({
  server: { handlers: apiHandlers({ GET: handleGet, PATCH: handlePatch, DELETE: handleDelete }) },
});
