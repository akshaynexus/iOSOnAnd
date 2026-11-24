// POST /api/auth/token-check — check a tracker token (`ion_...`, e.g. the CLI's
// stored token; no login needed): verified against api_tokens, returns the
// identity, mints nothing. A GitHub token is never accepted (400): the tracker
// signs in to GitHub only through the gist proof or the OAuth sign-in.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { queryFirst } from '@/lib/db';
import {
  HttpError,
  isExpired,
  json,
  readJson,
  sha256Hex,
  toSelfUser,
} from '@/lib/auth';
import type { ApiTokenRow, UserRow } from '@/lib/auth';

async function resolveToken(req: Request): Promise<string> {
  const body = await readJson(req);
  if (typeof body.token === 'string' && body.token.trim()) return body.token.trim();
  throw new HttpError(400, 'token required', 'send {"token": "ion_..."} with a tracker token');
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

  // A GitHub token is never accepted (the old exchange is gone): log in with the gist proof instead.
  throw new HttpError(400, 'tracker token required', 'only tracker tokens (ion_...) are checked here; the tracker never takes a GitHub token. Log in with `node cli.mjs login` (gist proof)');
}

export const Route = createFileRoute('/api/auth/token-check')({
  server: { handlers: apiHandlers({ POST: ({ request }) => handle(request) }) },
});
