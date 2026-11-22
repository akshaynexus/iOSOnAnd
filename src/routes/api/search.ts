// /api/search — GET one-box search over devices, forks, areas, posts (public).
// Devices come with statuses/forks/claims attached (same shape as /api/devices).
import { createFileRoute } from '@tanstack/react-router';
import { queryAll } from '@/lib/db';
import { json } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { likeEscape, withDetails } from '@/lib/devices';
import { FORK_SELECT, forkViews, type ForkRow } from '@/lib/forks';
import type { Device } from '@/lib/types';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 100);
  const like = `%${likeEscape(q)}%`;
  const L = (cols: string[]) => cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ');
  const [devices, forks, areas, posts] = await Promise.all([
    queryAll<Device>(`SELECT * FROM devices WHERE ${L(['slug', 'name', 'model', 'soc', 'best_result'])} ORDER BY slug LIMIT 100`, [
      like, like, like, like, like,
    ]),
    queryAll<ForkRow>(`${FORK_SELECT} WHERE ${L(['f.repo', 'f.branch', 'f.best_result', 'f.fork_only', 'f.base_project'])} ORDER BY f.id LIMIT 100`, [
      like, like, like, like, like,
    ]),
    queryAll(`SELECT * FROM areas WHERE ${L(['slug', 'name'])} ORDER BY slug`, [like, like]),
    queryAll(`SELECT * FROM reddit_posts WHERE ${L(['title', 'url'])} ORDER BY id DESC LIMIT 50`, [like, like]),
  ]);
  return json({ q, devices: await withDetails(devices), forks: await forkViews(forks), areas, posts });
}

export const Route = createFileRoute('/api/search')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
