// src/lib/claims.ts — load and review claims (shared by /api/claims/:id routes).

import { queryFirst, exec } from '@/lib/db';
import { CLAIM_STATUSES, HttpError, actorName, json, nowIso, oneOf, requireAdmin } from '@/lib/auth';
import { CLAIM_SELECT, mapClaimRow, type ClaimJoinRow } from '@/lib/devices';
import { appendChangelog } from '@/lib/changelog';

export async function loadClaim(id: string): Promise<ClaimJoinRow> {
  if (!/^\d{1,15}$/.test(id)) throw new HttpError(404, 'unknown claim', 'claim ids are numeric');
  const row = await queryFirst<ClaimJoinRow>(`${CLAIM_SELECT} WHERE c.id = ?`, [Number(id)]);
  if (!row) throw new HttpError(404, 'unknown claim', 'GET /api/claims to list claims');
  return row;
}

/** Set a claim's review status (admin). Shared by PATCH and approve/reject. */
export async function reviewClaim(
  request: Request,
  id: string,
  status: string,
  onlyPending: boolean,
): Promise<Response> {
  const admin = await requireAdmin(request);
  oneOf(CLAIM_STATUSES, status, 'status');
  const claim = await loadClaim(id);
  if (onlyPending && claim.status !== 'pending') {
    throw new HttpError(409, `claim already ${claim.status}`, 'only pending claims can be reviewed this way');
  }
  if (status !== 'rejected' && claim.status !== status) {
    // Re-activating must not create a second active claim for the same pair.
    const other = await queryFirst(
      "SELECT id FROM claims WHERE user_id = ? AND device_slug = ? AND status IN ('pending', 'approved') AND id != ?",
      [claim.user_id, claim.device_slug, claim.id],
    );
    if (other) throw new HttpError(409, 'user already has an active claim on this device', 'review that claim instead');
  }
  await exec('UPDATE claims SET status = ?, updated = ? WHERE id = ?', [status, nowIso(), claim.id]);
  await appendChangelog(actorName(admin), `claim #${claim.id} ${status} (${claim.device_slug})`);
  return json({ claim: mapClaimRow(await loadClaim(id)) });
}

