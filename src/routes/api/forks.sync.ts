// POST /api/forks/sync — upsert a fork by repo (CLI fork-sync). The repo name
// is unique, so an existing fork is found by repo alone; syncing it under a
// different device is 409 (PATCH /api/forks/<id> moves it, POST
// /api/forks/<id>/devices adds a supported device). Admin, the repo's
// maintainer, or a maintainer of device_slug (no device: admin only). Only
// the fields sent change on an existing fork; a new one starts as
// verified=fork-claim. -> {fork, created}.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, json, nowIso, readJson, requireDeviceEditor, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import {
  FORK_TEXT,
  canEditFork,
  findForkByRepo,
  forkDevice,
  forkRepo,
  forkText,
  forkVerified,
  forkView,
  linkLineage,
  loadForkRow,
  syncOwnSupport,
} from '@/lib/forks';
import { appendChangelog } from '@/lib/changelog';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const sent = forkDevice(body);
  const repo = forkRepo(body);
  const existing = await findForkByRepo(repo);

  if (existing) {
    if (sent !== undefined && sent !== existing.device_slug) {
      throw new HttpError(
        409,
        'fork tracked for another device',
        `${existing.repo} is fork #${existing.id} for ${existing.device_slug ?? 'no device'}; PATCH /api/forks/${existing.id} moves it, POST /api/forks/${existing.id}/devices adds a device`,
      );
    }
    const user = await requireUser(request);
    if (!(await canEditFork(user, existing))) await requireDeviceEditor(request, existing.device_slug);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of Object.keys(FORK_TEXT)) {
      if (body[f] === undefined) continue;
      sets.push(`${f} = ?`);
      vals.push(forkText(body, f));
    }
    if (body.verified !== undefined) {
      sets.push('verified = ?');
      vals.push(forkVerified(user, body.verified));
    }
    sets.push('updated = ?');
    vals.push(nowIso(), existing.id);
    await exec(`UPDATE forks SET ${sets.join(', ')} WHERE id = ?`, vals);
    const row = await loadForkRow(existing.id);
    await syncOwnSupport(row);
    await appendChangelog(actorName(user), `fork ${repo} synced`);
    return json({ fork: await forkView(row), created: false });
  }

  const deviceSlug = sent ?? null;
  const user = await requireDeviceEditor(request, deviceSlug);
  const verified = forkVerified(user, body.verified ?? 'fork-claim');
  const ins = await queryFirst<{ id: number }>(
    `INSERT INTO forks (device_slug, repo, branch, url, best_result, ported, fork_only, verified, notes, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      deviceSlug,
      repo,
      forkText(body, 'branch'),
      forkText(body, 'url') || `https://github.com/${repo}`,
      forkText(body, 'best_result'),
      forkText(body, 'ported'),
      forkText(body, 'fork_only'),
      verified,
      forkText(body, 'notes'),
      nowIso(),
    ],
  );
  if (!ins) throw new HttpError(500, 'fork creation failed', 'retry');
  await syncOwnSupport({ id: ins.id, device_slug: deviceSlug, kind: 'fork', verified });
  await linkLineage({ id: ins.id, repo });
  await appendChangelog(actorName(user), `fork ${repo} added via sync${deviceSlug ? ` for ${deviceSlug}` : ''}`);
  return json({ fork: await forkView(await loadForkRow(ins.id)), created: true }, 201);
}

export const Route = createFileRoute('/api/forks/sync')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
