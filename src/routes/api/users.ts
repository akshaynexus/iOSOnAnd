// /api/users — admin only.
// GET: every account, newest first, with what it maintains (?limit= default
// 100, max 500, ?offset=) -> {users: [{id, display_name, email, github_login,
// is_admin, created, maintains, maintains_repos}], total, limit, offset, next}.
// POST: create an account (CLI user-add). Body {email, password, is_admin?,
// display_name?} -> 201 {user}.

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
import { queryAll } from '@/lib/db';
import { MAINTAINERS_SQL, paged, pageParams } from '@/lib/auth';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  await requireAdmin(request);
  const page = pageParams(new URL(request.url).searchParams, 100, 500);
  const { rows, page: info } = await paged<{ id: number; display_name: string; email: string | null; github_login: string | null; is_admin: number; created: string }>(
    'SELECT id, display_name, email, github_login, is_admin, created FROM users ORDER BY id DESC',
    'SELECT COUNT(*) AS n FROM users',
    [],
    page,
  );
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(', ');
  const [phones, repos] = ids.length
    ? await Promise.all([
        queryAll<{ uid: number; device_slug: string }>(`SELECT DISTINCT uid, device_slug FROM (${MAINTAINERS_SQL}) WHERE uid IN (${marks})`, ids),
        queryAll<{ uid: number; repo: string }>(`SELECT rm.user_id AS uid, f.repo FROM repo_maintainers rm JOIN forks f ON f.id = rm.fork_id WHERE rm.user_id IN (${marks})`, ids),
      ])
    : [[], []];
  const users = rows.map((r) => ({
    ...r,
    is_admin: !!r.is_admin,
    maintains: phones.filter((p) => p.uid === r.id).map((p) => p.device_slug).sort(),
    maintains_repos: repos.filter((p) => p.uid === r.id).map((p) => p.repo).sort(),
  }));
  return json({ users, ...info });
}
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
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
