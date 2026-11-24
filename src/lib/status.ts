// src/lib/status.ts — the one device_status upsert both status routes use.
// Order of checks: 401 anonymous, 404 unknown device, 403 not an editor of
// that device (or a token without status:write), 404 unknown area, 400 area
// not applicable (an area with scope 'oneios' on a device whose base is not
// 'oneios'), 400 bad state / field.
//
// A status is about one system (`os`: ios, the default, which also covers
// iPadOS; macos; tvos), with the version the evidence was seen on
// (`os_version`, alias `version`). Every write adds a status_history row with
// the state before and after, and a changelog line. The device's version field
// for that system (ios_version, macos_version, tvos_version) is filled from
// `os_version` when it is still empty.

import { exec, queryFirst } from '@/lib/db';
import { HttpError, OSES, OS_LABELS, OS_VERSION_FIELD, STATES, actorName, nowIso, oneOf, requireDeviceEditor, str, validSlug, type Os } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { DeviceStatus } from '@/lib/types';

/** The system a request names: ios (default; ipados and iphoneos count as ios), macos or tvos. */
export function osOf(raw: string | null | undefined): Os {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v || v === 'ipados' || v === 'iphoneos') return 'ios';
  return oneOf(OSES, v, 'os');
}

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
  const os = osOf(str(body, 'os', 16));
  const osVersion = str(body, 'os_version', 64) || str(body, 'version', 64);
  const before = await queryFirst<{ state: string }>('SELECT state FROM device_status WHERE device_slug = ? AND area_slug = ? AND os = ?', [device, area, os]);
  const now = nowIso();
  const row = await queryFirst<DeviceStatus>(
    `INSERT INTO device_status (device_slug, area_slug, os, os_version, state, detail, source, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_slug, area_slug, os) DO UPDATE SET
       state = excluded.state, detail = excluded.detail, source = excluded.source,
       os_version = CASE WHEN excluded.os_version <> '' THEN excluded.os_version ELSE device_status.os_version END,
       updated = excluded.updated
     RETURNING *`,
    [device, area, os, osVersion, state, detail, source, now],
  );
  if (!row) throw new HttpError(500, 'status write failed', 'retry');
  const hist = await queryFirst<{ id: number }>(
    `INSERT INTO status_history (device_slug, area_slug, os, os_version, old_state, state, detail, source, who, user_id, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [device, area, os, row.os_version ?? '', before?.state ?? null, state, detail, source, actorName(user), user.id ?? null, now],
  );
  if (osVersion) {
    const field = OS_VERSION_FIELD[os];
    await exec(`UPDATE devices SET ${field} = ? WHERE slug = ? AND ${field} = ''`, [osVersion, device]);
  }
  const tag = os === 'ios' ? (osVersion ? `[${osVersion}] ` : '') : `[${osVersion || OS_LABELS[os]}] `;
  await appendChangelog(actorName(user), `status ${device}/${area} -> ${state}${detail || tag ? `: ${tag}${detail.slice(0, 200)}` : ''}`);
  // history_id: link photos to this change (POST /api/media history_id, CLI status-set --photo).
  return { ...row, history_id: hist?.id };
}
