// /api/forks/$id — GET one (public), PATCH update (admin, the repo's
// maintainer, or a maintainer of the fork's device; moving it to another
// device needs that device too; kind, verified other than fork-claim and
// base_project: admin only), DELETE remove (admin; its repo_devices rows go
// too; its lineage stays as an untracked node; uploads and claims keep their
// rows without the fork).

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, nowIso, readJson, requireAdmin, requireDeviceEditor, requireUser, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { FORK_TEXT, canEditFork, forkDevice, forkKind, forkText, forkVerified, forkView, loadForkRow, syncOwnSupport } from '@/lib/forks';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ fork: await forkView(await loadForkRow(params.id)) });
}

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  const fork = await loadForkRow(params.id);
  const user = await requireUser(request);
  if (!(await canEditFork(user, fork))) await requireDeviceEditor(request, fork.device_slug); // throws the right 403/404
  const body = await readJson(request);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const nextDevice = forkDevice(body);
  if (nextDevice !== undefined && nextDevice !== fork.device_slug) {
    await requireDeviceEditor(request, nextDevice);
    sets.push('device_slug = ?');
    vals.push(nextDevice);
  }
  for (const f of Object.keys(FORK_TEXT)) {
    if (body[f] === undefined) continue;
    sets.push(`${f} = ?`);
    vals.push(forkText(body, f));
  }
  if (body.verified !== undefined) {
    sets.push('verified = ?');
    vals.push(forkVerified(user, body.verified));
  }
  if (body.kind !== undefined) {
    sets.push('kind = ?');
    vals.push(forkKind(user, body.kind));
  }
  if (body.base_project !== undefined) {
    if (!isAdmin(user)) throw new HttpError(403, 'admin required', 'only an admin sets base_project; use repo-lineage for what the repo is based on');
    sets.push('base_project = ?');
    vals.push(str(body, 'base_project', 64));
  }
  if (!sets.length) {
    throw new HttpError(400, 'nothing to update', `send any of: device_slug, verified, kind, base_project, ${Object.keys(FORK_TEXT).join(', ')}`);
  }
  sets.push('updated = ?');
  vals.push(nowIso(), fork.id);
  await exec(`UPDATE forks SET ${sets.join(', ')} WHERE id = ?`, vals);
  const row = await loadForkRow(params.id);
  await syncOwnSupport(row, fork.device_slug);
  await appendChangelog(actorName(user), `fork ${row.repo} updated`);
  return json({ fork: await forkView(row) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const fork = await loadForkRow(params.id);
  await exec('DELETE FROM repo_devices WHERE fork_id = ?', [fork.id]);
  await exec('UPDATE repo_devices SET via_fork_id = NULL WHERE via_fork_id = ?', [fork.id]);
  // Its lineage stays as an untracked repo of the family tree.
  await exec('UPDATE repo_lineage SET fork_id = NULL WHERE fork_id = ?', [fork.id]);
  await exec('UPDATE repo_lineage SET base_fork_id = NULL WHERE base_fork_id = ?', [fork.id]);
  await exec('INSERT OR IGNORE INTO lineage_repos (repo, base_project) VALUES (?, ?)', [fork.repo, fork.base_project ?? '']);
  await exec('UPDATE repo_claims SET fork_id = NULL WHERE fork_id = ?', [fork.id]);
  await exec('UPDATE media SET fork_id = NULL WHERE fork_id = ?', [fork.id]);
  await exec('DELETE FROM repo_maintainers WHERE fork_id = ?', [fork.id]);
  await exec('DELETE FROM forks WHERE id = ?', [fork.id]);
  await appendChangelog(actorName(user), `fork ${fork.repo} removed`);
  return json({ deleted: fork.id });
}

export const Route = createFileRoute('/api/forks/$id')({
  server: { handlers: apiHandlers({ GET: handleGet, PATCH: handlePatch, DELETE: handleDelete }) },
});
