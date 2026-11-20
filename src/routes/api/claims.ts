// /api/claims — GET list (?device= ?status=), POST file a claim (auth).
// Claims start as pending; 409 when you already have a pending claim there.

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
import { mapClaimRow } from '@/routes/api/claims.$id';
import { appendChangelog } from '@/lib/changelog';
import type { Claim } from '@/lib/types';

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'];

async function handleGet(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const device = q.get('device')?.trim() || null;
  const status = q.get('status')?.trim() || null;
  if (status && !CLAIM_STATUSES.includes(status)) {
    throw new HttpError(400, 'bad status', `status must be one of: ${CLAIM_STATUSES.join(' | ')}`);
  }
  const where: string[] = [];
  const vals: string[] = [];
  if (device) {
    where.push('c.device_slug = ?');
    vals.push(device);
  }
  if (status) {
    where.push('c.status = ?');
    vals.push(status);
  }
  const claims = await queryAll<Claim & { display_name: string | null; github_login: string | null }>(
    `SELECT c.*, u.display_name, u.github_login FROM claims c
     LEFT JOIN users u ON u.id = c.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.id DESC LIMIT 200`,
    vals,
  );
  return json({ claims: claims.map(mapClaimRow) });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const deviceSlug = String(body.device_slug || body.device || '').trim();
  if (!deviceSlug) throw new HttpError(400, 'device_slug required', 'send {"device_slug"} plus optional note');
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [deviceSlug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const existing = await queryFirst(
    'SELECT id FROM claims WHERE user_id = ? AND device_slug = ? AND status = ?',
    [user.id, deviceSlug, 'pending'],
  );
  if (existing) {
    throw new HttpError(409, 'claim already pending', 'wait for review, or DELETE /api/claims/<id> to withdraw it');
  }
  const id = await insertReturningId('INSERT INTO claims (user_id, device_slug, note, status, updated) VALUES (?, ?, ?, ?, ?)', [
    user.id,
    deviceSlug,
    String(body.note || ''),
    'pending',
    nowIso(),
  ]);
  const row = id
    ? await queryFirst<Claim>('SELECT * FROM claims WHERE id = ?', [id])
    : await queryFirst<Claim>('SELECT * FROM claims ORDER BY id DESC LIMIT 1');
  if (!row) throw new HttpError(500, 'claim creation failed', 'retry');
  await appendChangelog(actorName(user), `claim filed for ${deviceSlug}`);
  return json({ claim: row }, 201);
}

export const Route = createFileRoute('/api/claims')({
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
