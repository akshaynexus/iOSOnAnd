// src/lib/signup.ts — email+password signup shared by /api/auth/signup and
// its alias /api/auth/register. 201 + session cookie; 400 bad input, 409 taken.
// ADMIN_EMAIL is reserved: signing up with it only works with ADMIN_PASSWORD
// (and makes that account the admin).

import {
  HttpError,
  checkNewPassword,
  createSession,
  createUser,
  findUserByEmail,
  hashPassword,
  isBootstrapAdminEmail,
  json,
  loginBootstrapAdmin,
  readJson,
  sessionCookieHeader,
  str,
  toSelfUserWithTrust,
  validEmail,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';

export async function handleSignup(req: Request): Promise<Response> {
  const body = await readJson(req);
  const email = str(body, 'email', 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!validEmail(email)) {
    throw new HttpError(400, 'invalid email', 'send {"email","password"} with a valid email address');
  }
  checkNewPassword(password);
  const displayName = str(body, 'display_name', 64) || str(body, 'displayName', 64) || email.split('@')[0] || 'user';
  if (isBootstrapAdminEmail(email)) {
    const admin = await loginBootstrapAdmin(email, password);
    if (!admin) throw new HttpError(409, 'email already registered', 'POST /api/auth/login instead, or use another email');
    const { token } = await createSession(admin.id);
    return json({ user: await toSelfUserWithTrust(admin) }, 201, { 'set-cookie': sessionCookieHeader(token, req) });
  }
  if (await findUserByEmail(email)) {
    throw new HttpError(409, 'email already registered', 'POST /api/auth/login instead, or use another email');
  }
  const user = await createUser({ email, passwordHash: await hashPassword(password), displayName });
  const { token } = await createSession(user.id);
  await appendChangelog(user.display_name || displayName, 'registered a new account');
  return json({ user: await toSelfUserWithTrust(user) }, 201, { 'set-cookie': sessionCookieHeader(token, req) });
}
