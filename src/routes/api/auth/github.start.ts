// GET /api/auth/github/start?redirect=/path — begin "Continue with GitHub":
// a one-time state in an HttpOnly cookie, then 302 to GitHub's authorize
// page. Not set up: 302 to /login?error=github_off. Logged in already: the
// callback links GitHub to that account instead of signing in.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { publicOrigin } from '@/lib/password';
import { authorizeUrl, githubOAuthConfig, newState, safePath, stateCookie } from '@/lib/githubOAuth';

function handleGet({ request }: { request: Request }): Response {
  const cfg = githubOAuthConfig();
  const origin = publicOrigin(request);
  if (!cfg) return Response.redirect(`${origin}/login?error=github_off`, 302);
  const redirect = safePath(new URL(request.url).searchParams.get('redirect'));
  const state = newState();
  const headers = new Headers({ location: authorizeUrl(cfg.clientId, `${origin}/api/auth/github/callback`, state), 'cache-control': 'no-store' });
  headers.append('set-cookie', stateCookie(request, state, redirect));
  return new Response(null, { status: 302, headers });
}

export const Route = createFileRoute('/api/auth/github/start')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
