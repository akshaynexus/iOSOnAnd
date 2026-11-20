// /api/devices — GET list (?q= searches slug/name/model/SoC), POST create (auth).
// 409 on duplicate slug.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll, queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  STATES,
  actorName,
  handleError,
  json,
  nowIso,
  readJson,
  requireUser,
  validSlug,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { Device } from '@/lib/types';

export const REPO_KINDS = ['home', 'fork', 'snapshot', 'mirror', 'none'];

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function handleGet(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q')?.trim() || '';
  const state = sp.get('state')?.trim() || null;
  if (state && !(STATES as readonly string[]).includes(state)) {
    throw new HttpError(400, 'bad state', `state must be one of: ${STATES.join(' | ')}`);
  }
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 100, 1), 500);
  const where: string[] = [];
  const vals: string[] = [];
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push(
      `(slug LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR soc LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')`,
    );
    vals.push(like, like, like, like, like);
  }
  if (state) {
    where.push('status = ?');
    vals.push(state);
  }
  const devices = await queryAll<Device>(
    `SELECT * FROM devices ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY slug LIMIT ${limit}`,
    vals,
  );
  return json({ devices });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  if (!validSlug(slug)) {
    throw new HttpError(400, 'bad slug', 'use lowercase letters, digits and dashes, e.g. "s24-ultra"');
  }
  if (!name) throw new HttpError(400, 'name required', 'send {"slug","name"} plus optional model/soc/repo_kind/status');
  const status = body.status ? String(body.status) : 'unknown';
  if (!(STATES as readonly string[]).includes(status)) {
    throw new HttpError(400, 'bad status', `state must be one of: ${STATES.join(' | ')}`);
  }
  const repoKind = body.repo_kind ? String(body.repo_kind) : 'home';
  if (!REPO_KINDS.includes(repoKind)) {
    throw new HttpError(400, 'bad repo_kind', `must be one of: ${REPO_KINDS.join(' | ')}`);
  }
  if (await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug])) {
    throw new HttpError(409, 'device exists', `PATCH /api/devices/${slug} to update it`);
  }
  await exec(
    `INSERT INTO devices (slug, name, model, soc, repo_kind, status, best_result, notes, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      slug,
      name,
      String(body.model || ''),
      String(body.soc || ''),
      repoKind,
      status,
      String(body.best_result || ''),
      String(body.notes || ''),
      nowIso(),
    ],
  );
  const row = await queryFirst<Device>('SELECT * FROM devices WHERE slug = ?', [slug]);
  await appendChangelog(actorName(user), `device ${slug} added`);
  return json({ device: row }, 201);
}

export const Route = createFileRoute('/api/devices')({
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
