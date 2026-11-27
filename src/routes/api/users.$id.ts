// /api/users/$id — $id is the user id or their GitHub login (case-insensitive).
// GET a public profile (public: name, GitHub login, join
// date, the phones and repos they maintain, their recent status changes and
// how many notable features they recorded; never the email), DELETE an account (admin;
// removes its sessions, tokens, claims, repo claims and uploads, and clears
// it as a repo maintainer; changelog lines stay). An admin
// cannot delete their own account (there must always be one way back in).

import { viewsOf } from '@/lib/stats';
import { createFileRoute } from '@tanstack/react-router';
import { exec, queryAll, queryFirst } from '@/lib/db';
import { mediaBucket } from '@/lib/media';
import { HttpError, actorName, findUserById, json, maintainedSlugs, requireAdmin, toPublicUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { appendChangelog } from '@/lib/changelog';

async function load(idOrLogin: string) {
  let id = /^\d{1,15}$/.test(idOrLogin) ? Number(idOrLogin) : 0;
  if (!id && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(idOrLogin)) {
    id = (await queryFirst<{ id: number }>('SELECT id FROM users WHERE lower(github_login) = lower(?)', [idOrLogin]))?.id ?? 0;
  }
  if (!id) throw new HttpError(404, 'unknown user', 'use a user id or a linked GitHub login');
  const u = await findUserById(id);
  if (!u) throw new HttpError(404, 'unknown user', 'check the id');
  return u;
}

async function handleGet({ params }: ApiCtx): Promise<Response> {
  const u = await load(params.id);
  const [maintains, repos, recent, features] = await Promise.all([
    maintainedSlugs(u.id),
    queryAll<{ id: number; repo: string; device_slug: string | null; kind: string; base_project: string; best_result: string; since: string }>(
      `SELECT f.id, f.repo, f.device_slug, f.kind, f.base_project, f.best_result, rm.since
         FROM repo_maintainers rm JOIN forks f ON f.id = rm.fork_id WHERE rm.user_id = ? ORDER BY f.repo COLLATE NOCASE`,
      [u.id],
    ),
    queryAll<{ id: number; device_slug: string; area_slug: string; area_name: string | null; os: string; os_version: string; old_state: string | null; state: string; detail: string; source: string; who: string; created: string }>(
      `SELECT h.id, h.device_slug, h.area_slug, a.name AS area_name, h.os, h.os_version, h.old_state, h.state, h.detail, h.source, h.who, h.created
         FROM status_history h LEFT JOIN areas a ON a.slug = h.area_slug WHERE h.user_id = ? ORDER BY h.id DESC LIMIT 20`,
      [u.id],
    ),
    queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM device_features WHERE user_id = ?', [u.id]),
  ]);
  // The phones at a glance: name, photo, chip, iOS version, how many iOS areas work, whether it boots.
  const devices = maintains.length
    ? await queryAll<{ slug: string; name: string; image_url: string; soc: string; ios_version: string; works: number; boots: number }>(
        `SELECT d.slug, d.name, d.image_url, d.soc, d.ios_version,
                (SELECT COUNT(*) FROM device_status s WHERE s.device_slug = d.slug AND s.os = 'ios' AND s.state = 'works') AS works,
                (SELECT COUNT(*) FROM device_status s WHERE s.device_slug = d.slug AND s.os = 'ios' AND s.area_slug = 'boot' AND s.state = 'works') AS boots
           FROM devices d WHERE d.slug IN (${maintains.map(() => '?').join(', ')}) ORDER BY d.name COLLATE NOCASE`,
        maintains,
      )
    : [];
  const views = await viewsOf('profile_view', String(u.id));
  return json({ user: { ...toPublicUser(u), maintains, devices, repos, recent, features: Number(features?.n ?? 0), views } });
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
