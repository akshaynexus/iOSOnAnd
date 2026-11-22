// POST /api/auth/gh-verify — complete gist-proof login.
// Accepts {github_login?, github_id?, gist_url?/gist_id?, nonce?} (any combo;
// the CLI sends {github_login, gist_url, nonce}, the UI sends {gist_url}).
// Verifies the gist, auto-creates the user on first login, and returns a
// tracker token plus a session cookie. 410 when the challenge is stale.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import {
  HttpError,
  actorName,
  createSession,
  createUser,
  findUserByGithubId,
  getChallenge,
  isExpired,
  json,
  latestChallengeFor,
  consumeChallenge,
  mintApiToken,
  readJson,
  sessionCookieHeader,
  toSelfUser,
} from '@/lib/auth';
import type { ChallengeRow } from '@/lib/auth';
import { fetchGist, fetchGitHubUserByLogin, verifyGistProof } from '@/lib/github';
import { appendChangelog } from '@/lib/changelog';

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson(req);
  const gistInput = String(body.gist_url || body.gist_id || '').trim();
  if (!gistInput) {
    throw new HttpError(
      400,
      'gist_url required',
      'create a secret gist holding your challenge nonce, then send its URL as {"gist_url": ...}',
    );
  }

  // Resolve who is proving. Explicit identity wins; otherwise derive from gist owner.
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
  }

  let ch: ChallengeRow | null = null;
  if (body.nonce) ch = await getChallenge(String(body.nonce));
  else if (githubId) ch = await latestChallengeFor(githubId);
  else {
    const gist = await fetchGist(gistInput);
    const ownerId = Number(gist?.owner?.id);
    if (Number.isInteger(ownerId) && ownerId > 0) ch = await latestChallengeFor(ownerId);
  }
  if (!ch || ch.used || isExpired(ch.expires)) {
    throw new HttpError(
      410,
      'challenge expired or unknown',
      'POST /api/auth/gh-challenge for a fresh nonce, put it in a new secret gist, then retry',
    );
  }
  githubId = githubId ?? Number(ch.github_id);
  if (Number(ch.github_id) !== githubId) {
    throw new HttpError(
      422,
      'challenge identity mismatch',
      'the nonce belongs to a different github account; request a fresh challenge as the right user',
    );
  }

  const proof = await verifyGistProof({ gistIdInput: gistInput, githubId, nonce: ch.nonce });
  await consumeChallenge(ch.nonce, proof.gistId);

  let user = await findUserByGithubId(githubId);
  let isNew = false;
  if (!user) {
    isNew = true;
    user = await createUser({
      displayName: proof.ownerLogin || login || `gh-${githubId}`,
      githubId,
      githubLogin: proof.ownerLogin || login || null,
    });
  }
  const { token } = await mintApiToken(user.id, 'cli');
  const sess = await createSession(user.id);
  await appendChangelog(
    actorName(user),
    isNew
      ? `github login: new account bound to @${proof.ownerLogin || githubId}`
      : `github login via gist proof (@${proof.ownerLogin || githubId})`,
  );
  return json(
    {
      token,
      user: toSelfUser(user),
      login: proof.ownerLogin || login || null,
      note: 'store the token now; the plaintext is never shown again',
    },
    200,
    { 'set-cookie': sessionCookieHeader(sess.token, req) },
  );
}

export const Route = createFileRoute('/api/auth/gh-verify')({
  server: { handlers: apiHandlers({ POST: ({ request }) => handlePost(request) }) },
});
