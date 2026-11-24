// /api/devices/$slug/history — GET the device's status changes, newest first
// (public; ?os= ios, macos, tvos or all, the default; ?limit= default 50, max
// 200, ?offset=). Each row: area, system and version, the state before (null
// when the area had no row, or for history read back from the changelog) and
// after, the detail and source, who and when, and `media`: the photos and
// clips linked to the change (media.history_id).
// -> {history, total, limit, offset, next}

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, json, paged, pageParams } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { osOf } from '@/lib/status';
import { mediaByLink, type Media } from '@/lib/media';

export interface StatusChange {
  id: number;
  device_slug: string;
  area_slug: string;
  area_name: string | null;
  os: string;
  os_version: string;
  old_state: string | null;
  state: string;
  detail: string;
  source: string;
  who: string;
  created: string;
  media?: Media[];
}

async function handleGet({ request, params }: ApiCtx): Promise<Response> {
  const slug = params.slug;
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  const sp = new URL(request.url).searchParams;
  const osParam = sp.get('os')?.trim().toLowerCase() || 'all';
  const where = ['h.device_slug = ?'];
  const vals: string[] = [slug];
  if (osParam !== 'all') {
    where.push('h.os = ?');
    vals.push(osOf(osParam));
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const { rows, page } = await paged<StatusChange>(
    `SELECT h.id, h.device_slug, h.area_slug, a.name AS area_name, h.os, h.os_version, h.old_state, h.state, h.detail, h.source, h.who, h.created
       FROM status_history h LEFT JOIN areas a ON a.slug = h.area_slug ${w} ORDER BY h.id DESC`,
    `SELECT COUNT(*) AS n FROM status_history h ${w}`,
    vals,
    pageParams(sp, 50, 200),
  );
  const media = await mediaByLink('history_id', rows.map((r) => r.id));
  return json({ history: rows.map((r) => ({ ...r, media: media.get(r.id) ?? [] })), ...page });
}

export const Route = createFileRoute('/api/devices/$slug/history')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
