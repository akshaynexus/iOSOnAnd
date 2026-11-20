// POST /api/auth/login — email+password login. 200 + session cookie.
// 401 on bad credentials (generic message, no user enumeration).

import { createFileRoute } from '@tanstack/react-router';
import {
  createSession,
  ensureAuthSchema,
  findUserByEmail,
  handleError,
  json,
  maybeBootstrapAdmin,
  readJson,
  sessionCookieHeader,
  toSelfUser,
  verifyPassword,
  HttpError,
} from '@/lib/auth';

async function handlePost(req: Request): Promise<Response> {
  await ensureAuthSchema();
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fail = () =>
    new HttpError(401, 'invalid email or password', 'check both fields, or POST /api/auth/register to sign up');
  if (!email || !password) throw fail();
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash) throw fail();
  if (!(await verifyPassword(password, user.password_hash))) throw fail();
  const promoted = await maybeBootstrapAdmin(user, password);
  const { token } = await createSession(promoted.id);
  return json({ user: toSelfUser(promoted) }, 200, { 'set-cookie': sessionCookieHeader(token, req) });
}

export const Route = createFileRoute('/api/auth/login')({
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
