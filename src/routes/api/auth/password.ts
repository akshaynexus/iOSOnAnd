// POST /api/auth/password — change my password (logged in; a key needs scope
// all). Body {current_password, new_password, revoke_tokens?}. Ends every
// other session; API keys stay unless revoke_tokens is true. 401 wrong
// current password, 409 a GitHub-only account (no password). See src/lib/password.ts.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { checkNewPassword, json, readJson, requireUser } from '@/lib/auth';
import { changePassword } from '@/lib/password';
import { hitEmail } from '@/lib/ratelimit';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const body = await readJson(request);
  checkNewPassword(body.new_password); // a too-short password does not use up an attempt
  if (user.email) await hitEmail(user.email);
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const out = await changePassword(request, user, current, body.new_password, body.revoke_tokens === true);
  return json({ ok: true, ...out });
}

export const Route = createFileRoute('/api/auth/password')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
