// /api/forks — GET list (public; ?device= (the fork's own device or any device
// it supports), ?kind=upstream|fork|standalone, ?base_project=, ?limit=
// (default and max 500), ?offset=; sorted upstream first, then by repo;
// -> {forks, total, limit, offset, next}), POST add (admin, or a maintainer of
// the fork's device_slug; forks without a device are admin-only; kind other
// than fork, verified other than fork-claim: admin only). The repo name is
// unique: a second POST for it is 409.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { FORK_KINDS, HttpError, actorName, json, nowIso, oneOf, paged, pageParams, readJson, requireDeviceEditor, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import {
  FORK_SELECT,
  findForkByRepo,
  forkDevice,
  forkKind,
  forkRepo,
  forkText,
  forkVerified,
  forkView,
  forkViews,
  linkLineage,
  loadForkRow,
  syncOwnSupport,
  type ForkRow,
} from '@/lib/forks';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const device = sp.get('device')?.trim() || null;
  const kind = sp.get('kind')?.trim() || null;
  const baseProject = sp.get('base_project')?.trim() || null;
  if (kind) oneOf(FORK_KINDS, kind, 'kind');
  const page = pageParams(sp, 500, 500);
  const where: string[] = [];
  const vals: unknown[] = [];
  if (device) {
    where.push('(f.device_slug = ? OR f.id IN (SELECT fork_id FROM repo_devices WHERE device_slug = ?))');
    vals.push(device, device);
  }
  if (kind) {
    where.push('f.kind = ?');
    vals.push(kind);
  }
  if (baseProject) {
    where.push('f.base_project = ? COLLATE NOCASE');
    vals.push(baseProject);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows, page: info } = await paged<ForkRow>(
    `${FORK_SELECT} ${w} ORDER BY CASE f.kind WHEN 'upstream' THEN 0 WHEN 'standalone' THEN 1 ELSE 2 END, f.repo COLLATE NOCASE`,
    `SELECT COUNT(*) AS n FROM forks f ${w}`,
    vals,
    page,
  );
  return json({ forks: await forkViews(rows), ...info });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const deviceSlug = forkDevice(body) ?? null;
  const user = await requireDeviceEditor(request, deviceSlug);
  const repo = forkRepo(body);
  const verified = forkVerified(user, body.verified ?? 'fork-claim');
  const kind = forkKind(user, body.kind ?? 'fork');
  const dup = await findForkByRepo(repo);
  if (dup) {
    throw new HttpError(409, 'fork already tracked', `${dup.repo} is fork #${dup.id}; POST /api/forks/sync or PATCH /api/forks/${dup.id} updates it`);
  }
  const ins = await queryFirst<{ id: number }>(
    `INSERT INTO forks (device_slug, repo, branch, url, best_result, ported, fork_only, verified, notes, updated, kind, base_project)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      deviceSlug,
      repo,
      forkText(body, 'branch'),
      forkText(body, 'url') || `https://github.com/${repo}`,
      forkText(body, 'best_result'),
      forkText(body, 'ported'),
      forkText(body, 'fork_only'),
      verified,
      forkText(body, 'notes'),
      nowIso(),
      kind,
      str(body, 'base_project', 64),
    ],
  );
  if (!ins) throw new HttpError(500, 'fork creation failed', 'retry');
  await syncOwnSupport({ id: ins.id, device_slug: deviceSlug, kind, verified });
  await linkLineage({ id: ins.id, repo });
  await appendChangelog(actorName(user), `fork ${repo} added${deviceSlug ? ` for ${deviceSlug}` : ''}`);
  return json({ fork: await forkView(await loadForkRow(ins.id)) }, 201);
}

export const Route = createFileRoute('/api/forks')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
