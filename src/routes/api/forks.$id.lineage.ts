// /api/forks/$id/lineage — what a repo is based on (repo_lineage).
// POST {base: "OWNER/REPO" or a project name, relation: fork-of |
// derived-from | ported-from | uses, note?, source?, base_project?} upserts
// one row; base_fork_id is set when the base is a tracked repo; base_project
// (optional) sets forks.base_project, the family label. DELETE ?base= (or
// {base}, optionally &relation=) removes the rows for that base. Admin, or
// the repo's maintainer. -> {fork}.
// CLI: repo-lineage OWNER/REPO --base X --relation R [--note].

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, oneOf, readJson, requireUser, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { LINEAGE_RELATIONS, forkView, loadForkRow, normalizeRepo, setLineage, type ForkRow } from '@/lib/forks';
import { appendChangelog } from '@/lib/changelog';

async function editor(request: Request, fork: ForkRow) {
  const user = await requireUser(request);
  if (isAdmin(user) || fork.maintainer_user_id === user.id) return user;
  throw new HttpError(403, 'not the repo maintainer', `admin, or the maintainer of ${fork.repo} (POST /api/repos/claim)`);
}

function baseOf(request: Request, body: Record<string, any>): string {
  const raw = str(body, 'base', 200) || new URL(request.url).searchParams.get('base')?.trim() || '';
  if (!raw) throw new HttpError(400, 'base required', 'send {"base":"OWNER/REPO" or a project name, "relation":"derived-from"}');
  return normalizeRepo(raw) ?? raw;
}

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const fork = await loadForkRow(params.id);
  const user = await editor(request, fork);
  const body = await readJson(request);
  const base = baseOf(request, body);
  if (base.toLowerCase() === fork.repo.toLowerCase()) throw new HttpError(400, 'bad base', 'a repo is not based on itself');
  const relation = oneOf(LINEAGE_RELATIONS, str(body, 'relation', 32) || 'derived-from', 'relation');
  await setLineage(fork, base, relation, str(body, 'note', 1000), str(body, 'source', 500));
  if (body.base_project !== undefined) {
    await exec('UPDATE forks SET base_project = ? WHERE id = ?', [str(body, 'base_project', 64), fork.id]);
  }
  await appendChangelog(actorName(user), `repo ${fork.repo} ${relation} ${base}`);
  return json({ fork: await forkView(await loadForkRow(fork.id)) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const fork = await loadForkRow(params.id);
  const user = await editor(request, fork);
  const body = await readJson(request);
  const base = baseOf(request, body);
  const rel = str(body, 'relation', 32) || new URL(request.url).searchParams.get('relation')?.trim() || '';
  const where = `fork_id = ? AND base = ? COLLATE NOCASE${rel ? ' AND relation = ?' : ''}`;
  const args = rel ? [fork.id, base, rel] : [fork.id, base];
  if (!(await queryFirst(`SELECT 1 AS ok FROM repo_lineage WHERE ${where}`, args))) {
    throw new HttpError(404, 'no lineage row', `${fork.repo} has no "based on" row for ${base}`);
  }
  await exec(`DELETE FROM repo_lineage WHERE ${where}`, args);
  await appendChangelog(actorName(user), `repo ${fork.repo} no longer based on ${base}`);
  return json({ fork: await forkView(await loadForkRow(fork.id)) });
}

export const Route = createFileRoute('/api/forks/$id/lineage')({
  server: { handlers: apiHandlers({ POST: handlePost, DELETE: handleDelete }) },
});
