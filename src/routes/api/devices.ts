// /api/devices — GET list (?q= searches slug/name/model/SoC/notes, ?state=,
// ?base=, ?family= (a label in its families), ?limit= (default and max 500),
// ?offset=; public; each device carries families/family,
// statuses, forks, claims, maintainers, supported_by and media, read in a
// fixed number of queries; -> {devices, total, limit, offset, next}), POST
// create (admin). 409 on duplicate slug.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst } from '@/lib/db';
import {
  BASES,
  HttpError,
  REPO_KINDS,
  STATES,
  actorName,
  json,
  nowIso,
  oneOf,
  paged,
  pageInfo,
  pageParams,
  readJson,
  requireAdmin,
  str,
  validSlug,
} from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { DEVICE_TEXT, deviceField, likeEscape, withDetails } from '@/lib/devices';
import { appendChangelog } from '@/lib/changelog';
import type { Device } from '@/lib/types';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const q = sp.get('q')?.trim() || '';
  const state = sp.get('state')?.trim() || null;
  if (state) oneOf(STATES, state, 'state');
  const base = sp.get('base')?.trim() || null;
  if (base) oneOf(BASES, base, 'base');
  const page = pageParams(sp, 500, 500);
  const where: string[] = [];
  const vals: unknown[] = [];
  if (q) {
    const like = `%${likeEscape(q.slice(0, 100))}%`;
    where.push(
      `(slug LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR soc LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')`,
    );
    vals.push(like, like, like, like, like);
  }
  if (state) {
    where.push('status = ?');
    vals.push(state);
  }
  if (base) {
    where.push('base = ?');
    vals.push(base);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const family = sp.get('family')?.trim() || null;
  if (family) {
    // families is derived (src/lib/forks.ts deviceFamilies), so this filter
    // runs on the detailed rows; there are a few hundred devices at most.
    const all = await withDetails(await queryAll<Device>(`SELECT * FROM devices ${w} ORDER BY slug`, vals));
    const hit = all.filter((d) => d.families.some((f) => f.toLowerCase() === family.toLowerCase()));
    const rows = hit.slice(page.offset, page.offset + page.limit);
    return json({ devices: rows, ...pageInfo(hit.length, page.limit, page.offset, rows.length) });
  }
  const { rows, page: info } = await paged<Device>(`SELECT * FROM devices ${w} ORDER BY slug`, `SELECT COUNT(*) AS n FROM devices ${w}`, vals, page);
  return json({ devices: await withDetails(rows), ...info });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const body = await readJson(request);
  const slug = str(body, 'slug', 64).toLowerCase();
  const name = str(body, 'name', 120);
  if (!validSlug(slug)) {
    throw new HttpError(400, 'bad slug', 'use lowercase letters, digits and dashes, e.g. "s24-ultra"');
  }
  if (!name) throw new HttpError(400, 'name required', 'send {"slug","name"} plus optional model/soc/repo_kind/status');
  const status = oneOf(STATES, str(body, 'status', 32) || 'unknown', 'status');
  const repoKind = oneOf(REPO_KINDS, str(body, 'repo_kind', 32) || 'home', 'repo_kind');
  if (await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug])) {
    throw new HttpError(409, 'device exists', `PATCH /api/devices/${slug} to update it`);
  }
  const extra = Object.keys(DEVICE_TEXT).filter((k) => body[k] !== undefined);
  const row = await queryFirst<Device>(
    `INSERT INTO devices (slug, name, model, soc, repo_kind, status, best_result, notes, updated${extra.map((k) => `, ${k}`).join('')})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${extra.map(() => ', ?').join('')}) RETURNING *`,
    [
      slug,
      name,
      str(body, 'model', 64),
      str(body, 'soc', 64),
      repoKind,
      status,
      str(body, 'best_result', 2000),
      str(body, 'notes', 4000),
      nowIso(),
      ...extra.map((k) => deviceField(body, k)),
    ],
  );
  await appendChangelog(actorName(user), `device ${slug} added`);
  return json({ device: row }, 201);
}

export const Route = createFileRoute('/api/devices')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
