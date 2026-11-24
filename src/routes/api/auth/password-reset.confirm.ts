// POST /api/auth/password-reset/confirm — set a new password with a reset link
// (public). Body {token, password}. Spends the link, ends every session,
// revokes every API key and logs in (200 + session cookie). 400 bad token or
// password, 410 the link expired (30 minutes) or was used. See src/lib/password.ts.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { json, readJson, sessionCookieHeader, toSelfUserWithTrust } from '@/lib/auth';
import { confirmReset } from '@/lib/password';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const { user, session, tokens_revoked } = await confirmReset(body.token, body.password);
  return json({ user: await toSelfUserWithTrust(user), tokens_revoked }, 200, {
    'set-cookie': sessionCookieHeader(session, request),
  });
}

export const Route = createFileRoute('/api/auth/password-reset/confirm')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
