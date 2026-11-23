// src/lib/forks.ts — fork field validation and the fork read shape, shared by
// /api/forks, /api/forks/:id, /api/forks/sync, /api/forks/:id/devices,
// /api/repos/* and the device views.
//
// `verified` is a trust statement: a maintainer may only file `fork-claim`;
// `reproduced` and `merged` are set by an admin. `kind` (upstream | fork |
// standalone) is admin-only too. The repo name is unique (migrations/0004).
//
// Read shape (ForkView): the forks row plus
//   maintainer  {id, display_name, github_login} | null  (forks.maintainer_user_id)
//   supports    [{device_slug, device_name, support, via, note}]  (repo_devices)
//   based_on    [{base, base_repo_url, relation, note}]  (repo_lineage, migrations/0006)
//   base_project  the family label (forks.base_project)

import { queryAll, queryFirst, exec } from '@/lib/db';
import {
  FORK_KINDS,
  HttpError,
  SUPPORT_LEVELS,
  canEditDevice,
  VERIFIED,
  isAdmin,
  nowIso,
  oneOf,
  str,
  validHttpUrl,
  validRepo,
} from '@/lib/auth';
import type { UserRow } from '@/lib/auth';
import type { Fork } from '@/lib/types';

/** Text columns a fork write may carry, with their length caps. */
export const FORK_TEXT: Record<string, number> = {
  branch: 200,
  url: 500,
  best_result: 2000,
  ported: 4000,
  fork_only: 4000,
  notes: 4000,
};

/** OWNER/REPO from a repo, a github.com URL or an OWNER/REPO.git; null when it is none of these. */
export function normalizeRepo(raw: string): string | null {
  const repo = String(raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  return validRepo(repo) ? repo : null;
}

export function forkRepo(body: Record<string, any>): string {
  const raw = str(body, 'repo', 200);
  if (!raw) throw new HttpError(400, 'repo required', 'send {"repo":"OWNER/NAME"} plus optional device_slug/branch/url');
  const repo = normalizeRepo(raw);
  if (!repo) throw new HttpError(400, 'bad repo', 'repo must look like OWNER/NAME (GitHub), e.g. "YMGPwcca/OneiOS"');
  return repo;
}

/** Validated text field (url must be http(s)). */
export function forkText(body: Record<string, any>, f: string): string {
  const v = str(body, f, FORK_TEXT[f]);
  if (f === 'url' && v && !validHttpUrl(v)) throw new HttpError(400, 'bad url', 'url must be an http(s):// URL');
  return v;
}

export function forkVerified(user: UserRow, raw: unknown): string {
  const v = oneOf(VERIFIED, String(raw), 'verified');
  if (v !== 'fork-claim' && !isAdmin(user)) {
    throw new HttpError(403, 'admin required', `only an admin marks a fork "${v}"; maintainers file "fork-claim"`);
  }
  return v;
}

export function forkKind(user: UserRow, raw: unknown): string {
  const v = oneOf(FORK_KINDS, String(raw), 'kind');
  if (v !== 'fork' && !isAdmin(user)) {
    throw new HttpError(403, 'admin required', `only an admin marks a repo "${v}"`);
  }
  return v;
}

/** device_slug from a body: undefined when absent, null when explicitly empty. */
export function forkDevice(body: Record<string, any>): string | null | undefined {
  if (body.device_slug === undefined && body.device === undefined) return undefined;
  const v = str(body, body.device_slug !== undefined ? 'device_slug' : 'device', 64);
  return v || null;
}

/* ------------------------------------------------------------------ */
/* Read shape                                                          */
/* ------------------------------------------------------------------ */

export interface UserRef {
  id: number;
  display_name: string;
  github_login: string | null;
}

export interface SupportRow {
  device_slug: string;
  device_name: string;
  support: string;
  via: string | null;
  note: string;
}

export interface BasedOn {
  base: string;
  base_repo_url: string | null;
  relation: string;
  note: string;
}

export const LINEAGE_RELATIONS = ['fork-of', 'derived-from', 'ported-from', 'uses'] as const;

export type ForkRow = Fork & {
  kind: string;
  base_project: string;
  maintainer_user_id: number | null;
  maintainer_since: string | null;
  m_display_name?: string | null;
  m_github_login?: string | null;
};

export type ForkView = Omit<ForkRow, 'm_display_name' | 'm_github_login'> & {
  maintainer: UserRef | null;
  supports: SupportRow[];
  based_on: BasedOn[];
};

export const FORK_SELECT = `SELECT f.*, u.display_name AS m_display_name, u.github_login AS m_github_login
  FROM forks f LEFT JOIN users u ON u.id = f.maintainer_user_id`;

const SUPPORT_ORDER = `CASE rd.support WHEN 'primary' THEN 0 WHEN 'merged' THEN 1 WHEN 'ported' THEN 2 ELSE 3 END`;
const CHUNK = 90; // D1 allows at most 100 bound parameters per statement

async function inChunks<T>(sqlBefore: string, sqlAfter: string, keys: Array<string | number>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const part = keys.slice(i, i + CHUNK);
    out.push(...(await queryAll<T>(`${sqlBefore} IN (${part.map(() => '?').join(', ')}) ${sqlAfter}`, part)));
  }
  return out;
}

/** Attach maintainer and supports to fork rows (one extra query per 90 forks). */
export async function forkViews(rows: ForkRow[]): Promise<ForkView[]> {
  if (!rows.length) return [];
  const sup = await inChunks<SupportRow & { fork_id: number }>(
    `SELECT rd.fork_id, rd.device_slug, COALESCE(d.name, rd.device_slug) AS device_name, rd.support, v.repo AS via, rd.note
       FROM repo_devices rd LEFT JOIN devices d ON d.slug = rd.device_slug LEFT JOIN forks v ON v.id = rd.via_fork_id
      WHERE rd.fork_id`,
    `ORDER BY ${SUPPORT_ORDER}, rd.device_slug`,
    rows.map((r) => r.id),
  );
  const byFork = new Map<number, SupportRow[]>();
  for (const { fork_id, ...s } of sup) {
    if (!byFork.has(fork_id)) byFork.set(fork_id, []);
    byFork.get(fork_id)!.push(s);
  }
  const lin = await inChunks<{ fork_id: number; base: string; relation: string; note: string; base_exists: number }>(
    'SELECT fork_id, base, relation, note, base_exists FROM repo_lineage WHERE fork_id',
    `ORDER BY CASE relation WHEN 'fork-of' THEN 0 WHEN 'derived-from' THEN 1 WHEN 'ported-from' THEN 2 ELSE 3 END, base`,
    rows.map((r) => r.id),
  );
  const linByFork = new Map<number, BasedOn[]>();
  for (const { fork_id, base, relation, note, base_exists } of lin) {
    if (!linByFork.has(fork_id)) linByFork.set(fork_id, []);
    const url = validRepo(base) && Number(base_exists) !== 0 ? `https://github.com/${base}` : null;
    linByFork.get(fork_id)!.push({ base, base_repo_url: url, relation, note });
  }
  return rows.map(({ m_display_name, m_github_login, ...f }) => ({
    ...f,
    kind: f.kind || 'fork',
    maintainer:
      f.maintainer_user_id != null
        ? { id: f.maintainer_user_id, display_name: m_display_name ?? '', github_login: m_github_login ?? null }
        : null,
    base_project: f.base_project ?? '',
    supports: byFork.get(f.id) ?? [],
    based_on: linByFork.get(f.id) ?? [],
  }));
}

export async function forkView(row: ForkRow): Promise<ForkView> {
  return (await forkViews([row]))[0];
}

export async function loadForkRow(id: string | number): Promise<ForkRow> {
  if (!/^\d{1,15}$/.test(String(id))) throw new HttpError(404, 'unknown fork', 'fork ids are numeric');
  const row = await queryFirst<ForkRow>(`${FORK_SELECT} WHERE f.id = ?`, [Number(id)]);
  if (!row) throw new HttpError(404, 'unknown fork', 'GET /api/forks to list known forks');
  return row;
}

export async function findForkByRepo(repo: string): Promise<ForkRow | null> {
  return queryFirst<ForkRow>(`${FORK_SELECT} WHERE f.repo = ? COLLATE NOCASE`, [repo]);
}

/** Device-level view: every repo that supports a device, upstream first. */
export interface SupportedBy {
  repo: string;
  kind: string;
  base_project: string;
  support: string;
  via: string | null;
  note: string;
}

export async function supportedBy(slugs: string[]): Promise<Map<string, SupportedBy[]>> {
  const rows = await inChunks<SupportedBy & { device_slug: string }>(
    `SELECT rd.device_slug, f.repo, f.kind, f.base_project, rd.support, v.repo AS via, rd.note
       FROM repo_devices rd JOIN forks f ON f.id = rd.fork_id LEFT JOIN forks v ON v.id = rd.via_fork_id
      WHERE rd.device_slug`,
    `ORDER BY CASE f.kind WHEN 'upstream' THEN 0 WHEN 'standalone' THEN 1 ELSE 2 END, ${SUPPORT_ORDER}, f.repo`,
    slugs,
  );
  const m = new Map<string, SupportedBy[]>();
  for (const { device_slug, ...r } of rows) {
    if (!m.has(device_slug)) m.set(device_slug, []);
    m.get(device_slug)!.push(r);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* repo_devices writes                                                 */
/* ------------------------------------------------------------------ */

export function supportLevel(raw: unknown): string {
  return oneOf(SUPPORT_LEVELS, String(raw ?? ''), 'support');
}

/** Upsert one repo_devices row. */
export async function setSupport(
  forkId: number,
  deviceSlug: string,
  support: string,
  viaForkId: number | null,
  note: string,
): Promise<void> {
  await exec(
    `INSERT INTO repo_devices (fork_id, device_slug, support, via_fork_id, note, updated) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(fork_id, device_slug) DO UPDATE SET support = excluded.support, via_fork_id = excluded.via_fork_id,
       note = excluded.note, updated = excluded.updated`,
    [forkId, deviceSlug, support, viaForkId, note, nowIso()],
  );
}

/**
 * Keep the fork's own device (forks.device_slug) in repo_devices: 'primary'
 * for an upstream or standalone repo, 'merged' for a merged fork, else
 * 'claimed'. An existing stronger row (primary, merged, ported) is kept when
 * the computed level is only 'claimed'. `previous`: the device the fork moved
 * away from; its 'claimed' or 'primary' row is removed.
 */
export async function syncOwnSupport(
  fork: { id: number; device_slug: string | null; kind?: string; verified?: string },
  previous?: string | null,
): Promise<void> {
  if (previous && previous !== fork.device_slug) {
    await exec("DELETE FROM repo_devices WHERE fork_id = ? AND device_slug = ? AND support IN ('claimed', 'primary')", [
      fork.id,
      previous,
    ]);
  }
  if (!fork.device_slug) return;
  const level =
    fork.kind === 'upstream' || fork.kind === 'standalone' ? 'primary' : fork.verified === 'merged' ? 'merged' : 'claimed';
  const cur = await queryFirst<{ support: string }>('SELECT support FROM repo_devices WHERE fork_id = ? AND device_slug = ?', [
    fork.id,
    fork.device_slug,
  ]);
  if (cur && (cur.support === level || level === 'claimed')) return;
  await exec(
    `INSERT INTO repo_devices (fork_id, device_slug, support, note, updated) VALUES (?, ?, ?, '', ?)
     ON CONFLICT(fork_id, device_slug) DO UPDATE SET support = excluded.support, updated = excluded.updated`,
    [fork.id, fork.device_slug, level, nowIso()],
  );
}

/** Admin, the repo's maintainer, or a maintainer of the fork's device. */
export async function canEditFork(user: UserRow, fork: ForkRow): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (fork.maintainer_user_id != null && fork.maintainer_user_id === user.id) return true;
  return canEditDevice(user, fork.device_slug);
}

/** Upsert one repo_lineage row for a tracked fork; base_fork_id is resolved when the base is a tracked repo. */
export async function setLineage(
  fork: { id: number; repo: string },
  base: string,
  relation: string,
  note: string,
  source: string,
  baseExists = true,
): Promise<void> {
  const baseFork = validRepo(base) ? await queryFirst<{ id: number }>('SELECT id FROM forks WHERE repo = ? COLLATE NOCASE', [base]) : null;
  // A base already known to 404 on GitHub (lineage_repos.repo_exists = 0) never gets a link,
  // whatever the caller passed; a tracked base always exists.
  if (!baseFork && baseExists && validRepo(base)) {
    const known = await queryFirst<{ repo_exists: number }>(
      'SELECT repo_exists FROM lineage_repos WHERE repo = ? COLLATE NOCASE',
      [base],
    );
    if (known && Number(known.repo_exists) === 0) baseExists = false;
  }
  await exec(
    `INSERT INTO repo_lineage (repo, fork_id, base, base_fork_id, relation, note, source, base_exists) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo, base, relation) DO UPDATE SET fork_id = excluded.fork_id, base_fork_id = excluded.base_fork_id,
       note = excluded.note, source = excluded.source, base_exists = excluded.base_exists`,
    [fork.repo, fork.id, base, baseFork?.id ?? null, relation, note, source, baseExists ? 1 : 0],
  );
}

/** A repo became tracked: attach the lineage rows that name it (as the repo or as a base). */
export async function linkLineage(fork: { id: number; repo: string }): Promise<void> {
  await exec('UPDATE repo_lineage SET fork_id = ?, repo = ? WHERE repo = ? COLLATE NOCASE', [fork.id, fork.repo, fork.repo]);
  await exec('UPDATE repo_lineage SET base_fork_id = ? WHERE base = ? COLLATE NOCASE', [fork.id, fork.repo]);
  await exec('DELETE FROM lineage_repos WHERE repo = ? COLLATE NOCASE', [fork.repo]);
}

const SUPPORT_RANK: Record<string, number> = { primary: 0, merged: 1, ported: 2, claimed: 3 };

/**
 * A device's family labels: the distinct base_project of the repos that
 * support it (supported_by first, then its own forks), ordered by the best
 * support level, then by how many repos carry the label, then by name.
 * 'unknown' (and '') count only when nothing else is known.
 */
export function deviceFamilies(
  supported: Array<{ base_project: string; support: string }>,
  forks: Array<{ base_project: string }>,
): string[] {
  const agg = new Map<string, { rank: number; n: number }>();
  const add = (fam: string, rank: number) => {
    const k = (fam || '').trim();
    const e = agg.get(k) ?? { rank: 9, n: 0 };
    e.rank = Math.min(e.rank, rank);
    e.n += 1;
    agg.set(k, e);
  };
  for (const s of supported) add(s.base_project, SUPPORT_RANK[s.support] ?? 3);
  for (const f of forks) add(f.base_project, 3);
  const order = (a: [string, { rank: number; n: number }], b: [string, { rank: number; n: number }]) =>
    a[1].rank - b[1].rank || b[1].n - a[1].n || a[0].localeCompare(b[0]);
  const known = [...agg.entries()].filter(([k]) => k && k !== 'unknown').sort(order).map(([k]) => k);
  if (known.length) return known;
  return agg.size ? ['unknown'] : [];
}
