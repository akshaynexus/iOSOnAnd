// POST /api/auth/token-check — dual-mode token validation (no login needed).
// - Tracker token (`ion_...`, e.g. from the stored CLI token): verified
//   against api_tokens, returns identity, mints nothing.
// - GitHub token (`gh auth token` output): verified via the GitHub API, then
//   exchanged for a tracker token (auto-creates the user on first use).
// Response always includes login/github_login/email when known.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { queryFirst } from '@/lib/db';
import {
  HttpError,
  actorName,
  createUser,
  findUserByGithubId,
  isExpired,
  json,
  mintApiToken,
  readJson,
  sha256Hex,
  toSelfUser,
} from '@/lib/auth';
import type { ApiTokenRow, UserRow } from '@/lib/auth';
import { fetchGitHubUser } from '@/lib/github';
import { appendChangelog } from '@/lib/changelog';

async function resolveToken(req: Request): Promise<string> {
  const body = await readJson(req);
  if (typeof body.token === 'string' && body.token.trim()) return body.token.trim();
  throw new HttpError(400, 'token required', 'send {"token"} with a tracker token or `gh auth token` value');
}

async function handle(req: Request): Promise<Response> {
  const token = await resolveToken(req);

  if (token.startsWith('ion_')) {
    const t = await queryFirst<ApiTokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?', [
      await sha256Hex(token),
    ]);
    if (!t || Number(t.revoked) !== 0 || isExpired(t.expires)) {
      throw new HttpError(401, 'invalid tracker token', 'run `node ./cli.mjs login` for a fresh one');
    }
    const user = await queryFirst<UserRow>('SELECT * FROM users WHERE id = ?', [t.user_id]);
    if (!user) throw new HttpError(401, 'invalid tracker token', 'the owning account is gone; log in again');
    return json({
      valid: true,
      login: user.github_login || user.display_name || `user#${user.id}`,
      github_login: user.github_login,
      email: user.email,
      user: toSelfUser(user),
    });
  }

  // Otherwise: a GitHub token to verify + exchange (warned fallback).
  const info = await fetchGitHubUser(token);
  let user = await findUserByGithubId(info.id);
  if (!user) {
    user = await createUser({ displayName: info.login, githubId: info.id, githubLogin: info.login });
    await appendChangelog(actorName(user), `github login: new account bound to @${info.login} (token exchange)`);
  }
  const minted = await mintApiToken(user.id, 'token-check');
  return json({
    valid: true,
    token: minted.token,
    login: info.login,
    github_login: info.login,
    email: user.email,
    note: 'store the token now; the plaintext is never shown again',
  });
}

export const Route = createFileRoute('/api/auth/token-check')({
  server: { handlers: apiHandlers({ POST: ({ request }) => handle(request) }) },
});
