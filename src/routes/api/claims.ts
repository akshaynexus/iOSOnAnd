// /api/claims — GET list (?device= ?status= ?user=me, ?limit= default 200,
// max 500, ?offset=; public; -> {claims, total, limit, offset, next}), POST file a
// claim (any logged-in user). A user may hold one active (pending or
// approved) claim per device: a duplicate is 409. An admin approves it
// (POST /api/claims/:id/approve), which makes the claimant a maintainer.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import {
  CLAIM_STATUSES,
  HttpError,
  actorName,
  json,
  nowIso,
  oneOf,
  paged,
  pageParams,
  readJson,
  requireUser,
  str,
} from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { CLAIM_SELECT, mapClaimRow, type ClaimJoinRow } from '@/lib/devices';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const device = q.get('device')?.trim() || null;
  const status = q.get('status')?.trim() || null;
  const mine = q.get('user') === 'me';
  if (status) oneOf(CLAIM_STATUSES, status, 'status');
  const where: string[] = [];
  const vals: unknown[] = [];
  if (device) {
    where.push('c.device_slug = ?');
    vals.push(device);
  }
  if (status) {
    where.push('c.status = ?');
    vals.push(status);
  }
  if (mine) {
    const me = await requireUser(request);
    where.push('c.user_id = ?');
    vals.push(me.id);
  }
  const page = pageParams(q, 200, 500);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows, page: info } = await paged<ClaimJoinRow>(`${CLAIM_SELECT} ${w} ORDER BY c.id DESC`, `SELECT COUNT(*) AS n FROM claims c ${w}`, vals, page);
  return json({ claims: rows.map(mapClaimRow), ...info });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const body = await readJson(request);
  const deviceSlug = str(body, 'device_slug', 64) || str(body, 'device', 64);
  if (!deviceSlug) throw new HttpError(400, 'device required', 'send {"device":"<slug>"} plus optional note');
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [deviceSlug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const existing = await queryFirst<{ id: number; status: string }>(
    "SELECT id, status FROM claims WHERE user_id = ? AND device_slug = ? AND status IN ('pending', 'approved')",
    [user.id, deviceSlug],
  );
  if (existing) {
    throw new HttpError(
      409,
      existing.status === 'approved' ? 'you already maintain this device' : 'claim already pending',
      existing.status === 'approved'
        ? `claim #${existing.id} is approved; nothing to do`
        : `claim #${existing.id} waits for an admin; DELETE /api/claims/${existing.id} to withdraw it`,
    );
  }
  // The partial unique index idx_claims_active (migrations/0003) turns a
  // racing duplicate into a UNIQUE error, which handleError maps to 409.
  const row = await queryFirst<ClaimJoinRow>(
    "INSERT INTO claims (user_id, device_slug, note, status, updated) VALUES (?, ?, ?, 'pending', ?) RETURNING *",
    [user.id, deviceSlug, str(body, 'note', 1000), nowIso()],
  );
  if (!row) throw new HttpError(500, 'claim creation failed', 'retry');
  await appendChangelog(actorName(user), `claim filed for ${deviceSlug}`);
  return json(
    { claim: mapClaimRow({ ...row, display_name: user.display_name, github_login: user.github_login }) },
    201,
  );
}

export const Route = createFileRoute('/api/claims')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
