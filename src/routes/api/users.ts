// POST /api/users — admin-only account creation (CLI user-add).
// Body {email, password, is_admin?} -> 201 {user}. 403 without an admin token.

import { createFileRoute } from '@tanstack/react-router';
import {
  HttpError,
  createUser,
  ensureAuthSchema,
  findUserByEmail,
  handleError,
  hashPassword,
  json,
  readJson,
  requireAdmin,
  toSelfUser,
  validEmail,
} from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import { actorName } from '@/lib/auth';

async function handlePost(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  await ensureAuthSchema();
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!validEmail(email)) {
    throw new HttpError(400, 'invalid email', 'send {"email","password"} plus optional is_admin');
  }
  if (password.length < 10) {
    throw new HttpError(400, 'password too short', 'use at least 10 characters');
  }
  if (await findUserByEmail(email)) {
    throw new HttpError(409, 'email already registered', 'that address already has an account');
  }
  const isAdmin = body.is_admin === true || body.is_admin === 1 || body.is_admin === '1';
  const user = await createUser({
    email,
    passwordHash: await hashPassword(password),
    displayName: email.split('@')[0] || 'user',
    isAdmin,
  });
  await appendChangelog(actorName(admin), `created account ${email}${isAdmin ? ' (admin)' : ''}`);
  return json({ user: toSelfUser(user) }, 201);
}

export const Route = createFileRoute('/api/users')({
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
