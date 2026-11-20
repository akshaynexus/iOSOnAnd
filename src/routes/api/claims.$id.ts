// /api/claims/$id — GET one, PATCH status (admin), DELETE withdraw
// (claimant while pending, else admin). Claim views expose `user` (display
// label) matching the UI shape.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  findUserById,
  handleError,
  json,
  nowIso,
  readJson,
  requireAdmin,
  requireUser,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { Claim } from '@/lib/types';

type Ctx = { request: Request; params: Record<string, string> };

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'];

export interface ClaimView {
  id: number;
  device_slug: string;
  user: string;
  note: string;
  status: string;
  updated: string;
}

export function claimLabel(
  displayName: string | null | undefined,
  githubLogin: string | null | undefined,
  userId: number,
): string {
  if (displayName) return displayName;
  if (githubLogin) return `@${githubLogin}`;
  return `user#${userId}`;
}

export function mapClaimRow(
  c: Claim & { display_name?: string | null; github_login?: string | null },
): ClaimView {
  return {
    id: c.id,
    device_slug: c.device_slug,
    user: claimLabel(c.display_name, c.github_login, c.user_id),
    note: c.note,
    status: c.status,
    updated: c.updated,
  };
}

export async function loadClaim(id: string): Promise<Claim> {
  if (!/^\d+$/.test(id)) throw new HttpError(404, 'unknown claim', 'claim ids are numeric');
  const row = await queryFirst<Claim>('SELECT * FROM claims WHERE id = ?', [Number(id)]);
  if (!row) throw new HttpError(404, 'unknown claim', 'GET /api/claims to list claims');
  return row;
}

async function labelFor(userId: number): Promise<{ display_name: string | null; github_login: string | null }> {
  const u = await findUserById(userId);
  return { display_name: u?.display_name ?? null, github_login: u?.github_login ?? null };
}

async function handleGet(_req: Request, params: Record<string, string>): Promise<Response> {
  const claim = await loadClaim(params.id);
  const who = await labelFor(claim.user_id);
  return json({ claim: mapClaimRow({ ...claim, ...who }) });
}

async function handlePatch(req: Request, params: Record<string, string>): Promise<Response> {
  const admin = await requireAdmin(req);
  const claim = await loadClaim(params.id);
  const body = await readJson(req);
  const status = String(body.status || '');
  if (!CLAIM_STATUSES.includes(status)) {
    throw new HttpError(400, 'bad status', `status must be one of: ${CLAIM_STATUSES.join(' | ')}`);
  }
  await exec('UPDATE claims SET status = ?, updated = ? WHERE id = ?', [status, nowIso(), claim.id]);
  const row = await queryFirst<Claim>('SELECT * FROM claims WHERE id = ?', [claim.id]);
  if (!row) throw new HttpError(500, 'claim update failed', 'retry');
  const who = await labelFor(row.user_id);
  await appendChangelog(actorName(admin), `claim #${claim.id} -> ${status} (${claim.device_slug})`);
  return json({ claim: mapClaimRow({ ...row, ...who }) });
}

async function handleDelete(req: Request, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(req);
  const claim = await loadClaim(params.id);
  const ownPending = claim.user_id === user.id && claim.status === 'pending';
  if (!ownPending && !user.is_admin) {
    throw new HttpError(403, 'cannot withdraw', 'only the claimant (while pending) or an admin can delete a claim');
  }
  await exec('DELETE FROM claims WHERE id = ?', [claim.id]);
  await appendChangelog(actorName(user), `claim #${claim.id} withdrawn`);
  return json({ deleted: claim.id });
}

export const Route = createFileRoute('/api/claims/$id')({
  server: {
    handlers: {
  GET: async ({ request, params }: Ctx) => {
    try {
      return await handleGet(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
  PATCH: async ({ request, params }: Ctx) => {
    try {
      return await handlePatch(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
  DELETE: async ({ request, params }: Ctx) => {
    try {
      return await handleDelete(request, params);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
