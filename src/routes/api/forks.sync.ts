// POST /api/forks/sync — upsert a fork by repo (CLI fork-sync).
// Matches repo (+ device scope when device_slug is given); updates the syncable
// fields and stamps updated, or creates the fork (verified: fork-claim).
// -> {fork, created}.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  handleError,
  insertReturningId,
  json,
  nowIso,
  readJson,
  requireUser,
} from '@/lib/auth';
import { VERIFIED } from '@/routes/api/forks';
import { appendChangelog } from '@/lib/changelog';
import type { Fork } from '@/lib/types';

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const repo = String(body.repo || '').trim();
  if (!repo) throw new HttpError(400, 'repo required', 'send {"repo":"OWNER/REPO"} plus --best-result etc.');
  const deviceSlug = body.device_slug ? String(body.device_slug).trim() : null;
  if (deviceSlug && !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [deviceSlug]))) {
    throw new HttpError(404, 'unknown device', 'POST /api/devices to add it first, or omit device_slug');
  }
  const url = body.url ? String(body.url) : deviceSlug || repo.includes('/')
    ? `https://github.com/${repo}`
    : repo;
  if (url && !/^https?:\/\//.test(url)) throw new HttpError(400, 'bad url', 'url must start with http(s)://');

  const existing = deviceSlug
    ? await queryFirst<Fork>('SELECT * FROM forks WHERE repo = ? AND device_slug = ?', [repo, deviceSlug])
    : await queryFirst<Fork>('SELECT * FROM forks WHERE repo = ? AND device_slug IS NULL', [repo]);

  const fields = {
    branch: String(body.branch || ''),
    url,
    best_result: String(body.best_result || ''),
    ported: String(body.ported || ''),
    fork_only: String(body.fork_only || ''),
    notes: String(body.notes || ''),
  };

  if (existing) {
    const sets = ['branch = ?', 'url = ?', 'best_result = ?', 'ported = ?', 'fork_only = ?', 'notes = ?'];
    const vals: unknown[] = [fields.branch, fields.url, fields.best_result, fields.ported, fields.fork_only, fields.notes];
    if (body.verified !== undefined) {
      const v = String(body.verified);
      if (!VERIFIED.includes(v)) {
        throw new HttpError(400, 'bad verified', `must be one of: ${VERIFIED.join(' | ')}`);
      }
      sets.push('verified = ?');
      vals.push(v);
    }
    sets.push('updated = ?');
    vals.push(nowIso(), existing.id);
    await exec(`UPDATE forks SET ${sets.join(', ')} WHERE id = ?`, vals as never[]);
    const row = await queryFirst<Fork>('SELECT * FROM forks WHERE id = ?', [existing.id]);
    await appendChangelog(actorName(user), `fork ${repo} synced`);
    return json({ fork: row, created: false });
  }

  const id = await insertReturningId(
    `INSERT INTO forks (device_slug, repo, branch, url, best_result, ported, fork_only, verified, notes, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'fork-claim', ?, ?)`,
    [deviceSlug, repo, fields.branch, fields.url, fields.best_result, fields.ported, fields.fork_only, fields.notes, nowIso()],
  );
  const row = id
    ? await queryFirst<Fork>('SELECT * FROM forks WHERE id = ?', [id])
    : await queryFirst<Fork>('SELECT * FROM forks ORDER BY id DESC LIMIT 1');
  if (!row) throw new HttpError(500, 'fork creation failed', 'retry');
  await appendChangelog(actorName(user), `fork ${repo} added via sync${deviceSlug ? ` for ${deviceSlug}` : ''}`);
  return json({ fork: row, created: true }, 201);
}

export const Route = createFileRoute('/api/forks/sync')({
  server: {
    handlers: {
  POST: async ({ request }: { request: Request }) => {
    try {
      return await handlePost(request);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
