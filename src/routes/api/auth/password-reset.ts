// POST /api/auth/password-reset — mail a reset link (public). Body {email}.
// Always 200 with the same body, whether or not the email has an account
// (no enumeration); the work runs after the response. 5 requests a minute per
// email, 20 per IP (src/lib/ratelimit.ts). See src/lib/password.ts.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { HttpError, json, readJson, str, validEmail } from '@/lib/auth';
import { scheduleReset } from '@/lib/password';
import { hitEmail } from '@/lib/ratelimit';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const email = str(body, 'email', 254).toLowerCase();
  if (!validEmail(email)) throw new HttpError(400, 'invalid email', 'send {"email"} with the address you log in with');
  await hitEmail(email);
  await scheduleReset(request, email);
  return json({ ok: true, hint: 'if an account uses this email, a reset link is on its way (valid 30 minutes)' });
}

export const Route = createFileRoute('/api/auth/password-reset')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
