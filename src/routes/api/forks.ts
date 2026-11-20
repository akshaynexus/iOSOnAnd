// /api/forks — GET list (?device=), POST add (auth).

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst } from '@/lib/db';
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
import { appendChangelog } from '@/lib/changelog';
import type { Fork } from '@/lib/types';

export const VERIFIED = ['fork-claim', 'reproduced', 'merged'];

async function handleGet(req: Request): Promise<Response> {
  const device = new URL(req.url).searchParams.get('device')?.trim() || null;
  const forks = device
    ? await queryAll<Fork>('SELECT * FROM forks WHERE device_slug = ? ORDER BY repo', [device])
    : await queryAll<Fork>('SELECT * FROM forks ORDER BY repo LIMIT 200');
  return json({ forks });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const repo = String(body.repo || '').trim();
  if (!repo) throw new HttpError(400, 'repo required', 'send {"repo":"owner/name"} plus optional device_slug/branch/url');
  const deviceSlug = body.device_slug ? String(body.device_slug).trim() : null;
  if (deviceSlug && !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [deviceSlug]))) {
    throw new HttpError(404, 'unknown device', 'POST /api/devices to add it first, or omit device_slug for a pure mirror');
  }
  const verified = body.verified ? String(body.verified) : 'fork-claim';
  if (!VERIFIED.includes(verified)) {
    throw new HttpError(400, 'bad verified', `must be one of: ${VERIFIED.join(' | ')}`);
  }
  const url = String(body.url || '');
  if (url && !/^https?:\/\//.test(url)) throw new HttpError(400, 'bad url', 'url must start with http(s)://');
  const id = await insertReturningId(
    `INSERT INTO forks (device_slug, repo, branch, url, best_result, ported, fork_only, verified, notes, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceSlug,
      repo,
      String(body.branch || ''),
      url,
      String(body.best_result || ''),
      String(body.ported || ''),
      String(body.fork_only || ''),
      verified,
      String(body.notes || ''),
      nowIso(),
    ],
  );
  const row = id
    ? await queryFirst<Fork>('SELECT * FROM forks WHERE id = ?', [id])
    : await queryFirst<Fork>('SELECT * FROM forks ORDER BY id DESC LIMIT 1');
  if (!row) throw new HttpError(500, 'fork creation failed', 'retry');
  await appendChangelog(actorName(user), `fork ${repo} added${deviceSlug ? ` for ${deviceSlug}` : ''}`);
  return json({ fork: row }, 201);
}

export const Route = createFileRoute('/api/forks')({
  server: {
    handlers: {
  GET: async ({ request }: { request: Request }) => {
    try {
      return await handleGet(request);
    } catch (e) {
      return handleError(e);
    }
  },
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
