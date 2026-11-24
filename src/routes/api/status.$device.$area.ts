// /api/status/$device/$area — GET one cell (public; ?os= ios, the default,
// macos or tvos); PUT (or POST, an alias) upserts it. Writes: admin or a
// maintainer of $device (approved claim), else 403 with a claim hint. Body
// {state, detail?, source?, os?, os_version?}; ?os= works for writes too.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { osOf, upsertStatus } from '@/lib/status';
import type { DeviceStatus } from '@/lib/types';

async function handleGet({ request, params }: ApiCtx): Promise<Response> {
  const os = osOf(new URL(request.url).searchParams.get('os'));
  const row = await queryFirst<DeviceStatus>('SELECT * FROM device_status WHERE device_slug = ? AND area_slug = ? AND os = ?', [
    params.device,
    params.area,
    os,
  ]);
  if (!row) throw new HttpError(404, 'no status recorded', 'PUT to this URL to record one');
  return json({ status: row });
}

async function handleWrite({ request, params }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const os = new URL(request.url).searchParams.get('os');
  if (os && body.os === undefined) body.os = os;
  return json({ ok: true, status: await upsertStatus(request, params.device, params.area, body) });
}

export const Route = createFileRoute('/api/status/$device/$area')({
  server: { handlers: apiHandlers({ GET: handleGet, PUT: handleWrite, POST: handleWrite }) },
});
