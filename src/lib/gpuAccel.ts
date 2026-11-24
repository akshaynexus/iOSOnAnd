// src/lib/gpuAccel.ts — how a phone's GPU acceleration works and how fast
// (migration 0018, table gpu_accel): the method, the chain of components, the
// measured frames per second, the repos and the source. One row per phone,
// written by its maintainers or an admin (requireDeviceEditor); each write
// adds a changelog line "gpu <device>: <method>, <fps> fps".

import { exec, queryAll, queryFirst } from '@/lib/db';
import { HttpError, actorName, nowIso, oneOf, requireDeviceEditor, str, validSlug } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';

export const GPU_METHODS = ['native-metal', 'metal-vulkan', 'metal-gl', 'gles', 'virtio-gpu', 'cpu', 'other', 'unknown'] as const;
export type GpuMethod = (typeof GPU_METHODS)[number];

export const GPU_METHOD_LABELS: Record<GpuMethod, string> = {
  'native-metal': 'Native Metal driver',
  'metal-vulkan': 'Metal over Vulkan',
  'metal-gl': 'Metal over OpenGL',
  gles: 'OpenGL ES only',
  'virtio-gpu': "Forwarded to Android's GPU",
  cpu: 'CPU rendering',
  other: 'Other',
  unknown: 'Unknown',
};

export interface GpuAccel {
  device_slug: string;
  method: GpuMethod;
  method_label: string;
  stack: string;
  fps_low: number | null;
  fps_high: number | null;
  fps_note: string;
  repos: string[];
  detail: string;
  source: string;
  os_version: string;
  who: string;
  updated: string;
}

type Row = Omit<GpuAccel, 'repos' | 'method_label'> & { repos: string };

function map(r: Row): GpuAccel {
  const method = (GPU_METHODS as readonly string[]).includes(r.method) ? r.method : 'unknown';
  return {
    ...r,
    method,
    method_label: GPU_METHOD_LABELS[method],
    fps_low: r.fps_low ?? null,
    fps_high: r.fps_high ?? null,
    repos: r.repos ? r.repos.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
}

const COLS = 'device_slug, method, stack, fps_low, fps_high, fps_note, repos, detail, source, os_version, who, updated';

export async function getGpuAccel(slug: string): Promise<GpuAccel | null> {
  const r = await queryFirst<Row>(`SELECT ${COLS} FROM gpu_accel WHERE device_slug = ?`, [slug]);
  return r ? map(r) : null;
}

/** The records of several devices at once, by device. */
export async function gpuAccelBySlug(slugs: string[]): Promise<Map<string, GpuAccel>> {
  const out = new Map<string, GpuAccel>();
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    if (!part.length) continue;
    const rows = await queryAll<Row>(`SELECT ${COLS} FROM gpu_accel WHERE device_slug IN (${part.map(() => '?').join(', ')})`, part);
    for (const r of rows) out.set(r.device_slug, map(r));
  }
  return out;
}

function fpsOf(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, `bad ${field}`, `${field} is frames per second, 0 to 1000 (or null)`);
  return Math.round(n * 10) / 10;
}

/** "40-58", "30", "~25" -> [low, high]. */
export function parseFps(s: string): [number | null, number | null] {
  const nums = (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return [null, null];
  return [Math.min(...nums), nums.length > 1 ? Math.max(...nums) : null];
}

/**
 * PUT: set the record {method, stack?, fps_low?, fps_high? (or fps: "40-58"), fps_note?,
 * repos? (array or comma list), detail?, source?, os_version?}. Fields not sent keep
 * their value. -> the record.
 */
export async function setGpuAccel(req: Request, slug: string, body: Record<string, any>): Promise<GpuAccel> {
  if (!validSlug(slug) || !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const user = await requireDeviceEditor(req, slug);
  const cur = await getGpuAccel(slug);
  const has = (k: string) => body[k] !== undefined;
  if (!cur && !has('method')) {
    throw new HttpError(400, 'method required', `send {"method": one of ${GPU_METHODS.join(', ')}} plus stack, fps_low/fps_high (or fps "40-58"), fps_note, repos, detail, source`);
  }
  let [low, high] = [cur?.fps_low ?? null, cur?.fps_high ?? null];
  if (has('fps')) [low, high] = parseFps(String(body.fps ?? ''));
  if (has('fps_low')) low = fpsOf(body.fps_low, 'fps_low');
  if (has('fps_high')) high = fpsOf(body.fps_high, 'fps_high');
  if (low !== null && high !== null && high < low) [low, high] = [high, low];
  const repos = has('repos')
    ? (Array.isArray(body.repos) ? body.repos : String(body.repos ?? '').split(','))
        .map((s: unknown) => String(s).trim())
        .filter(Boolean)
    : cur?.repos ?? [];
  for (const r of repos) if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new HttpError(400, 'bad repo', `repos are OWNER/REPO, got ${JSON.stringify(r)}`);
  const next = {
    method: has('method') ? oneOf(GPU_METHODS, str(body, 'method', 32), 'method') : cur!.method,
    stack: has('stack') ? str(body, 'stack', 500) : cur?.stack ?? '',
    fps_note: has('fps_note') ? str(body, 'fps_note', 300) : cur?.fps_note ?? '',
    detail: has('detail') ? str(body, 'detail', 2000) : cur?.detail ?? '',
    source: has('source') ? str(body, 'source', 500) : cur?.source ?? '',
    os_version: has('os_version') || has('version') ? str(body, has('os_version') ? 'os_version' : 'version', 64) : cur?.os_version ?? '',
  };
  await exec(
    `INSERT INTO gpu_accel (device_slug, method, stack, fps_low, fps_high, fps_note, repos, detail, source, os_version, who, user_id, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_slug) DO UPDATE SET method = excluded.method, stack = excluded.stack, fps_low = excluded.fps_low,
       fps_high = excluded.fps_high, fps_note = excluded.fps_note, repos = excluded.repos, detail = excluded.detail,
       source = excluded.source, os_version = excluded.os_version, who = excluded.who, user_id = excluded.user_id, updated = excluded.updated`,
    [slug, next.method, next.stack, low, high, next.fps_note, repos.slice(0, 20).join(','), next.detail, next.source, next.os_version, actorName(user), user.id ?? null, nowIso()],
  );
  const fps = low !== null ? `, ${low}${high !== null ? `-${high}` : ''} fps${next.fps_note ? ` (${next.fps_note.slice(0, 60)})` : ''}` : '';
  await appendChangelog(actorName(user), `gpu ${slug}: ${GPU_METHOD_LABELS[next.method]}${fps}`);
  return (await getGpuAccel(slug))!;
}

/** DELETE the record. */
export async function deleteGpuAccel(req: Request, slug: string): Promise<void> {
  await requireDeviceEditor(req, slug);
  if (!(await getGpuAccel(slug))) throw new HttpError(404, 'no gpu record', `PUT /api/devices/${slug}/gpu to add one`);
  await exec('DELETE FROM gpu_accel WHERE device_slug = ?', [slug]);
}

/* ------------------------------------------------------------------ */
/* GPU issues (migration 0020)                                         */
/* ------------------------------------------------------------------ */

export const GPU_ISSUE_KINDS = ['white-widgets', 'black-ui', 'gpu-fault', 'out-of-memory', 'artifacts', 'slow', 'crash', 'other'] as const;
export const GPU_ISSUE_STATES = ['open', 'workaround', 'fixed'] as const;

export const GPU_ISSUE_LABELS: Record<(typeof GPU_ISSUE_KINDS)[number], string> = {
  'white-widgets': 'White widgets or snapshots',
  'black-ui': 'Black widgets, blurs or UI',
  'gpu-fault': 'GPU fault or hang',
  'out-of-memory': 'Out of GPU memory',
  artifacts: 'Tearing or corruption',
  slow: 'Slow rendering',
  crash: 'Renderer crash',
  other: 'Other',
};

export interface GpuIssue {
  id: number;
  device_slug: string;
  kind: (typeof GPU_ISSUE_KINDS)[number];
  kind_label: string;
  state: (typeof GPU_ISSUE_STATES)[number];
  title: string;
  cause: string;
  fix: string;
  detail: string;
  source: string;
  os_version: string;
  who: string;
  created: string;
  updated: string;
}

const ISSUE_COLS = 'id, device_slug, kind, state, title, cause, fix, detail, source, os_version, who, created, updated';
const ISSUE_ORDER = "ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'workaround' THEN 1 ELSE 2 END, updated DESC";

function mapIssue(r: Omit<GpuIssue, 'kind_label'>): GpuIssue {
  const kind = (GPU_ISSUE_KINDS as readonly string[]).includes(r.kind) ? r.kind : 'other';
  return { ...r, kind, kind_label: GPU_ISSUE_LABELS[kind] };
}

/** Issues of several devices at once, by device (for device details). */
export async function gpuIssuesBySlug(slugs: string[]): Promise<Map<string, GpuIssue[]>> {
  const out = new Map<string, GpuIssue[]>();
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    if (!part.length) continue;
    const rows = await queryAll<Omit<GpuIssue, 'kind_label'>>(`SELECT ${ISSUE_COLS} FROM gpu_issues WHERE device_slug IN (${part.map(() => '?').join(', ')}) ${ISSUE_ORDER}`, part);
    for (const r of rows) (out.get(r.device_slug) ?? out.set(r.device_slug, []).get(r.device_slug)!).push(mapIssue(r));
  }
  return out;
}

/** Every phone's issues, filtered (?kind, ?state, ?device, ?q in the title, cause and fix), newest first. */
export async function listGpuIssues(f: { kind?: string; state?: string; device?: string; q?: string }): Promise<GpuIssue[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (f.kind) (where.push('kind = ?'), vals.push(oneOf(GPU_ISSUE_KINDS, f.kind, 'kind')));
  if (f.state) (where.push('state = ?'), vals.push(oneOf(GPU_ISSUE_STATES, f.state, 'state')));
  if (f.device) (where.push('device_slug = ?'), vals.push(f.device));
  if (f.q) {
    where.push('(lower(title) LIKE ? OR lower(cause) LIKE ? OR lower(fix) LIKE ? OR lower(detail) LIKE ?)');
    const like = `%${f.q.toLowerCase()}%`;
    vals.push(like, like, like, like);
  }
  const rows = await queryAll<Omit<GpuIssue, 'kind_label'>>(
    `SELECT ${ISSUE_COLS} FROM gpu_issues ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated DESC LIMIT 500`,
    vals,
  );
  return rows.map(mapIssue);
}

async function deviceOk(slug: string): Promise<void> {
  if (!validSlug(slug) || !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
}

async function ownIssue(slug: string, id: string): Promise<GpuIssue> {
  const r = await queryFirst<Omit<GpuIssue, 'kind_label'>>(`SELECT ${ISSUE_COLS} FROM gpu_issues WHERE id = ? AND device_slug = ?`, [Number(id) || 0, slug]);
  if (!r) throw new HttpError(404, 'unknown gpu issue', `GET /api/devices/${slug}/gpu/issues for its issues`);
  return mapIssue(r);
}

/** POST {title, kind?, state?, cause?, fix?, detail?, source?, os_version?}. */
export async function addGpuIssue(req: Request, slug: string, body: Record<string, any>): Promise<GpuIssue> {
  await deviceOk(slug);
  const user = await requireDeviceEditor(req, slug);
  const title = str(body, 'title', 200);
  if (!title) throw new HttpError(400, 'title required', 'send {"title": "<the symptom>", "kind": "white-widgets", "state": "open", "cause": "...", "source": "..."}');
  const now = nowIso();
  const r = await queryFirst<{ id: number }>(
    `INSERT INTO gpu_issues (device_slug, kind, state, title, cause, fix, detail, source, os_version, who, user_id, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      slug,
      oneOf(GPU_ISSUE_KINDS, str(body, 'kind', 32) || 'other', 'kind'),
      oneOf(GPU_ISSUE_STATES, str(body, 'state', 16) || 'open', 'state'),
      title,
      str(body, 'cause', 1000),
      str(body, 'fix', 1000),
      str(body, 'detail', 2000),
      str(body, 'source', 500),
      str(body, 'os_version', 64) || str(body, 'version', 64),
      actorName(user),
      user.id ?? null,
      now,
      now,
    ],
  );
  const issue = await ownIssue(slug, String(r!.id));
  await appendChangelog(actorName(user), `gpu issue ${slug} #${issue.id}: ${issue.kind_label} (${issue.state}): ${title.slice(0, 120)}`);
  return issue;
}

/** PATCH any of the fields; fields not sent keep their value. */
export async function updateGpuIssue(req: Request, slug: string, id: string, body: Record<string, any>): Promise<GpuIssue> {
  await deviceOk(slug);
  const user = await requireDeviceEditor(req, slug);
  const cur = await ownIssue(slug, id);
  const has = (k: string) => body[k] !== undefined;
  const next = {
    kind: has('kind') ? oneOf(GPU_ISSUE_KINDS, str(body, 'kind', 32), 'kind') : cur.kind,
    state: has('state') ? oneOf(GPU_ISSUE_STATES, str(body, 'state', 16), 'state') : cur.state,
    title: has('title') ? str(body, 'title', 200) || cur.title : cur.title,
    cause: has('cause') ? str(body, 'cause', 1000) : cur.cause,
    fix: has('fix') ? str(body, 'fix', 1000) : cur.fix,
    detail: has('detail') ? str(body, 'detail', 2000) : cur.detail,
    source: has('source') ? str(body, 'source', 500) : cur.source,
    os_version: has('os_version') || has('version') ? str(body, has('os_version') ? 'os_version' : 'version', 64) : cur.os_version,
  };
  await exec(
    'UPDATE gpu_issues SET kind = ?, state = ?, title = ?, cause = ?, fix = ?, detail = ?, source = ?, os_version = ?, who = ?, user_id = ?, updated = ? WHERE id = ?',
    [next.kind, next.state, next.title, next.cause, next.fix, next.detail, next.source, next.os_version, actorName(user), user.id ?? null, nowIso(), cur.id],
  );
  if (next.state !== cur.state) await appendChangelog(actorName(user), `gpu issue ${slug} #${cur.id}: ${cur.state} -> ${next.state}${next.fix ? `: ${next.fix.slice(0, 120)}` : ''}`);
  return ownIssue(slug, id);
}

export async function deleteGpuIssue(req: Request, slug: string, id: string): Promise<void> {
  await deviceOk(slug);
  const user = await requireDeviceEditor(req, slug);
  const cur = await ownIssue(slug, id);
  await exec('DELETE FROM gpu_issues WHERE id = ?', [cur.id]);
  await appendChangelog(actorName(user), `gpu issue ${slug} #${cur.id} removed`);
}
