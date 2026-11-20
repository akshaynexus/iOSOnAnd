// /api/forks/$id — GET one, PATCH update (auth), DELETE remove (admin).

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  handleError,
  json,
  nowIso,
  readJson,
  requireAdmin,
  requireUser,
} from '@/lib/auth';
import { VERIFIED } from '@/routes/api/forks';
import { appendChangelog } from '@/lib/changelog';
import type { Fork } from '@/lib/types';

type Ctx = { request: Request; params: Record<string, string> };

async function loadFork(id: string): Promise<Fork> {
  if (!/^\d+$/.test(id)) throw new HttpError(404, 'unknown fork', 'fork ids are numeric');
  const row = await queryFirst<Fork>('SELECT * FROM forks WHERE id = ?', [Number(id)]);
  if (!row) throw new HttpError(404, 'unknown fork', 'GET /api/forks to list known forks');
  return row;
}

async function handleGet(_req: Request, params: Record<string, string>): Promise<Response> {
  return json({ fork: await loadFork(params.id) });
}

const PATCHABLE = ['device_slug', 'branch', 'url', 'best_result', 'ported', 'fork_only', 'verified', 'notes'];

async function handlePatch(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(req);
  const fork = await loadFork(params.id);
  const body = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of PATCHABLE) {
    if (body[f] === undefined) continue;
    if (f === 'verified' && !VERIFIED.includes(String(body[f]))) {
      throw new HttpError(400, 'bad verified', `must be one of: ${VERIFIED.join(' | ')}`);
    }
    if (f === 'url' && body[f] && !/^https?:\/\//.test(String(body[f]))) {
      throw new HttpError(400, 'bad url', 'url must start with http(s)://');
    }
    if (f === 'device_slug' && body[f]) {
      const ds = String(body[f]).trim();
      if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [ds]))) {
        throw new HttpError(404, 'unknown device', 'POST /api/devices to add it first, or null to detach');
      }
      sets.push('device_slug = ?');
      vals.push(ds);
      continue;
    }
    sets.push(`${f} = ?`);
    vals.push(body[f] === null ? null : String(body[f]));
  }
  if (!sets.length) {
    throw new HttpError(400, 'nothing to update', `send any of: ${PATCHABLE.join(', ')}`);
  }
  sets.push('updated = ?');
  vals.push(nowIso(), fork.id);
  await exec(`UPDATE forks SET ${sets.join(', ')} WHERE id = ?`, vals as never[]);
  const row = await loadFork(params.id);
  await appendChangelog(actorName(user), `fork ${row.repo} updated`);
  return json({ fork: row });
}

async function handleDelete(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireAdmin(req);
  const fork = await loadFork(params.id);
  await exec('DELETE FROM forks WHERE id = ?', [fork.id]);
  await appendChangelog(actorName(user), `fork ${fork.repo} removed`);
  return json({ deleted: fork.id });
}

export const Route = createFileRoute('/api/forks/$id')({
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
