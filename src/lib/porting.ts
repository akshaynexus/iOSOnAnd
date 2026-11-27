// src/lib/porting.ts — porting records and components (migration 0019),
// imported from a porting framework's own records: UniXNU's
// docs/.vitepress/device-records/*.toml and components.toml (what
// unixnu.com/devices shows). A record is one port repo's state per area
// (device-verified, host-verified, implemented, planned), with the components
// it uses, its limits, next step, build/boot procedure and first evidence; a
// component is a driver or tool with the hardware it drives and the boards
// that use it. Read by everyone; written only by an admin import.

import { exec, queryAll, queryFirst } from '@/lib/db';
import { HttpError, nowIso } from '@/lib/auth';

export const AREA_STATUSES = ['device-verified', 'host-verified', 'implemented', 'planned', 'not-applicable'] as const;

export interface PortingArea {
  id: string;
  status: string;
  components: string[];
  completion: string[];
  limits: string[];
  next_action: string[];
  procedure: string[];
  evidence: Array<{ kind: string; reference: string; result: string }>;
}

export interface PortingRecordSummary {
  key: string;
  framework: string;
  record: string;
  codename: string;
  repo: string;
  device_slug: string | null;
  title: string;
  soc: string;
  os_profile: string;
  summary: string;
  counts: { device_verified: number; host_verified: number; implemented: number; planned: number };
  /** Each area's status, e.g. {gpu: "device-verified", network: "planned"}. */
  area_status: Record<string, string>;
  page_url: string;
  source_url: string;
  imported: string;
}

export interface PortingRecord extends PortingRecordSummary {
  areas: PortingArea[];
  components: string[];
}

interface Row {
  key: string;
  framework: string;
  record: string;
  codename: string;
  repo: string;
  device_slug: string | null;
  title: string;
  soc: string;
  os_profile: string;
  summary: string;
  areas: string;
  components: string;
  n_device: number;
  n_host: number;
  n_impl: number;
  n_planned: number;
  page_url: string;
  source_url: string;
  imported: string;
}

function parseAreas(s: string): PortingArea[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function summaryOf(r: Row): PortingRecordSummary {
  const areas = parseAreas(r.areas);
  return {
    key: r.key,
    framework: r.framework,
    record: r.record,
    codename: r.codename,
    repo: r.repo,
    device_slug: r.device_slug,
    title: r.title,
    soc: r.soc,
    os_profile: r.os_profile,
    summary: r.summary,
    counts: { device_verified: r.n_device, host_verified: r.n_host, implemented: r.n_impl, planned: r.n_planned },
    area_status: Object.fromEntries(areas.map((a) => [a.id, a.status])),
    page_url: r.page_url,
    source_url: r.source_url,
    imported: r.imported,
  };
}

function fullOf(r: Row): PortingRecord {
  return { ...summaryOf(r), areas: parseAreas(r.areas), components: r.components.split(',').filter(Boolean) };
}

const ORDER = 'ORDER BY n_device DESC, n_host DESC, n_impl DESC, repo';

export interface PortingQuery {
  device?: string;
  repo?: string;
  codename?: string;
  component?: string;
  framework?: string;
  /** With `status`: only records whose area has that status. */
  area?: string;
  status?: string;
}

/** Records matching the filters, best-verified first. `area` + `status` filter on one area's status. */
export async function listPorting(q: PortingQuery, limit: number, offset: number): Promise<{ rows: PortingRecordSummary[]; total: number }> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (q.device) (where.push('device_slug = ?'), vals.push(q.device));
  if (q.repo) (where.push('lower(repo) = lower(?)'), vals.push(q.repo));
  if (q.codename) (where.push('lower(codename) = lower(?)'), vals.push(q.codename));
  if (q.framework) (where.push('lower(framework) = lower(?)'), vals.push(q.framework));
  if (q.component) (where.push("lower(components) LIKE lower(?) ESCAPE '\\'"), vals.push(`%,${q.component.replace(/[\\%_]/g, (c) => `\\${c}`)},%`));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  let rows = (await queryAll<Row>(`SELECT * FROM porting_records ${w} ${ORDER}`, vals)).map(summaryOf);
  if (q.area) {
    const status = q.status;
    rows = rows.filter((r) => (status ? r.area_status[q.area!] === status : q.area! in r.area_status));
  } else if (q.status) {
    rows = rows.filter((r) => Object.values(r.area_status).includes(q.status!));
  }
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

export async function getPorting(key: string): Promise<PortingRecord> {
  const r = await queryFirst<Row>('SELECT * FROM porting_records WHERE key = ? OR record = ?', [key, key]);
  if (!r) throw new HttpError(404, 'unknown porting record', 'GET /api/porting?device=<slug> lists the records');
  return fullOf(r);
}

/** Record summaries of several devices at once, by device (for device details). */
export async function portingBySlug(slugs: string[]): Promise<Map<string, PortingRecordSummary[]>> {
  const out = new Map<string, PortingRecordSummary[]>();
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    if (!part.length) continue;
    const rows = await queryAll<Row>(`SELECT * FROM porting_records WHERE device_slug IN (${part.map(() => '?').join(', ')}) ${ORDER}`, part);
    for (const r of rows) (out.get(r.device_slug!) ?? out.set(r.device_slug!, []).get(r.device_slug!)!).push(summaryOf(r));
  }
  return out;
}

const s = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => s(x, max));

/** Admin import: upsert records {framework, record, codename, repo?, device_slug?, title?, soc?, os_profile?, summary?, areas[], page_url?, source_url?}. */
export async function importPorting(records: Array<Record<string, any>>): Promise<number> {
  const now = nowIso();
  let n = 0;
  for (const r of records) {
    const framework = s(r.framework, 32).trim();
    const record = s(r.record, 120).trim();
    if (!framework || !record) throw new HttpError(400, 'framework and record required', 'each record needs {framework, record, areas}');
    const areas: PortingArea[] = (Array.isArray(r.areas) ? r.areas : []).slice(0, 80).map((a: any) => ({
      id: s(a.id, 64),
      status: s(a.status, 32),
      components: list(a.components, 30, 80),
      completion: list(a.completion, 3, 600),
      limits: list(a.limits, 3, 600),
      next_action: list(a.next_action, 2, 600),
      procedure: list(a.procedure, 8, 300),
      evidence: (Array.isArray(a.evidence) ? a.evidence : []).slice(0, 3).map((e: any) => ({ kind: s(e?.kind, 32), reference: s(e?.reference, 300), result: s(e?.result, 400) })),
    }));
    const count = (st: string) => areas.filter((a) => a.status === st).length;
    const comps = [...new Set(areas.flatMap((a) => a.components))];
    const repo = s(r.repo, 140).trim();
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(400, 'bad repo', `repo is OWNER/REPO, got ${JSON.stringify(repo)}`);
    let device: string | null = s(r.device_slug, 64).trim() || null;
    if (device && !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [device]))) device = null;
    await exec(
      `INSERT INTO porting_records (key, framework, record, codename, repo, device_slug, title, soc, os_profile, summary, areas, components,
         n_device, n_host, n_impl, n_planned, page_url, source_url, imported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET codename = excluded.codename, repo = excluded.repo, device_slug = excluded.device_slug,
         title = excluded.title, soc = excluded.soc, os_profile = excluded.os_profile, summary = excluded.summary, areas = excluded.areas,
         components = excluded.components, n_device = excluded.n_device, n_host = excluded.n_host, n_impl = excluded.n_impl,
         n_planned = excluded.n_planned, page_url = excluded.page_url, source_url = excluded.source_url, imported = excluded.imported`,
      [
        `${framework.toLowerCase()}:${record}`,
        framework,
        record,
        s(r.codename, 64),
        repo,
        device,
        s(r.title, 200),
        s(r.soc, 64),
        s(r.os_profile, 80),
        s(r.summary, 1500),
        JSON.stringify(areas),
        comps.length ? `,${comps.join(',')},` : '',
        count('device-verified'),
        count('host-verified'),
        count('implemented'),
        count('planned'),
        s(r.page_url, 300),
        s(r.source_url, 300),
        now,
      ],
    );
    n++;
  }
  return n;
}

export interface PortingComponent {
  framework: string;
  id: string;
  kind: string;
  function: string;
  hardware: string[];
  repository: string;
  scope: string;
  build_stage: string;
  dependencies: string[];
  os_abi: string[];
  verified_devices: string[];
  source_url: string;
  /** The records that use it, with that area's status: who to learn from. */
  used_by: Array<{ key: string; repo: string; device_slug: string | null; codename: string; area: string; status: string }>;
}

const parseList = (v: string) => {
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
};

/** Components (?q matches id, function and hardware), each with the records that use it. */
export async function listComponents(q: string, framework?: string): Promise<PortingComponent[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (framework) (where.push('lower(framework) = lower(?)'), vals.push(framework));
  if (q) {
    where.push('(lower(id) LIKE ? OR lower(function) LIKE ? OR lower(hardware) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    vals.push(like, like, like);
  }
  const rows = await queryAll<Record<string, string>>(`SELECT * FROM porting_components ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY kind, id`, vals);
  const recs = await queryAll<Row>("SELECT key, repo, device_slug, codename, areas, components FROM porting_records WHERE components <> ''");
  return rows.map((c) => {
    const used: PortingComponent['used_by'] = [];
    for (const r of recs) {
      if (!r.components.toLowerCase().includes(`,${c.id.toLowerCase()},`)) continue;
      for (const a of parseAreas(r.areas)) {
        if (a.components.some((x) => x.toLowerCase() === c.id.toLowerCase())) {
          used.push({ key: r.key, repo: r.repo, device_slug: r.device_slug, codename: r.codename, area: a.id, status: a.status });
        }
      }
    }
    const rank: Record<string, number> = { 'device-verified': 0, 'host-verified': 1, implemented: 2, planned: 3 };
    used.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.repo.localeCompare(b.repo));
    return {
      framework: c.framework,
      id: c.id,
      kind: c.kind,
      function: c.function,
      hardware: parseList(c.hardware),
      repository: c.repository,
      scope: c.scope,
      build_stage: c.build_stage,
      dependencies: parseList(c.dependencies),
      os_abi: parseList(c.os_abi),
      verified_devices: parseList(c.verified_devices),
      source_url: c.source_url,
      used_by: used,
    };
  });
}

/** Admin import: upsert components {framework, id, kind?, function?, hardware[], repository?, ...}. */
export async function importComponents(items: Array<Record<string, any>>): Promise<number> {
  const now = nowIso();
  const arr = (v: unknown) => JSON.stringify(list(v, 40, 200));
  let n = 0;
  for (const c of items) {
    const framework = s(c.framework, 32).trim();
    const id = s(c.id, 80).trim();
    if (!framework || !id) throw new HttpError(400, 'framework and id required', 'each component needs {framework, id}');
    await exec(
      `INSERT INTO porting_components (framework, id, kind, function, hardware, repository, scope, build_stage, dependencies, os_abi, verified_devices, source_url, imported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(framework, id) DO UPDATE SET kind = excluded.kind, function = excluded.function, hardware = excluded.hardware,
         repository = excluded.repository, scope = excluded.scope, build_stage = excluded.build_stage, dependencies = excluded.dependencies,
         os_abi = excluded.os_abi, verified_devices = excluded.verified_devices, source_url = excluded.source_url, imported = excluded.imported`,
      [framework, id, s(c.kind, 32), s(c.function, 300), arr(c.hardware), s(c.repository, 300), s(c.scope, 32), s(c.build_stage, 32), arr(c.dependencies), arr(c.os_abi), arr(c.verified_devices), s(c.source_url, 300), now],
    );
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Apply a record to its phone                                         */
/* ------------------------------------------------------------------ */

/** The framework's areas that match a tracker area. */
export const PORTING_AREA_MAP: Record<string, string> = {
  input: 'touch',
  gpu: 'gpu',
  network: 'wifi',
  audio: 'audio',
  bluetooth: 'bluetooth',
  cellular: 'modem',
  modem: 'modem',
  baseband: 'modem',
  camera: 'camera',
  sensors: 'sensors',
  haptics: 'haptics',
};
const PORTING_STATE: Record<string, string> = { 'device-verified': 'works', 'host-verified': 'in-progress', implemented: 'in-progress' };

/** "ipados-17.7.11-21H461" -> "iPadOS 17.7.11 (21H461)". */
export function osProfileVersion(profile: string): string {
  const m = /^(ipados|ios|macos|tvos)-(\d+(?:\.\d+)*)(?:-([0-9A-Za-z]+))?/i.exec(profile.trim());
  if (!m) return '';
  const name = { ipados: 'iPadOS', ios: 'iOS', macos: 'macOS', tvos: 'tvOS' }[m[1].toLowerCase()]!;
  return `${name} ${m[2]}${m[3] ? ` (${m[3]})` : ''}`;
}

/**
 * POST /api/porting/{key}/apply: write the record's areas to its phone's
 * statuses (device-verified -> works, host-verified / implemented ->
 * in-progress; planned is skipped), citing the record. Rows that already have
 * a state stay unless `overwrite`; `areas` limits it to some tracker areas.
 * Fills the phone's iOS version from the OS profile when it has none. The
 * phone's maintainers or an admin (upsertStatus checks).
 */
export async function applyPorting(
  req: Request,
  key: string,
  opts: { overwrite?: boolean; areas?: string[] },
  upsert: (req: Request, device: string, area: string, body: Record<string, unknown>) => Promise<unknown>,
): Promise<{ device: string; applied: Array<{ area: string; state: string }>; kept: string[]; ios_version: string }> {
  const rec = await getPorting(key);
  if (!rec.device_slug) throw new HttpError(409, 'record has no phone', 'this porting record is not tied to a phone on the tracker');
  const device = rec.device_slug;
  const current = new Map(
    (await queryAll<{ area_slug: string; state: string }>("SELECT area_slug, state FROM device_status WHERE device_slug = ? AND os = 'ios'", [device])).map((r) => [r.area_slug, r.state]),
  );
  const version = osProfileVersion(rec.os_profile);
  const best = new Map<string, { state: string; detail: string }>();
  const rank = (s: string) => (s === 'works' ? 2 : 1);
  for (const a of rec.areas) {
    const area = PORTING_AREA_MAP[a.id];
    const state = PORTING_STATE[a.status];
    if (!area || !state || (opts.areas?.length && !opts.areas.includes(area))) continue;
    const prev = best.get(area);
    if (prev && rank(prev.state) >= rank(state)) continue;
    best.set(area, { state, detail: `repo claim (${rec.framework} porting record, ${rec.repo || rec.record}, ${a.status}): ${a.completion[0] || a.limits[0] || a.id}` });
  }
  const applied: Array<{ area: string; state: string }> = [];
  const kept: string[] = [];
  for (const [area, v] of best) {
    const had = current.get(area);
    if (had && had !== 'unknown' && !opts.overwrite) {
      kept.push(area);
      continue;
    }
    await upsert(req, device, area, { state: v.state, detail: v.detail.slice(0, 2000), source: rec.page_url || rec.source_url, ...(version ? { os_version: version } : {}) });
    applied.push({ area, state: v.state });
  }
  let ios_version = '';
  if (version && /^(iOS|iPadOS)/.test(version)) {
    const d = await queryFirst<{ ios_version: string }>('SELECT ios_version FROM devices WHERE slug = ?', [device]);
    if (d && !d.ios_version) {
      await exec('UPDATE devices SET ios_version = ? WHERE slug = ?', [version, device]);
      ios_version = version;
    }
  }
  return { device, applied, kept, ios_version };
}
