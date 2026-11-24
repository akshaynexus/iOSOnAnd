// /api/status — GET per-area states (?device= ?area= ?state= ?os=, ?limit=
// default 2000, max 5000, ?offset=; public; -> {statuses, total, limit,
// offset, next}). ?os= is ios (the default), macos, tvos or all.
// PUT (or POST) upserts one cell from a body
// {device|device_slug, area|area_slug, state, detail?, source?, os?,
// os_version?}: admin or a maintainer of that device, else 403 with a claim
// hint.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, STATES, json, oneOf, paged, pageParams, readJson, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { osOf, upsertStatus } from '@/lib/status';
import type { DeviceStatus } from '@/lib/types';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const device = q.get('device')?.trim() || null;
  const area = q.get('area')?.trim() || null;
  const state = q.get('state')?.trim() || null;
  if (state) oneOf(STATES, state, 'state');
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
  const osParam = q.get('os')?.trim().toLowerCase() || 'ios';
  if (osParam !== 'all') {
    where.push('ds.os = ?');
    vals.push(osOf(osParam));
  }
  const page = pageParams(q, 2000, 5000);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows, page: info } = await paged<DeviceStatus & { area_name: string }>(
    `SELECT ds.*, a.name AS area_name FROM device_status ds JOIN areas a ON a.slug = ds.area_slug ${w} ORDER BY ds.device_slug, ds.area_slug, ds.os`,
    `SELECT COUNT(*) AS n FROM device_status ds JOIN areas a ON a.slug = ds.area_slug ${w}`,
    vals,
    page,
  );
  return json({ statuses: rows, ...info });
}

async function handleWrite({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const device = str(body, 'device', 64) || str(body, 'device_slug', 64);
  const area = str(body, 'area', 64) || str(body, 'area_slug', 64);
  if (!device) throw new HttpError(400, 'device required', 'send {"device","area","state"} plus optional detail/source');
  if (!area) throw new HttpError(400, 'area required', 'send {"device","area","state"} plus optional detail/source');
  return json({ ok: true, status: await upsertStatus(request, device, area, body) });
}

export const Route = createFileRoute('/api/status')({
  server: { handlers: apiHandlers({ GET: handleGet, PUT: handleWrite, POST: handleWrite }) },
});
