// src/lib/githubOAuth.ts — "Continue with GitHub" (GitHub OAuth web flow).
//
// Setup: a GitHub OAuth App (github.com/settings/developers) whose callback
// URL is <PUBLIC_URL>/api/auth/github/callback, and the Worker secrets
// GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET. Without them the flow is off
// (GET /api/auth/github says {enabled: false}) and the gist proof stays the
// only way to link GitHub.
//
// Flow: /api/auth/github/start sets a one-time state in an HttpOnly cookie and
// sends the browser to GitHub (scope read:user: the login and id only).
// /api/auth/github/callback checks the state, swaps the code for a token,
// reads GET /user, and drops the token (nothing of it is stored). Then:
//   - someone is logged in here: GitHub is linked to that account (409-like
//     error when the GitHub account belongs to another user)
//   - else the account with that github_id logs in
//   - else a new account is made, bound to the GitHub login (no password; its
//     owner signs in with GitHub again), and lands on the API keys page
// The GitHub login proven this way is what repo claims compare, as with the
// gist proof.

import { env, HttpError, randomTokenString } from '@/lib/auth';

export const STATE_COOKIE = 'iosonand_gh_oauth';
const STATE_TTL = 600;

export function githubOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = env('GITHUB_CLIENT_ID');
  const clientSecret = env('GITHUB_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const secure = (req: Request) => (new URL(req.url).protocol === 'https:' ? '; Secure' : '');

/** The state cookie: "<state>.<redirect path, base64url>". */
export function stateCookie(req: Request, state: string, redirect: string): string {
  const value = `${state}.${btoa(redirect).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  return `${STATE_COOKIE}=${value}; HttpOnly; Path=/api/auth/github; SameSite=Lax; Max-Age=${STATE_TTL}${secure(req)}`;
}

export function clearStateCookie(req: Request): string {
  return `${STATE_COOKIE}=; HttpOnly; Path=/api/auth/github; SameSite=Lax; Max-Age=0${secure(req)}`;
}

export function readStateCookie(raw: string | null): { state: string; redirect: string } | null {
  if (!raw) return null;
  const [state, enc] = raw.split('.');
  if (!state || enc === undefined) return null;
  try {
    const redirect = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    return { state, redirect: safePath(redirect) };
  } catch {
    return null;
  }
}

/** Only same-site paths are followed after sign-in. */
export function safePath(p: string | null | undefined): string {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : '/';
}

export function newState(): string {
  return randomTokenString(24);
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: 'read:user', state, allow_signup: 'true' });
  return `https://github.com/login/oauth/authorize?${q}`;
}

/** Swap the code for a token, read the user, forget the token. */
export async function githubUserFromCode(
  cfg: { clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
): Promise<{ id: number; login: string; name: string | null }> {
  const tokRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'iOSOnAnd-tracker/1.0' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri }),
  });
  const tok = (await tokRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tok.access_token) throw new HttpError(401, 'github sign-in failed', tok.error || 'GitHub gave no token; try again');
  const userRes = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'iOSOnAnd-tracker/1.0' },
  });
  if (!userRes.ok) throw new HttpError(502, 'github unreachable', `GitHub answered ${userRes.status} for the user`);
  const u = (await userRes.json()) as { id?: number; login?: string; name?: string | null };
  if (!u.id || !u.login) throw new HttpError(502, 'github gave no user', 'try again');
  return { id: u.id, login: u.login, name: u.name ?? null };
}

