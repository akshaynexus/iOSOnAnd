// /api/status/$device/$area — GET one cell, PUT upsert it (auth).
// PUT body {state, detail?, source?}. 404 on unknown device/area.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
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

type Ctx = { request: Request; params: Record<string, string> };

async function handleGet(_req: Request, params: Record<string, string>): Promise<Response> {
  const row = await queryFirst<DeviceStatus>(
    'SELECT * FROM device_status WHERE device_slug = ? AND area_slug = ?',
    [params.device, params.area],
  );
  if (!row) throw new HttpError(404, 'no status recorded', 'PUT to this URL to record one');
  return json({ status: row });
}

async function handlePut(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(req);
  const { device, area } = params;
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [device]))) {
    throw new HttpError(404, 'unknown device', 'POST /api/devices to add it first');
  }
  if (!(await queryFirst('SELECT slug FROM areas WHERE slug = ?', [area]))) {
    throw new HttpError(404, 'unknown area', 'GET /api/areas for the 24 valid area slugs');
  }
  const body = await readJson(req);
  const state = String(body.state || body.status || '');
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
  return json({ status: row });
}

export const Route = createFileRoute('/api/status/$device/$area')({
  server: {
    handlers: {
  GET: async ({ request, params }: Ctx) => {
    try {
      return await handleGet(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
  PUT: async ({ request, params }: Ctx) => {
    try {
      return await handlePut(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
