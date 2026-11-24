// GET /api/auth/github/callback?code&state — finish "Continue with GitHub"
// (src/lib/githubOAuth.ts). Signs in (or makes an account bound to the
// GitHub login), or links GitHub when someone is logged in already, then 302
// to where they started (a new account: /profile/keys, to make an API key for
// its CLI or agent). Errors 302 to /login?error=<code> (signed out) or
// /profile?tab=github&error=<code> (linking).

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  createSession,
  createUser,
  findUserByGithubId,
  getCookie,
  getCurrentUser,
  nowIso,
  sessionCookieHeader,
} from '@/lib/auth';
import { apiHandlers } from '@/lib/api';
import { appendChangelog } from '@/lib/changelog';
import { publicOrigin } from '@/lib/password';
import { STATE_COOKIE, clearStateCookie, githubOAuthConfig, githubUserFromCode, readStateCookie } from '@/lib/githubOAuth';

async function handleGet({ request }: { request: Request }): Promise<Response> {
  const origin = publicOrigin(request);
  const url = new URL(request.url);
  const current = await getCurrentUser(request);
  const headers = new Headers({ 'cache-control': 'no-store' });
  headers.append('set-cookie', clearStateCookie(request));
  const go = (path: string) => {
    headers.set('location', `${origin}${path}`);
    return new Response(null, { status: 302, headers });
  };
  const fail = (code: string) => go(current ? `/profile?tab=github&error=${code}` : `/login?error=${code}`);

  const cfg = githubOAuthConfig();
  if (!cfg) return fail('github_off');
  if (url.searchParams.get('error')) return fail('github_denied');
  const saved = readStateCookie(getCookie(request, STATE_COOKIE));
  const code = url.searchParams.get('code');
  if (!saved || !code || saved.state !== url.searchParams.get('state')) return fail('github_state');

  let gh: { id: number; login: string; name: string | null };
  try {
    gh = await githubUserFromCode(cfg, code, `${origin}/api/auth/github/callback`);
  } catch (e) {
    console.error('github oauth:', e instanceof HttpError ? `${e.message}: ${e.hint}` : e);
    return fail('github_failed');
  }

  const owner = await findUserByGithubId(gh.id);
  if (current) {
    // Linking GitHub to the account that is logged in.
    if (owner && owner.id !== current.id) return go('/profile?tab=github&error=github_taken');
    if (current.github_id !== gh.id || current.github_login !== gh.login) {
      await exec('UPDATE users SET github_id = ?, github_login = ?, github_linked_at = ? WHERE id = ?', [gh.id, gh.login, nowIso(), current.id]);
      await appendChangelog(actorName(current), `linked github @${gh.login} (GitHub sign-in)`);
    }
    return go(saved.redirect === '/' ? '/profile?tab=github' : saved.redirect);
  }

  let user = owner;
  let isNew = false;
  if (!user) {
    user = await createUser({ displayName: gh.name || gh.login, githubId: gh.id, githubLogin: gh.login });
    isNew = true;
    await appendChangelog(actorName(user), `github sign-in: new account bound to @${gh.login}`);
  } else if (user.github_login !== gh.login) {
    // The GitHub account was renamed: keep the login current (claims compare it).
    await exec('UPDATE users SET github_login = ? WHERE id = ?', [gh.login, user.id]);
  }
  const sess = await createSession(user.id);
  headers.append('set-cookie', sessionCookieHeader(sess.token, request));
  return go(isNew ? '/profile/keys?welcome=1' : saved.redirect);
}

export const Route = createFileRoute('/api/auth/github/callback')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
