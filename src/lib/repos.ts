// src/lib/repos.ts — repo ownership: claims on a repo, their approval, and
// the maintainer of a fork row (forks.maintainer_user_id).
//
// Who may claim (claimPath): the claimer's GitHub login, proven with a gist
// when it was linked, must be the repo's owner.
//   - the user's github_login equals OWNER (case-insensitive): approved at
//     once, method 'owner'.
//   - OWNER is a GitHub organization (its name is never a user's login): a
//     pending 'proof-file' claim with a nonce, 24 h. Verifying needs the file
//     (write the nonce alone to .iosonand-verify on the default branch, then
//     POST /api/repos/claim/{id}/verify; src/lib/repoproof.ts reads it) and
//     the claimer's login being a public member of the organization or a
//     contributor to the repo.
//   - anyone else: 403 (no GitHub account linked, or a personal repo of
//     another login). Before this rule a proof file alone was enough, so a
//     collaborator could claim someone else's personal repo.
//   - an admin may approve (method becomes 'admin') or reject a pending claim.
//   - an untracked repo needs `device`; the claim creates its fork row
//     (fork_created = 1), which is removed again when the claim is rejected
//     or expires before anyone maintains the repo.
// On approval: forks.maintainer_user_id/maintainer_since, an approved device
// claim for the fork's device (the user becomes its maintainer; its id is
// kept in repo_claims.device_claim_id), and a changelog line.

import { queryAll, queryFirst, exec } from '@/lib/db';
import { HttpError, MAINTAINERS_SQL, actorName, env, isAdmin, isMaintainer, nowIso, randomTokenString } from '@/lib/auth';
import type { UserRow } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import { findForkByRepo, loadForkRow, setSupport, syncOwnSupport, type ForkRow } from '@/lib/forks';
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

/** A GitHub owner's account type, or null when there is no such owner. */
export async function githubOwnerType(owner: string): Promise<'User' | 'Organization' | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'iOSOnAnd-tracker/1.0', ...githubApiHeaders() },
    });
  } catch (e) {
    throw new HttpError(502, 'github unreachable', `could not look up @${owner} on GitHub (${e instanceof Error ? e.message : String(e)}); retry`);
  }
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new HttpError(503, 'github rate limited', 'wait a minute and retry (the server can set GITHUB_TOKEN to raise the limit)');
  if (!res.ok) throw new HttpError(502, `github error ${res.status}`, 'retry in a bit');
  const body = (await res.json()) as { type?: string };
  return body.type === 'Organization' ? 'Organization' : 'User';
}

/** True when `login` is a public member of `org`, or a contributor to `repo`. */
export async function isOrgMemberOrContributor(org: string, repo: string, login: string): Promise<boolean> {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'iOSOnAnd-tracker/1.0', ...githubApiHeaders() };
  try {
    const m = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/public_members/${encodeURIComponent(login)}`, { headers });
    if (m.status === 204) return true;
    const [o, n] = repo.split('/');
    for (let page = 1; page <= 5; page++) {
      const c = await fetch(`https://api.github.com/repos/${encodeURIComponent(o)}/${encodeURIComponent(n)}/contributors?per_page=100&page=${page}`, { headers });
      if (!c.ok) break;
      const rows = (await c.json()) as Array<{ login?: string }>;
      if (rows.some((r) => (r.login ?? '').toLowerCase() === login.toLowerCase())) return true;
      if (rows.length < 100) break;
    }
  } catch (e) {
    throw new HttpError(502, 'github unreachable', `could not check @${login} in ${org} (${e instanceof Error ? e.message : String(e)}); retry`);
  }
  return false;
}

/**
 * How `user` may claim `repo`: 'owner' (approved at once) or 'proof-file' (an
 * organization's repo). 403 for anyone else; see the header.
 */
export async function claimPath(user: UserRow, repo: string): Promise<'owner' | 'proof-file'> {
  if (ownsRepo(user, repo)) return 'owner';
  const owner = repo.split('/')[0];
  if (!user.github_login) {
    throw new HttpError(
      403,
      'link your GitHub account first',
      `a repo is claimed by its GitHub owner: link your GitHub account (node cli.mjs link, or your profile page); if you are @${owner}, the claim of ${repo} is then approved at once`,
    );
  }
  const type = await githubOwnerType(owner);
  if (type === 'Organization') return 'proof-file';
  if (type === null) throw new HttpError(404, 'no such GitHub owner', `GitHub has no user or organization @${owner}; check the repo name`);
  throw new HttpError(
    403,
    'not the repo owner',
    `${repo} belongs to @${owner} and you are linked as @${user.github_login}: only @${owner} can claim it. If it is your repo under another account, link that account; otherwise ask an admin`,
  );
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
  // A tracked repo claimed for another phone (e.g. OneiOS for a second
  // Galaxy): list that phone on the repo and make the maintainer its
  // maintainer too (grantSupportedPhone: at once unless someone else has it).
  if (claim.device_slug && claim.device_slug !== updated.device_slug) {
    const listed = await queryFirst('SELECT 1 AS ok FROM repo_devices WHERE fork_id = ? AND device_slug = ?', [updated.id, claim.device_slug]);
    if (!listed) await setSupport(updated.id, claim.device_slug, 'claimed', null, `repo claim #${claim.id}`);
    const claimant = await queryFirst<UserRow>('SELECT * FROM users WHERE id = ?', [claim.user_id]);
    if (claimant) await grantSupportedPhone(claimant, updated, claim.device_slug);
  }
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
  // Phones they added to this repo themselves go too (the ones an admin
  // recorded follow the repo's maintainer anyway: MAINTAINERS_SQL).
  await exec('DELETE FROM claims WHERE user_id = ? AND note = ?', [uid, supportedPhoneNote(fork.repo)]);
  await appendChangelog(actorName(actor), `repo ${fork.repo} maintainer removed`);
  return loadForkRow(fork.id);
}

/** A device slug from a phone name: "Redmi Note 7" -> "redmi-note-7". */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(samsung\s+)?galaxy\s+|^google\s+/, '')
    .replace(/\+/g, '-plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * A phone the tracker does not list yet, added with the claim of the
 * porter's own repo ({name, model?, soc?}). 409 when a phone of that name or
 * slug exists (the hint names it). Only for a repo the claimer's GitHub login
 * owns (or an admin): the claim is then approved at once, so the new phone
 * never waits on a claim that may be rejected.
 */
export async function createPhoneForClaim(user: UserRow, repo: string, input: unknown): Promise<string> {
  const nd = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = String(nd.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 3) throw new HttpError(400, 'phone name required', 'send new_device: {"name": "Redmi Note 7", "model": "lavender", "soc": "Snapdragon 660"}');
  if (!ownsRepo(user, repo) && !isAdmin(user)) {
    throw new HttpError(
      403,
      'a new phone needs your own repo',
      `a phone the tracker does not list is added with the claim of a repo your GitHub login owns; for ${repo}, pick a listed phone or ask an admin to add it`,
    );
  }
  const slug = slugFromName(name);
  if (!slug) throw new HttpError(400, 'bad phone name', 'use letters and digits, e.g. "Redmi Note 7"');
  const dup = await queryFirst<{ slug: string; name: string }>('SELECT slug, name FROM devices WHERE slug = ? OR name = ? COLLATE NOCASE', [slug, name]);
  if (dup) throw new HttpError(409, 'phone already listed', `${dup.name} is listed as ${dup.slug}: send {"device":"${dup.slug}"} instead`);
  const text = (k: string, max: number) => String(nd[k] ?? '').trim().slice(0, max);
  await exec(
    `INSERT INTO devices (slug, name, model, soc, repo_kind, status, best_result, notes, updated, base)
     VALUES (?, ?, ?, ?, 'fork', 'unknown', '', ?, ?, 'other')`,
    [slug, name, text('model', 60), text('soc', 80), `Added with the claim of ${repo}.`, nowIso().slice(0, 10)],
  );
  await appendChangelog(actorName(user), `device ${slug} (${name}) added with the claim of ${repo}`);
  return slug;
}

/** The note on a device claim made for a phone a repo maintainer added to their repo. */
export const supportedPhoneNote = (repo: string) => `maintainer of ${repo} (supported phone)`;

/**
 * A repo's maintainer added `device` to the repo ("claimed" support): make
 * them its maintainer too. Approved at once when nobody else maintains the
 * phone; otherwise a pending device claim for an admin, so adding a phone to
 * your repo cannot take a phone over from its maintainer.
 */
export async function grantSupportedPhone(
  user: UserRow,
  fork: ForkRow,
  device: string,
): Promise<{ status: 'approved' | 'pending'; claim_id: number | null; already?: boolean }> {
  if (await isMaintainer(user.id, device)) return { status: 'approved', claim_id: null, already: true };
  const mine = await queryFirst<{ id: number; status: 'approved' | 'pending' }>(
    "SELECT id, status FROM claims WHERE user_id = ? AND device_slug = ? AND status IN ('pending', 'approved')",
    [user.id, device],
  );
  if (mine) return { status: mine.status, claim_id: mine.id, already: true };
  const taken = await queryFirst(`SELECT 1 AS ok FROM (${MAINTAINERS_SQL}) WHERE device_slug = ? AND uid != ? LIMIT 1`, [device, user.id]);
  const status = taken ? 'pending' : 'approved';
  const ins = await queryFirst<{ id: number }>(
    'INSERT INTO claims (user_id, device_slug, note, status, updated) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [user.id, device, supportedPhoneNote(fork.repo), status, nowIso()],
  );
  await appendChangelog(
    actorName(user),
    status === 'approved' ? `maintains ${device} (added it to ${fork.repo})` : `claims ${device} (added it to ${fork.repo}; another user maintains it, an admin decides)`,
  );
  return { status, claim_id: ins?.id ?? null };
}

/** Headers for the GitHub contents API (GITHUB_TOKEN raises its rate limit). */
export function githubApiHeaders(): Record<string, string> {
  const tok = env('GITHUB_TOKEN');
  return tok ? { authorization: `Bearer ${tok}` } : {};
}
