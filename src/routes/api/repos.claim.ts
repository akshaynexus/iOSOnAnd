// POST /api/repos/claim {repo, device?, note?, branch?, best_result?} (login;
// token scope fork:write). The repo is normalized to OWNER/REPO.
//   - your github_login is OWNER: approved at once -> 200 {claim, fork}
//   - else -> 202 {claim: {id, status: "pending", method: "proof-file", nonce,
//     path: ".iosonand-verify", expires (24 h)}, fork}; a second POST returns
//     the same pending claim
//   - untracked repo: `device` is required (400); a fork row is created
//     (verified fork-claim, branch/best_result from the body)
//   - another user maintains it: 409; you maintain it: 200 {already: true}
// src/lib/repos.ts holds the flow; CLI repo-claim and repo-add.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, actorName, expiresIso, json, nowIso, readJson, requireUser, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { findForkByRepo, forkText, forkView, linkLineage, loadForkRow, normalizeRepo, syncOwnSupport } from '@/lib/forks';
import {
  CLAIM_TTL_MS,
  REPO_CLAIM_SELECT,
  approveRepoClaim,
  expireStaleClaims,
  loadRepoClaim,
  mapRepoClaim,
  newNonce,
  ownsRepo,
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
  const device = str(body, 'device', 64) || str(body, 'device_slug', 64) || null;
  if (device && !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [device]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const note = str(body, 'note', 1000);
  await expireStaleClaims();

  let fork = await findForkByRepo(repo);
  if (fork?.maintainer_user_id === user.id) {
    const last = await queryFirst<RepoClaimRow>(
      `${REPO_CLAIM_SELECT} WHERE rc.fork_id = ? AND rc.user_id = ? AND rc.status = 'approved' ORDER BY rc.id DESC LIMIT 1`,
      [fork.id, user.id],
    );
    return json({ claim: last ? mapRepoClaim(last, user) : null, fork: await forkView(fork), already: true });
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
  if (pending && !ownsRepo(user, repo)) {
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
        ownsRepo(user, repo) ? 'owner' : 'proof-file',
        ownsRepo(user, repo) ? '' : newNonce(),
        note,
        forkCreated,
        nowIso(),
        expiresIso(CLAIM_TTL_MS),
      ],
    ));
  if (!claimRow) throw new HttpError(500, 'claim creation failed', 'retry');

  if (ownsRepo(user, repo)) {
    const done = await approveRepoClaim(await loadRepoClaim(claimRow.id), user, 'owner');
    return json({ claim: mapRepoClaim(done.claim, user), fork: await forkView(done.fork) });
  }
  await appendChangelog(actorName(user), `repo claim #${claimRow.id} filed for ${fork.repo} (proof file pending)`);
  return json({ claim: mapRepoClaim(await loadRepoClaim(claimRow.id), user), fork: await forkView(fork) }, 202);
}

export const Route = createFileRoute('/api/repos/claim')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
