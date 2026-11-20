// POST /api/auth/register — email+password signup. 201 + session cookie.
// 400 bad input, 409 email taken.

import { createFileRoute } from '@tanstack/react-router';
import {
  HttpError,
  createSession,
  createUser,
  ensureAuthSchema,
  findUserByEmail,
  handleError,
  hashPassword,
  json,
  maybeBootstrapAdmin,
  readJson,
  sessionCookieHeader,
  toSelfUser,
  validEmail,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';

async function handlePost(req: Request): Promise<Response> {
  await ensureAuthSchema();
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName =
    String(body.display_name || body.displayName || '').trim() || email.split('@')[0] || 'user';
  if (!validEmail(email)) {
    throw new HttpError(400, 'invalid email', 'send {"email","password"} with a valid email address');
  }
  if (password.length < 10) {
    throw new HttpError(400, 'password too short', 'use at least 10 characters');
  }
  if (await findUserByEmail(email)) {
    throw new HttpError(409, 'email already registered', 'POST /api/auth/login instead, or use another email');
  }
  let user = await createUser({ email, passwordHash: await hashPassword(password), displayName });
  user = await maybeBootstrapAdmin(user, password);
  const { token } = await createSession(user.id);
  await appendChangelog(displayName, 'registered a new account');
  return json({ user: toSelfUser(user) }, 201, { 'set-cookie': sessionCookieHeader(token, req) });
}

export const Route = createFileRoute('/api/auth/register')({
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
