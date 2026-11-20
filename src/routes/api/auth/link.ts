// POST /api/auth/link — bind a GitHub identity to an email/password account.
// Body {email, password, github_login?, github_id?, gist_url/gist_id, nonce?}.
// Proof: a secret gist holding a fresh challenge nonce (from gh-challenge).
// 401 bad credentials, 409 when the github_id is linked to another user.

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  findUserByEmail,
  findUserByGithubId,
  getChallenge,
  handleError,
  isExpired,
  json,
  latestChallengeFor,
  markChallengeUsed,
  nowIso,
  readJson,
  toSelfUser,
  verifyPassword,
} from '@/lib/auth';
import { fetchGitHubUserByLogin, verifyGistProof } from '@/lib/github';
import { appendChangelog } from '@/lib/changelog';

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    throw new HttpError(400, 'email and password required', 'send {"email","password","gist_url",...}');
  }
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, 'invalid email or password', 'check both fields and retry');
  }

  let githubId: number | null = null;
  let login: string | null = null;
  if (body.github_login) {
    const info = await fetchGitHubUserByLogin(String(body.github_login));
    githubId = info.id;
    login = info.login;
  } else if (body.github_id != null && String(body.github_id).trim() !== '') {
    githubId = Number(body.github_id);
    if (!Number.isInteger(githubId) || githubId <= 0) {
      throw new HttpError(400, 'bad github_id', 'send {"github_login"} or a numeric {"github_id"}');
    }
  } else {
    throw new HttpError(400, 'github identity required', 'send {"github_login": "you"} alongside the gist');
  }

  if (user.github_id === githubId) {
    return json({ user: toSelfUser(user), github_login: user.github_login, already: true });
  }

  const gistInput = String(body.gist_url || body.gist_id || '').trim();
  if (!gistInput) {
    throw new HttpError(
      400,
      'gist_url required',
      'POST /api/auth/gh-challenge with your github_login, put the nonce in a secret gist, then send its URL here',
    );
  }
  const ch = body.nonce ? await getChallenge(String(body.nonce)) : await latestChallengeFor(githubId);
  if (!ch || ch.used || isExpired(ch.expires) || Number(ch.github_id) !== githubId) {
    throw new HttpError(
      410,
      'challenge expired or unknown',
      'POST /api/auth/gh-challenge with {"github_login": "you"} first, then retry',
    );
  }
  const proof = await verifyGistProof({ gistIdInput: gistInput, githubId, nonce: ch.nonce });

  const taken = await findUserByGithubId(githubId);
  if (taken && taken.id !== user.id) {
    throw new HttpError(
      409,
      'github already linked',
      `that github account (@${proof.ownerLogin || githubId}) is linked to another user; unlink it there first`,
    );
  }
  await exec('UPDATE users SET github_id = ?, github_login = ?, github_linked_at = ? WHERE id = ?', [
    githubId,
    proof.ownerLogin || login || null,
    nowIso(),
    user.id,
  ]);
  await markChallengeUsed(ch.nonce, proof.gistId);
  const updated = {
    ...user,
    github_id: githubId,
    github_login: proof.ownerLogin || login || null,
  };
  await appendChangelog(actorName(updated), `linked github @${proof.ownerLogin || githubId}`);
  return json({ user: toSelfUser(updated), github_login: updated.github_login });
}

export const Route = createFileRoute('/api/auth/link')({
  server: {
    handlers: {
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
