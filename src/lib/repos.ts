// src/lib/repos.ts — repo ownership: claims on a repo, their approval, and
// the maintainer of a fork row (forks.maintainer_user_id).
//
// Flow (POST /api/repos/claim {repo, device?, note?}):
//   - the user's github_login equals OWNER (case-insensitive): approved at
//     once, method 'owner' (the GitHub account was proven at login).
//   - else a pending 'proof-file' claim with a nonce, 24 h: write the nonce
//     alone to .iosonand-verify on the default branch, then POST
//     /api/repos/claim/{id}/verify (src/lib/repoproof.ts reads it).
//   - an admin may approve (method becomes 'admin') or reject a pending claim.
//   - an untracked repo needs `device`; the claim creates its fork row
//     (fork_created = 1), which is removed again when the claim is rejected
//     or expires before anyone maintains the repo.
// On approval: forks.maintainer_user_id/maintainer_since, an approved device
// claim for the fork's device (the user becomes its maintainer; its id is
// kept in repo_claims.device_claim_id), and a changelog line.

import { queryAll, queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, env, isAdmin, nowIso, randomTokenString } from '@/lib/auth';
import type { UserRow } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import { findForkByRepo, loadForkRow, syncOwnSupport, type ForkRow } from '@/lib/forks';
import { PROOF_PATH } from '@/lib/repoproof';

export const CLAIM_TTL_MS = 24 * 3600 * 1000;

export interface RepoClaimRow {
  id: number;
  user_id: number;
  repo: string;
  fork_id: number | null;
  device_slug: string | null;
  method: string;
  nonce: string;
  status: string;
  note: string;
  fork_created: number;
  device_claim_id: number | null;
  created: string;
  expires: string | null;
  decided: string | null;
  display_name?: string | null;
  github_login?: string | null;
}

export const REPO_CLAIM_SELECT = `SELECT rc.*, u.display_name, u.github_login FROM repo_claims rc LEFT JOIN users u ON u.id = rc.user_id`;

/** API shape. The nonce is shown to the claimant and admins, and only while the claim is pending. */
export function mapRepoClaim(r: RepoClaimRow, viewer: UserRow | null) {
  const own = !!viewer && (viewer.id === r.user_id || isAdmin(viewer));
  const pending = r.status === 'pending';
  return {
    id: r.id,
    repo: r.repo,
    fork_id: r.fork_id,
    device_slug: r.device_slug,
    user_id: r.user_id,
    user: { id: r.user_id, display_name: r.display_name ?? '', github_login: r.github_login ?? null },
    method: r.method,
    status: r.status,
    note: r.note ?? '',
    nonce: own && pending && r.method === 'proof-file' ? r.nonce : null,
    path: PROOF_PATH,
    created: r.created,
    expires: r.expires,
    decided: r.decided,
  };
}

export async function loadRepoClaim(id: string | number): Promise<RepoClaimRow> {
  if (!/^\d{1,15}$/.test(String(id))) throw new HttpError(404, 'unknown repo claim', 'repo claim ids are numeric');
  const r = await queryFirst<RepoClaimRow>(`${REPO_CLAIM_SELECT} WHERE rc.id = ?`, [Number(id)]);
  if (!r) throw new HttpError(404, 'unknown repo claim', 'GET /api/repos/claims lists your claims');
  return r;
}

/** Remove a fork row a claim created, when nobody maintains it and no other claim waits on it. */
async function dropCreatedFork(forkId: number | null, exceptClaim: number): Promise<void> {
  if (!forkId) return;
  const f = await queryFirst<{ maintainer_user_id: number | null }>('SELECT maintainer_user_id FROM forks WHERE id = ?', [forkId]);
  if (!f || f.maintainer_user_id != null) return;
  const other = await queryFirst(
    "SELECT 1 AS ok FROM repo_claims WHERE fork_id = ? AND id != ? AND status IN ('pending', 'approved') LIMIT 1",
    [forkId, exceptClaim],
  );
  if (other) return;
  const used = await queryFirst(
    'SELECT 1 AS ok FROM media WHERE fork_id = ? UNION SELECT 1 FROM repo_devices WHERE via_fork_id = ? UNION SELECT 1 FROM repo_lineage WHERE base_fork_id = ? LIMIT 1',
    [forkId, forkId, forkId],
  );
  if (used) return;
  await exec('DELETE FROM repo_devices WHERE fork_id = ?', [forkId]);
  await exec('UPDATE repo_lineage SET fork_id = NULL WHERE fork_id = ?', [forkId]);
  await exec('UPDATE repo_claims SET fork_id = NULL WHERE fork_id = ?', [forkId]);
  await exec('DELETE FROM forks WHERE id = ?', [forkId]);
}

/** Mark pending claims past their expiry 'expired' (and drop the forks they created). Cheap: indexed. */
export async function expireStaleClaims(): Promise<void> {
  const now = nowIso();
  const gone = await queryAll<{ id: number; fork_id: number | null; fork_created: number }>(
    "UPDATE repo_claims SET status = 'expired', decided = ? WHERE status = 'pending' AND expires IS NOT NULL AND expires < ? RETURNING id, fork_id, fork_created",
    [now, now],
  );
  for (const g of gone) if (g.fork_created) await dropCreatedFork(g.fork_id, g.id);
}

export function newNonce(): string {
  return `iosonand-verify-${randomTokenString(18)}`;
}

/** Owner check: the user's proven GitHub login is the repo's owner. */
export function ownsRepo(user: UserRow, repo: string): boolean {
  const owner = repo.split('/')[0].toLowerCase();
  return !!user.github_login && user.github_login.toLowerCase() === owner;
}

/**
 * Approve a pending claim (atomically: a claim is approved once). Sets the
 * fork's maintainer, grants the device claim, writes the changelog. 409 when
 * the repo got another maintainer meanwhile.
 */
export async function approveRepoClaim(claim: RepoClaimRow, actor: UserRow, method: string): Promise<{ claim: RepoClaimRow; fork: ForkRow }> {
  const fork = claim.fork_id ? await loadForkRow(claim.fork_id) : await findForkByRepo(claim.repo);
  if (!fork) throw new HttpError(409, 'repo no longer tracked', 'claim it again; an untracked repo needs a device');
  if (fork.maintainer_user_id != null && fork.maintainer_user_id !== claim.user_id) {
    throw new HttpError(409, 'repo already maintained', 'another user maintains it now; an admin can remove them: DELETE /api/forks/<id>/maintainer');
  }
  const now = nowIso();
  const gate = await queryFirst<{ id: number }>(
    "UPDATE repo_claims SET status = 'approved', method = ?, decided = ?, fork_id = ? WHERE id = ? AND status = 'pending' RETURNING id",
    [method, now, fork.id, claim.id],
  );
  if (!gate) throw new HttpError(409, 'claim not pending', 'it was approved, rejected or expired by another request');
  const set = await queryFirst<{ id: number }>(
    `UPDATE forks SET maintainer_user_id = ?, maintainer_since = COALESCE(CASE WHEN maintainer_user_id = ? THEN maintainer_since END, ?),
       device_slug = COALESCE(device_slug, ?), updated = ?
     WHERE id = ? AND (maintainer_user_id IS NULL OR maintainer_user_id = ?) RETURNING id`,
    [claim.user_id, claim.user_id, now, claim.device_slug, now, fork.id, claim.user_id],
  );
  if (!set) {
    await exec("UPDATE repo_claims SET status = 'pending', decided = NULL WHERE id = ?", [claim.id]);
    throw new HttpError(409, 'repo already maintained', 'another user became its maintainer first');
  }
  const updated = await loadForkRow(fork.id);
  if (updated.device_slug !== fork.device_slug) await syncOwnSupport(updated);
  // The device claim: the repo maintainer maintains the fork's device too.
  let deviceClaimId: number | null = null;
  if (updated.device_slug) {
    const dc = await queryFirst<{ id: number; status: string }>(
      "SELECT id, status FROM claims WHERE user_id = ? AND device_slug = ? AND status IN ('pending', 'approved')",
      [claim.user_id, updated.device_slug],
    );
    if (!dc) {
      const ins = await queryFirst<{ id: number }>(
        "INSERT INTO claims (user_id, device_slug, note, status, updated) VALUES (?, ?, ?, 'approved', ?) RETURNING id",
        [claim.user_id, updated.device_slug, `maintainer of ${updated.repo} (repo claim #${claim.id})`, now],
      );
      deviceClaimId = ins?.id ?? null;
    } else if (dc.status === 'pending') {
      await exec("UPDATE claims SET status = 'approved', updated = ? WHERE id = ?", [now, dc.id]);
      deviceClaimId = dc.id;
    }
  }
  if (deviceClaimId) await exec('UPDATE repo_claims SET device_claim_id = ? WHERE id = ?', [deviceClaimId, claim.id]);
  const who = claim.github_login ? `@${claim.github_login}` : claim.display_name || `user#${claim.user_id}`;
  await appendChangelog(
    actorName(actor),
    `repo ${updated.repo} maintained by ${who} (${method}${updated.device_slug ? `; maintains ${updated.device_slug}` : ''})`,
  );
  return { claim: await loadRepoClaim(claim.id), fork: updated };
}

export async function rejectRepoClaim(claim: RepoClaimRow, actor: UserRow): Promise<RepoClaimRow> {
  const gate = await queryFirst<{ id: number }>(
    "UPDATE repo_claims SET status = 'rejected', decided = ? WHERE id = ? AND status = 'pending' RETURNING id",
    [nowIso(), claim.id],
  );
  if (!gate) throw new HttpError(409, `claim already ${claim.status}`, 'only pending claims can be rejected');
  if (claim.fork_created) await dropCreatedFork(claim.fork_id, claim.id);
  await appendChangelog(actorName(actor), `repo claim #${claim.id} rejected (${claim.repo})`);
  return loadRepoClaim(claim.id);
}

/**
 * Remove a repo's maintainer (admin, or the maintainer). The device claim the
 * repo claim granted goes too, unless the user maintains another repo of
 * that device.
 */
export async function removeMaintainer(fork: ForkRow, actor: UserRow): Promise<ForkRow> {
  const uid = fork.maintainer_user_id;
  if (uid == null) throw new HttpError(404, 'no maintainer', `${fork.repo} has no maintainer`);
  if (!isAdmin(actor) && actor.id !== uid) throw new HttpError(403, 'not the maintainer', 'only an admin or the maintainer can remove the maintainer');
  await exec('UPDATE forks SET maintainer_user_id = NULL, maintainer_since = NULL, updated = ? WHERE id = ?', [nowIso(), fork.id]);
  const granted = await queryAll<{ device_claim_id: number }>(
    "SELECT device_claim_id FROM repo_claims WHERE fork_id = ? AND user_id = ? AND status = 'approved' AND device_claim_id IS NOT NULL",
    [fork.id, uid],
  );
  for (const g of granted) {
    const dc = await queryFirst<{ device_slug: string }>('SELECT device_slug FROM claims WHERE id = ?', [g.device_claim_id]);
    if (!dc) continue;
    const other = await queryFirst('SELECT 1 AS ok FROM forks WHERE maintainer_user_id = ? AND device_slug = ? LIMIT 1', [uid, dc.device_slug]);
    if (!other) await exec('DELETE FROM claims WHERE id = ?', [g.device_claim_id]);
  }
  await exec("UPDATE repo_claims SET device_claim_id = NULL WHERE fork_id = ? AND user_id = ? AND status = 'approved'", [fork.id, uid]);
  await appendChangelog(actorName(actor), `repo ${fork.repo} maintainer removed`);
  return loadForkRow(fork.id);
}

/** Headers for the GitHub contents API (GITHUB_TOKEN raises its rate limit). */
export function githubApiHeaders(): Record<string, string> {
  const tok = env('GITHUB_TOKEN');
  return tok ? { authorization: `Bearer ${tok}` } : {};
}
