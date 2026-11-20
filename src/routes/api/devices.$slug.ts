// /api/devices/$slug — GET detail (statuses + forks + claims + recent posts),
// PATCH update (auth), DELETE remove (admin).

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  STATES,
  actorName,
  handleError,
  json,
  nowIso,
  readJson,
  requireAdmin,
  requireUser,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { Claim, Device, DeviceStatus, Fork, RedditPost } from '@/lib/types';
import { mapClaimRow } from '@/routes/api/claims.$id';

const REPO_KINDS = ['home', 'fork', 'snapshot', 'mirror', 'none'];

type Ctx = { request: Request; params: Record<string, string> };

async function loadDevice(slug: string): Promise<Device> {
  const device = await queryFirst<Device>('SELECT * FROM devices WHERE slug = ?', [slug]);
  if (!device) throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  return device;
}

async function handleGet(_req: Request, params: Record<string, string>): Promise<Response> {
  const slug = params.slug;
  const device = await loadDevice(slug);
  const statuses = await queryAll<DeviceStatus & { area_name: string }>(
    `SELECT ds.*, a.name AS area_name FROM device_status ds
     JOIN areas a ON a.slug = ds.area_slug WHERE ds.device_slug = ? ORDER BY ds.area_slug`,
    [slug],
  );
  const forks = await queryAll<Fork>('SELECT * FROM forks WHERE device_slug = ? ORDER BY repo', [slug]);
  const claims = await queryAll<Claim & { display_name: string | null; github_login: string | null }>(
    `SELECT c.*, u.display_name, u.github_login FROM claims c
     LEFT JOIN users u ON u.id = c.user_id WHERE c.device_slug = ? ORDER BY c.id DESC`,
    [slug],
  );
  const posts = await queryAll<RedditPost>('SELECT * FROM reddit_posts ORDER BY id DESC LIMIT 10');
  // A device's forks are "maintained" by whoever holds the latest approved
  // port claim for the device; forks carry no owner column of their own.
  const approvedClaim = claims.find((c) => c.status === 'approved');
  const maintainer = approvedClaim
    ? (approvedClaim.github_login ? `@${approvedClaim.github_login}` : (approvedClaim.display_name || ''))
    : '';
  // UI shape: everything nested under device (area_names + related rows).
  const area_names: Record<string, string> = {};
  for (const s of statuses) area_names[s.area_slug] = s.area_name;
  return json({
    device: {
      ...device,
      area_names,
      statuses,
      forks: forks.map((f) => ({ ...f, maintainer })),
      claims: claims.map(mapClaimRow),
      posts,
    },
  });
}

const PATCHABLE = ['name', 'model', 'soc', 'repo_kind', 'status', 'best_result', 'notes'];

async function handlePatch(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(req);
  const slug = params.slug;
  await loadDevice(slug);
  const body = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of PATCHABLE) {
    if (body[f] === undefined) continue;
    const v = String(body[f]);
    if (f === 'status' && !(STATES as readonly string[]).includes(v)) {
      throw new HttpError(400, 'bad status', `state must be one of: ${STATES.join(' | ')}`);
    }
    if (f === 'repo_kind' && !REPO_KINDS.includes(v)) {
      throw new HttpError(400, 'bad repo_kind', `must be one of: ${REPO_KINDS.join(' | ')}`);
    }
    if (f === 'name' && !v.trim()) throw new HttpError(400, 'name required', 'device name cannot be empty');
    sets.push(`${f} = ?`);
    vals.push(f === 'name' ? v.trim() : v);
  }
  if (!sets.length) {
    throw new HttpError(400, 'nothing to update', `send any of: ${PATCHABLE.join(', ')}`);
  }
  sets.push('updated = ?');
  vals.push(nowIso(), slug);
  await exec(`UPDATE devices SET ${sets.join(', ')} WHERE slug = ?`, vals as never[]);
  const row = await loadDevice(slug);
  await appendChangelog(actorName(user), `device ${slug} updated (${sets.length - 1} field(s))`);
  return json({ device: row });
}

async function handleDelete(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireAdmin(req);
  const slug = params.slug;
  await loadDevice(slug);
  await exec('DELETE FROM device_status WHERE device_slug = ?', [slug]);
  await exec('UPDATE forks SET device_slug = NULL WHERE device_slug = ?', [slug]);
  await exec('DELETE FROM devices WHERE slug = ?', [slug]);
  await appendChangelog(actorName(user), `device ${slug} removed`);
  return json({ deleted: slug });
}

export const Route = createFileRoute('/api/devices/$slug')({
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
