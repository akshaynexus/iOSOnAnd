// src/lib/features.ts — a phone's other notable features (migration 0014):
// what a port has that the checklist does not list, or uncommon hardware
// that works. Each has a name, the system it is on (os), a state, what was
// seen (detail) and the source, like a status row. Written by the phone's
// maintainers or an admin (requireDeviceEditor); each write adds a changelog
// line "feature <device>: <name> -> <state>: <detail>".

import { exec, queryAll, queryFirst } from '@/lib/db';
import { HttpError, STATES, actorName, nowIso, oneOf, requireDeviceEditor, str, validSlug } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import { osOf } from '@/lib/status';
import { mediaByLink, type Media } from '@/lib/media';

export interface DeviceFeature {
  id: number;
  device_slug: string;
  name: string;
  os: string;
  state: string;
  detail: string;
  source: string;
  who: string;
  created: string;
  updated: string;
  /** Photos and clips linked to it (media.feature_id, migration 0015). */
  media?: Media[];
}

/** Each feature with the uploads linked to it. */
async function withMedia(rows: DeviceFeature[]): Promise<DeviceFeature[]> {
  if (!rows.length) return rows;
  const m = await mediaByLink('feature_id', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, media: m.get(r.id) ?? [] }));
}

const COLS = 'id, device_slug, name, os, state, detail, source, who, created, updated';

export async function listFeatures(slug: string): Promise<DeviceFeature[]> {
  return withMedia(await queryAll<DeviceFeature>(`SELECT ${COLS} FROM device_features WHERE device_slug = ? ORDER BY CASE state WHEN 'works' THEN 0 WHEN 'in-progress' THEN 1 WHEN 'broken' THEN 2 ELSE 3 END, name COLLATE NOCASE`, [slug]));
}

/** Features of several devices at once, by device. */
export async function featuresBySlug(slugs: string[]): Promise<Map<string, DeviceFeature[]>> {
  const out = new Map<string, DeviceFeature[]>();
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    const rows = await queryAll<DeviceFeature>(
      `SELECT ${COLS} FROM device_features WHERE device_slug IN (${part.map(() => '?').join(', ')}) ORDER BY name COLLATE NOCASE`,
      part,
    ).then(withMedia);
    for (const r of rows) (out.get(r.device_slug) ?? out.set(r.device_slug, []).get(r.device_slug)!).push(r);
  }
  return out;
}

async function deviceExists(slug: string): Promise<void> {
  if (!validSlug(slug) || !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
}

const log = (who: string, slug: string, f: Pick<DeviceFeature, 'name' | 'state' | 'detail' | 'os'>, verb = '->') =>
  appendChangelog(who, `feature ${slug}: ${f.name} ${verb} ${f.state}${f.detail ? `: ${f.os !== 'ios' ? `[${f.os}] ` : ''}${f.detail.slice(0, 200)}` : ''}`);

/** POST: add one {name, state, detail?, source?, os?}; a second feature with the same name and system is 409. */
export async function addFeature(req: Request, slug: string, body: Record<string, any>): Promise<DeviceFeature> {
  await deviceExists(slug);
  const user = await requireDeviceEditor(req, slug);
  const name = str(body, 'name', 120);
  if (!name) throw new HttpError(400, 'name required', 'send {"name","state"} plus optional detail, source, os, e.g. {"name":"IR blaster","state":"works"}');
  const state = oneOf(STATES, str(body, 'state', 32) || 'works', 'state');
  const os = osOf(str(body, 'os', 16));
  const dup = await queryFirst<{ id: number }>('SELECT id FROM device_features WHERE device_slug = ? AND os = ? AND lower(name) = lower(?)', [slug, os, name]);
  if (dup) throw new HttpError(409, 'feature exists', `PATCH /api/devices/${slug}/features/${dup.id} to change it`);
  const now = nowIso();
  const row = await queryFirst<DeviceFeature>(
    `INSERT INTO device_features (device_slug, name, os, state, detail, source, who, user_id, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
    [slug, name, os, state, str(body, 'detail', 2000), str(body, 'source', 500), actorName(user), user.id ?? null, now, now],
  );
  if (!row) throw new HttpError(500, 'feature write failed', 'retry');
  await log(actorName(user), slug, row);
  return row;
}

async function own(slug: string, id: string): Promise<DeviceFeature> {
  const row = await queryFirst<DeviceFeature>(`SELECT ${COLS} FROM device_features WHERE id = ? AND device_slug = ?`, [Number(id) || 0, slug]);
  if (!row) throw new HttpError(404, 'unknown feature', `GET /api/devices/${slug}/features for its features`);
  return row;
}

/** PATCH: change {name?, state?, detail?, source?, os?}. */
export async function updateFeature(req: Request, slug: string, id: string, body: Record<string, any>): Promise<DeviceFeature> {
  await deviceExists(slug);
  const user = await requireDeviceEditor(req, slug);
  const cur = await own(slug, id);
  const next = {
    name: body.name !== undefined ? str(body, 'name', 120) || cur.name : cur.name,
    state: body.state !== undefined ? oneOf(STATES, str(body, 'state', 32), 'state') : cur.state,
    detail: body.detail !== undefined ? str(body, 'detail', 2000) : cur.detail,
    source: body.source !== undefined ? str(body, 'source', 500) : cur.source,
    os: body.os !== undefined ? osOf(str(body, 'os', 16)) : cur.os,
  };
  const row = await queryFirst<DeviceFeature>(
    `UPDATE device_features SET name = ?, state = ?, detail = ?, source = ?, os = ?, who = ?, user_id = ?, updated = ? WHERE id = ? RETURNING ${COLS}`,
    [next.name, next.state, next.detail, next.source, next.os, actorName(user), user.id ?? null, nowIso(), cur.id],
  );
  if (!row) throw new HttpError(500, 'feature write failed', 'retry');
  await log(actorName(user), slug, row);
  return row;
}

/** DELETE one. */
export async function deleteFeature(req: Request, slug: string, id: string): Promise<void> {
  await deviceExists(slug);
  const user = await requireDeviceEditor(req, slug);
  const cur = await own(slug, id);
  await exec('UPDATE media SET feature_id = NULL WHERE feature_id = ?', [cur.id]); // the uploads stay on the device
  await exec('DELETE FROM device_features WHERE id = ?', [cur.id]);
  await appendChangelog(actorName(user), `feature ${slug}: ${cur.name} removed`);
}
