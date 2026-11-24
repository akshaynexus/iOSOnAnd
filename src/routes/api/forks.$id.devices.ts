// /api/forks/$id/devices — the devices a repo supports (repo_devices).
// POST {device_slug|device, support: primary|merged|ported|claimed, via?:
// "OWNER/REPO" (a tracked repo the work came from), note?} upserts one row.
// DELETE ?device= (or {device_slug}) removes one. Admin; the repo's
// maintainer may add and remove 'claimed' rows only. -> {fork}.
// The repo's maintainer maintains its primary/merged/ported phones without a
// claim (src/lib/auth.ts, MAINTAINING_SUPPORT). A phone they add themselves
// also makes them its maintainer: at once when nobody maintains it, else a
// pending device claim an admin decides -> {fork, device_claim: {status,
// claim_id}}.
// CLI: repo-support OWNER/REPO <device> --support ... [--via] [--note].

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, readJson, requireUser, str } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { findForkByRepo, forkView, loadForkRow, normalizeRepo, setSupport, supportLevel, type ForkRow } from '@/lib/forks';
import { appendChangelog } from '@/lib/changelog';
import { grantSupportedPhone, supportedPhoneNote } from '@/lib/repos';

async function editor(request: Request, fork: ForkRow, support: string | null) {
  const user = await requireUser(request);
  if (isAdmin(user)) return user;
  if (fork.maintainer_user_id === user.id && (support === null || support === 'claimed')) return user;
  if (fork.maintainer_user_id === user.id) {
    throw new HttpError(403, 'admin required', `only an admin records "${support}" support; a repo maintainer adds "claimed" rows`);
  }
  throw new HttpError(403, 'not the repo maintainer', `claim the repo first: POST /api/repos/claim {"repo":"${fork.repo}"}`);
}

async function deviceFrom(request: Request, body: Record<string, any>): Promise<string> {
  const slug = str(body, 'device_slug', 64) || str(body, 'device', 64) || new URL(request.url).searchParams.get('device')?.trim() || '';
  if (!slug) throw new HttpError(400, 'device required', 'send {"device_slug":"<slug>"} (or ?device=)');
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  return slug;
}

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const fork = await loadForkRow(params.id);
  const body = await readJson(request);
  const support = supportLevel(body.support);
  const user = await editor(request, fork, support);
  const device = await deviceFrom(request, body);
  let viaId: number | null = null;
  const viaRaw = str(body, 'via', 200);
  if (viaRaw) {
    const via = normalizeRepo(viaRaw);
    const vf = via ? await findForkByRepo(via) : null;
    if (!vf) throw new HttpError(404, 'unknown via repo', 'via must be a tracked repo (OWNER/REPO); add it with POST /api/forks first');
    if (vf.id === fork.id) throw new HttpError(400, 'bad via', 'via is the repo the work came from, not this repo');
    viaId = vf.id;
  }
  await setSupport(fork.id, device, support, viaId, str(body, 'note', 4000));
  await appendChangelog(actorName(user), `repo ${fork.repo} supports ${device} (${support}${viaRaw ? ` via ${viaRaw}` : ''})`);
  const device_claim = fork.maintainer_user_id === user.id && support === 'claimed' ? await grantSupportedPhone(user, fork, device) : null;
  return json({ fork: await forkView(await loadForkRow(fork.id)), ...(device_claim ? { device_claim } : {}) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const fork = await loadForkRow(params.id);
  const body = await readJson(request);
  const device = await deviceFrom(request, body);
  const row = await queryFirst<{ support: string }>('SELECT support FROM repo_devices WHERE fork_id = ? AND device_slug = ?', [fork.id, device]);
  if (!row) throw new HttpError(404, 'no support row', `${fork.repo} has no row for ${device}`);
  const user = await editor(request, fork, row.support);
  await exec('DELETE FROM repo_devices WHERE fork_id = ? AND device_slug = ?', [fork.id, device]);
  // The repo maintainer's claim on that phone, made when they added it, goes with it.
  if (fork.maintainer_user_id != null) {
    await exec('DELETE FROM claims WHERE user_id = ? AND device_slug = ? AND note = ?', [fork.maintainer_user_id, device, supportedPhoneNote(fork.repo)]);
  }
  await appendChangelog(actorName(user), `repo ${fork.repo} no longer lists ${device}`);
  return json({ fork: await forkView(await loadForkRow(fork.id)) });
}

export const Route = createFileRoute('/api/forks/$id/devices')({
  server: { handlers: apiHandlers({ POST: handlePost, DELETE: handleDelete }) },
});
