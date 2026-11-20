// GET /api/status — list per-area states (?device= ?area= ?state=).
// PUT /api/status — upsert one cell from a JSON body (CLI status-set + UI shape).
// Body {device|device_slug, area|area_slug, state, detail?, source?} -> {ok, status}.

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
  requireUser,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { DeviceStatus } from '@/lib/types';

async function handleGet(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const device = q.get('device')?.trim() || null;
  const area = q.get('area')?.trim() || null;
  const state = q.get('state')?.trim() || null;
  if (state && !(STATES as readonly string[]).includes(state)) {
    throw new HttpError(400, 'bad state', `state must be one of: ${STATES.join(' | ')}`);
  }
  const where: string[] = [];
  const vals: string[] = [];
  if (device) {
    where.push('ds.device_slug = ?');
    vals.push(device);
  }
  if (area) {
    where.push('ds.area_slug = ?');
    vals.push(area);
  }
  if (state) {
    where.push('ds.state = ?');
    vals.push(state);
  }
  const rows = await queryAll<DeviceStatus & { area_name: string }>(
    `SELECT ds.*, a.name AS area_name FROM device_status ds
     JOIN areas a ON a.slug = ds.area_slug
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ds.device_slug, ds.area_slug LIMIT 500`,
    vals,
  );
  return json({ statuses: rows });
}

async function handlePut(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const device = String(body.device || body.device_slug || '').trim();
  const area = String(body.area || body.area_slug || '').trim();
  const state = String(body.state || body.status || '');
  if (!device) throw new HttpError(400, 'device required', 'send {"device","area","state"} plus optional detail/source');
  if (!area) throw new HttpError(400, 'area required', 'send {"device","area","state"} plus optional detail/source');
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [device]))) {
    throw new HttpError(404, 'unknown device', 'POST /api/devices to add it first');
  }
  if (!(await queryFirst('SELECT slug FROM areas WHERE slug = ?', [area]))) {
    throw new HttpError(404, 'unknown area', 'GET /api/areas for the valid area slugs');
  }
  if (!(STATES as readonly string[]).includes(state)) {
    throw new HttpError(400, 'bad state', `state must be one of: ${STATES.join(' | ')}`);
  }
  const detail = String(body.detail || '');
  const source = String(body.source || '');
  await exec(
    `INSERT INTO device_status (device_slug, area_slug, state, detail, source, updated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_slug, area_slug) DO UPDATE SET
       state = excluded.state, detail = excluded.detail,
       source = excluded.source, updated = excluded.updated`,
    [device, area, state, detail, source, nowIso()],
  );
  const row = await queryFirst<DeviceStatus>(
    'SELECT * FROM device_status WHERE device_slug = ? AND area_slug = ?',
    [device, area],
  );
  await appendChangelog(actorName(user), `status ${device}/${area} -> ${state}${detail ? `: ${detail}` : ''}`);
  return json({ ok: true, status: row });
}

export const Route = createFileRoute('/api/status')({
  server: {
    handlers: {
  GET: async ({ request }: { request: Request }) => {
    try {
      return await handleGet(request);
    } catch (e) {
      return handleError(e);
    }
  },
  PUT: async ({ request }: { request: Request }) => {
    try {
      return await handlePut(request);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
