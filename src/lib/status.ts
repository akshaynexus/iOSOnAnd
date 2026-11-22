// src/lib/status.ts — the one device_status upsert both status routes use.
// Order of checks: 401 anonymous, 404 unknown device, 403 not an editor of
// that device (or a token without status:write), 404 unknown area, 400 area
// not applicable (an area with scope 'oneios' on a device whose base is not
// 'oneios'), 400 bad state / field.

import { queryFirst } from '@/lib/db';
import { HttpError, STATES, actorName, nowIso, oneOf, requireDeviceEditor, str, validSlug } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { DeviceStatus } from '@/lib/types';

export async function upsertStatus(
  req: Request,
  device: string,
  area: string,
  body: Record<string, any>,
): Promise<DeviceStatus> {
  if (!validSlug(device)) throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  const user = await requireDeviceEditor(req, device);
  const a = validSlug(area) ? await queryFirst<{ scope: string }>('SELECT scope FROM areas WHERE slug = ?', [area]) : null;
  if (!a) throw new HttpError(404, 'unknown area', 'GET /api/areas for the valid area slugs');
  if (a.scope === 'oneios') {
    const d = await queryFirst<{ base: string }>('SELECT base FROM devices WHERE slug = ?', [device]);
    if (d?.base !== 'oneios') throw new HttpError(400, 'area not applicable', `${area} only applies to OneiOS-based ports`);
  }
  const state = oneOf(STATES, str(body, 'state', 32) || str(body, 'status', 32), 'state');
  const detail = str(body, 'detail', 2000);
  const source = str(body, 'source', 500);
  const row = await queryFirst<DeviceStatus>(
    `INSERT INTO device_status (device_slug, area_slug, state, detail, source, updated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_slug, area_slug) DO UPDATE SET
       state = excluded.state, detail = excluded.detail,
       source = excluded.source, updated = excluded.updated
     RETURNING *`,
    [device, area, state, detail, source, nowIso()],
  );
  if (!row) throw new HttpError(500, 'status write failed', 'retry');
  await appendChangelog(actorName(user), `status ${device}/${area} -> ${state}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  return row;
}

