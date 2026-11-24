// /api/forks/$id/maintainers — the people who maintain a repo (several can:
// collaborators on one port). src/lib/repos.ts holds the rules.
// GET (public) -> {maintainers: [{id, display_name, github_login, since}]}.
// POST {github_login} (an admin, or one of the repo's maintainers; token
// fork:write): add a collaborator by their GitHub login; they need an account
// linked to it (sign in with GitHub). They maintain the repo's phones too.
// -> {fork}. 404 when no account has that login.
// DELETE ?github_login= or ?user=ID (no parameter: yourself): a maintainer
// steps down; an admin or the repo's GitHub owner removes someone else. -> {fork}.
// CLI: repo-maintainers, repo-maintainer-add, repo-maintainer-remove.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, readJson, requireUser, str, type UserRow } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { forkView, isRepoMaintainer, loadForkRow } from '@/lib/forks';
import { addRepoMaintainer, removeMaintainer } from '@/lib/repos';
import { appendChangelog } from '@/lib/changelog';

async function userByLogin(login: string): Promise<UserRow> {
  const clean = login.trim().replace(/^@/, '');
  const u = await queryFirst<UserRow>('SELECT * FROM users WHERE github_login = ? COLLATE NOCASE', [clean]);
  if (!u) {
    throw new HttpError(404, 'no account with that GitHub login', `@${clean} has no tracker account linked to GitHub yet: they sign in with GitHub (or link it on their profile) first`);
  }
  return u;
}

async function handleGet({ params }: ApiCtx): Promise<Response> {
  const fork = await forkView(await loadForkRow(params.id));
  return json({ maintainers: fork.maintainers });
}

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const fork = await loadForkRow(params.id);
  if (!isAdmin(user) && !(await isRepoMaintainer(user.id, fork.id))) {
    throw new HttpError(403, 'not a repo maintainer', `an admin or a maintainer of ${fork.repo} adds maintainers`);
  }
  const body = await readJson(request);
  const login = str(body, 'github_login', 40);
  if (!login) throw new HttpError(400, 'github_login required', 'send {"github_login": "their-login"}');
  const target = await userByLogin(login);
  if (await isRepoMaintainer(target.id, fork.id)) return json({ fork: await forkView(fork), already: true });
  await addRepoMaintainer(fork.id, target.id, user.id);
  await appendChangelog(actorName(user), `repo ${fork.repo}: @${target.github_login} added as a maintainer`);
  return json({ fork: await forkView(await loadForkRow(fork.id)) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const fork = await loadForkRow(params.id);
  const sp = new URL(request.url).searchParams;
  const login = sp.get('github_login');
  const id = sp.get('user');
  const target = login ? (await userByLogin(login)).id : id ? Number(id) : user.id;
  return json({ fork: await forkView(await removeMaintainer(fork, user, target)) });
}

export const Route = createFileRoute('/api/forks/$id/maintainers')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost, DELETE: handleDelete }) },
});
