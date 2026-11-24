// /api/users/$id — GET a public profile (public), DELETE an account (admin;
// removes its sessions, tokens, claims, repo claims and uploads, and clears
// it as a repo maintainer; changelog lines stay). An admin
// cannot delete their own account (there must always be one way back in).

import { createFileRoute } from '@tanstack/react-router';
import { exec, queryAll } from '@/lib/db';
import { mediaBucket } from '@/lib/media';
import { HttpError, actorName, findUserById, json, maintainedSlugs, requireAdmin, toPublicUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { appendChangelog } from '@/lib/changelog';

async function load(id: string) {
  if (!/^\d{1,15}$/.test(id)) throw new HttpError(404, 'unknown user', 'user ids are numeric');
  const u = await findUserById(Number(id));
  if (!u) throw new HttpError(404, 'unknown user', 'check the id');
  return u;
}

async function handleGet({ params }: ApiCtx): Promise<Response> {
  const u = await load(params.id);
  return json({ user: { ...toPublicUser(u), maintains: await maintainedSlugs(u.id) } });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const admin = await requireAdmin(request);
  const u = await load(params.id);
  if (u.id === admin.id) throw new HttpError(409, 'cannot delete yourself', 'ask another admin');
  await exec('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  await exec('DELETE FROM password_resets WHERE user_id = ?', [u.id]);
  await exec('DELETE FROM api_tokens WHERE user_id = ?', [u.id]);
  await exec('DELETE FROM claims WHERE user_id = ?', [u.id]);
  await exec('DELETE FROM repo_claims WHERE user_id = ?', [u.id]);
  await exec('DELETE FROM repo_maintainers WHERE user_id = ?', [u.id]);
  // forks.maintainer_user_id mirrors the first maintainer: the next one, or none.
  await exec(
    `UPDATE forks SET
       maintainer_user_id = (SELECT user_id FROM repo_maintainers rm WHERE rm.fork_id = forks.id ORDER BY since, user_id LIMIT 1),
       maintainer_since = (SELECT since FROM repo_maintainers rm WHERE rm.fork_id = forks.id ORDER BY since, user_id LIMIT 1)
     WHERE maintainer_user_id = ?`,
    [u.id],
  );
  // Their uploads go too (media.user_id is required): the R2 objects and the rows.
  const media = await queryAll<{ r2_key: string }>('SELECT r2_key FROM media WHERE user_id = ? AND deleted = 0', [u.id]);
  if (media.length) {
    try {
      await mediaBucket().delete(media.map((m) => m.r2_key));
    } catch (e) {
      console.error('media delete failed:', e);
    }
  }
  await exec('DELETE FROM media WHERE user_id = ?', [u.id]);
  await exec('DELETE FROM users WHERE id = ?', [u.id]);
  await appendChangelog(actorName(admin), `account ${actorName(u)} removed`);
  return json({ deleted: u.id });
}

export const Route = createFileRoute('/api/users/$id')({
  server: { handlers: apiHandlers({ GET: handleGet, DELETE: handleDelete }) },
});
