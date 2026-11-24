// POST /api/auth/login — email+password login (public). 200 + session cookie.
// 401 on bad credentials (one generic message, no user enumeration). The
// ADMIN_EMAIL/ADMIN_PASSWORD env pair always logs in as the admin (the
// account is created on first use). Old-parameter hashes are re-hashed.
// An unknown email runs the same hashing work as a wrong password (no timing
// leak), and each email gets 5 attempts a minute (src/lib/ratelimit.ts).

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import {
  HttpError,
  createSession,
  findUserByEmail,
  hashPassword,
  json,
  loginBootstrapAdmin,
  needsRehash,
  readJson,
  sessionCookieHeader,
  str,
  toSelfUserWithTrust,
  dummyVerifyPassword,
  verifyPassword,
} from '@/lib/auth';
import { hitEmail } from '@/lib/ratelimit';
import { apiHandlers, type ApiCtx } from '@/lib/api';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const email = str(body, 'email', 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const fail = () =>
    new HttpError(401, 'invalid email or password', 'check both fields, or POST /api/auth/signup to sign up');
  if (!email || !password || password.length > 256) throw fail();
  await hitEmail(email);
  let user = await loginBootstrapAdmin(email, password);
  if (!user) {
    user = await findUserByEmail(email);
    if (!user || !user.password_hash) {
      await dummyVerifyPassword(password);
      throw fail();
    }
    if (!(await verifyPassword(password, user.password_hash))) throw fail();
    if (needsRehash(user.password_hash)) {
      await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id]);
    }
  }
  const { token } = await createSession(user.id);
  return json({ user: await toSelfUserWithTrust(user) }, 200, { 'set-cookie': sessionCookieHeader(token, request) });
}

export const Route = createFileRoute('/api/auth/login')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
