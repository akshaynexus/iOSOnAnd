// POST /api/users — admin-only account creation (CLI user-add).
// Body {email, password, is_admin?, display_name?} -> 201 {user}.

import { createFileRoute } from '@tanstack/react-router';
import {
  HttpError,
  actorName,
  createUser,
  findUserByEmail,
  hashPassword,
  json,
  readJson,
  requireAdmin,
  str,
  toSelfUser,
  validEmail,
} from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { appendChangelog } from '@/lib/changelog';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const admin = await requireAdmin(request);
  const body = await readJson(request);
  const email = str(body, 'email', 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!validEmail(email)) throw new HttpError(400, 'invalid email', 'send {"email","password"} plus optional is_admin');
  if (password.length < 10 || password.length > 256) {
    throw new HttpError(400, 'bad password', 'use 10 to 256 characters');
  }
  if (await findUserByEmail(email)) {
    throw new HttpError(409, 'email already registered', 'that address already has an account');
  }
  const isAdminFlag = body.is_admin === true || body.is_admin === 1 || body.is_admin === '1';
  const user = await createUser({
    email,
    passwordHash: await hashPassword(password),
    displayName: str(body, 'display_name', 64) || email.split('@')[0] || 'user',
    isAdmin: isAdminFlag,
  });
  await appendChangelog(actorName(admin), `created account ${user.display_name}${isAdminFlag ? ' (admin)' : ''}`);
  return json({ user: toSelfUser(user) }, 201);
}

export const Route = createFileRoute('/api/users')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
