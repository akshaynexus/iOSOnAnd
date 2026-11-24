// POST /api/repos/claim {repo, device?, note?, branch?, best_result?} (login;
// token scope fork:write). The repo is normalized to OWNER/REPO.
//   - your github_login is OWNER: approved at once -> 200 {claim, fork}
//   - OWNER is a GitHub organization -> 202 {claim: {id, status: "pending",
//     method: "proof-file", nonce, path: ".iosonand-verify", expires (24 h)},
//     fork}; a second POST returns the same pending claim. Verifying also
//     needs your login to be a public member of the org or a contributor.
//   - no GitHub account linked, or a personal repo of another login: 403
//   - untracked repo: `device` is required (400); a fork row is created
//     (verified fork-claim, branch/best_result from the body)
//   - another user maintains it: 409; you maintain it: 200 {already: true};
//     with `device`, that phone is added to the repo and you maintain it (at
//     once unless another user does: then an admin decides) -> device_claim
//   - approving a tracked repo for a phone it does not list adds the phone
//     the same way; its primary/merged/ported phones need no claim at all
//   - new_device {name, model?, soc?} instead of device: a phone the tracker
//     does not list, added with the claim (your own repo only: 403 else; 409
//     when the phone is listed, the hint names its slug)
// src/lib/repos.ts holds the flow; CLI repo-claim and repo-add.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, actorName, expiresIso, json, nowIso, readJson, requireUser, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { findForkByRepo, forkText, forkView, linkLineage, loadForkRow, normalizeRepo, setSupport, syncOwnSupport } from '@/lib/forks';
import {
  CLAIM_TTL_MS,
  REPO_CLAIM_SELECT,
  approveRepoClaim,
  expireStaleClaims,
  loadRepoClaim,
  mapRepoClaim,
  claimPath,
  createPhoneForClaim,
  grantSupportedPhone,
  newNonce,
  type RepoClaimRow,
} from '@/lib/repos';
import { appendChangelog } from '@/lib/changelog';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const body = await readJson(request);
  const raw = str(body, 'repo', 200);
  if (!raw) throw new HttpError(400, 'repo required', 'send {"repo":"OWNER/REPO"} plus device for a repo the tracker does not list yet');
  const repo = normalizeRepo(raw);
  if (!repo) throw new HttpError(400, 'bad repo', 'repo must look like OWNER/REPO or https://github.com/OWNER/REPO');
  let device = str(body, 'device', 64) || str(body, 'device_slug', 64) || null;
  if (device && !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [device]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const note = str(body, 'note', 1000);
  await expireStaleClaims();

  let fork = await findForkByRepo(repo);
  // A phone the tracker does not list: added here when the repo is the
  // claimer's own (approved at once), unless someone else maintains the repo.
  if (body.new_device && !device && !(fork && fork.maintainer_user_id != null && fork.maintainer_user_id !== user.id)) {
    device = await createPhoneForClaim(user, repo, body.new_device);
  }
  if (fork?.maintainer_user_id === user.id) {
    const last = await queryFirst<RepoClaimRow>(
      `${REPO_CLAIM_SELECT} WHERE rc.fork_id = ? AND rc.user_id = ? AND rc.status = 'approved' ORDER BY rc.id DESC LIMIT 1`,
      [fork.id, user.id],
    );
    // Already yours: a phone sent along is added to the repo (and to the phones you maintain).
    let device_claim = null;
    if (device && device !== fork.device_slug) {
      if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [device]))) {
        throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
      }
      const listed = await queryFirst('SELECT 1 AS ok FROM repo_devices WHERE fork_id = ? AND device_slug = ?', [fork.id, device]);
      if (!listed) {
        await setSupport(fork.id, device, 'claimed', null, 'added by the repo maintainer');
        await appendChangelog(actorName(user), `repo ${fork.repo} supports ${device} (claimed)`);
      }
      device_claim = await grantSupportedPhone(user, fork, device);
      fork = await loadForkRow(fork.id);
    }
    return json({ claim: last ? mapRepoClaim(last, user) : null, fork: await forkView(fork), already: true, ...(device_claim ? { device_claim } : {}) });
  }
  if (fork && fork.maintainer_user_id != null) {
    const m = await queryFirst<{ github_login: string | null; display_name: string }>('SELECT github_login, display_name FROM users WHERE id = ?', [
      fork.maintainer_user_id,
    ]);
    throw new HttpError(
      409,
      'repo already maintained',
      `${m?.github_login ? `@${m.github_login}` : m?.display_name || 'another user'} maintains ${fork.repo}; they (or an admin) can step down with DELETE /api/forks/${fork.id}/maintainer`,
    );
  }

  const pending = await queryFirst<RepoClaimRow>(
    `${REPO_CLAIM_SELECT} WHERE rc.user_id = ? AND rc.repo = ? COLLATE NOCASE AND rc.status = 'pending'`,
    [user.id, repo],
  );
  // The claimer's GitHub login must be the owner (or, for an organization's
  // repo, a member proving it with the file): 403 before anything is created.
  const path = await claimPath(user, repo);
  if (pending && path !== 'owner') {
    return json({ claim: mapRepoClaim(pending, user), fork: fork ? await forkView(fork) : null, already_pending: true }, 202);
  }

  let forkCreated = 0;
  if (!fork) {
    if (!device) {
      throw new HttpError(400, 'device required', `${repo} is not tracked yet: send {"repo","device":"<slug>"} so the tracker knows which phone it targets`);
    }
    const ins = await queryFirst<{ id: number }>(
      `INSERT INTO forks (device_slug, repo, branch, url, best_result, verified, notes, updated, kind)
       VALUES (?, ?, ?, ?, ?, 'fork-claim', '', ?, 'fork') RETURNING id`,
      [device, repo, forkText(body, 'branch'), `https://github.com/${repo}`, forkText(body, 'best_result'), nowIso()],
    );
    if (!ins) throw new HttpError(500, 'fork creation failed', 'retry');
    fork = await loadForkRow(ins.id);
    await syncOwnSupport({ id: fork.id, device_slug: device, kind: 'fork', verified: 'fork-claim' });
    await linkLineage(fork);
    await appendChangelog(actorName(user), `fork ${repo} added for ${device} (repo claim)`);
    forkCreated = 1;
  }

  const claimRow =
    pending ??
    (await queryFirst<RepoClaimRow>(
      `INSERT INTO repo_claims (user_id, repo, fork_id, device_slug, method, nonce, status, note, fork_created, created, expires)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?) RETURNING *`,
      [
        user.id,
        fork.repo,
        fork.id,
        device ?? fork.device_slug,
        path,
        path === 'owner' ? '' : newNonce(),
        note,
        forkCreated,
        nowIso(),
        expiresIso(CLAIM_TTL_MS),
      ],
    ));
  if (!claimRow) throw new HttpError(500, 'claim creation failed', 'retry');

  if (path === 'owner') {
    const done = await approveRepoClaim(await loadRepoClaim(claimRow.id), user, 'owner');
    return json({ claim: mapRepoClaim(done.claim, user), fork: await forkView(done.fork) });
  }
  await appendChangelog(actorName(user), `repo claim #${claimRow.id} filed for ${fork.repo} (proof file pending)`);
  return json({ claim: mapRepoClaim(await loadRepoClaim(claimRow.id), user), fork: await forkView(fork) }, 202);
}

export const Route = createFileRoute('/api/repos/claim')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
