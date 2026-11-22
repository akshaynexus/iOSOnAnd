// /api/media — uploads (proof screenshots and clips) on R2.
// GET ?device= ?fork_id= ?area= ?kind=image|video ?limit= (default 50, max
// 500) ?offset= (public) -> {media: [Media], total, limit, offset, next},
// newest first.
// POST multipart/form-data: device (required; or ?device=), fork_id?, area?,
// caption?, then file (the text fields must come before the file part).
// Admin or a maintainer of the device; a token needs media:write. The body is
// streamed into R2 (src/lib/media.ts), never buffered whole. Checks, in
// order: 401, 411 no Content-Length, 413 Content-Length over 95 MB, 415 not
// multipart, 400 device missing, 404/403 device, 415 wrong file type (magic
// bytes), 413 file over its limit (images 15 MB, videos 95 MB). -> 201 {media}.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst } from '@/lib/db';
import { HttpError, actorName, json, nowIso, paged, pageParams, randomTokenString, requireDeviceEditor, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { MEDIA_SELECT, R2Upload, loadMedia, mapMedia, mediaBucket, type MediaRow } from '@/lib/media';
import { MultipartError, boundaryOf, parseMultipart } from '@/lib/multipart';
import { REQUEST_MAX } from '@/lib/sniff';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const page = pageParams(sp, 50, 500);
  const where = ['m.deleted = 0'];
  const vals: unknown[] = [];
  const device = sp.get('device')?.trim();
  const fork = sp.get('fork_id')?.trim();
  const area = sp.get('area')?.trim();
  const kind = sp.get('kind')?.trim();
  if (device) {
    where.push('m.device_slug = ?');
    vals.push(device);
  }
  if (fork) {
    if (!/^\d{1,15}$/.test(fork)) throw new HttpError(400, 'bad fork_id', 'fork_id is numeric');
    where.push('m.fork_id = ?');
    vals.push(Number(fork));
  }
  if (area) {
    where.push('m.area_slug = ?');
    vals.push(area);
  }
  if (kind) {
    if (kind !== 'image' && kind !== 'video') throw new HttpError(400, 'bad kind', 'kind must be image or video');
    where.push('m.content_type LIKE ?');
    vals.push(`${kind}/%`);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const { rows, page: info } = await paged<MediaRow>(
    `${MEDIA_SELECT} ${w} ORDER BY m.id DESC`,
    `SELECT COUNT(*) AS n FROM media m ${w}`,
    vals,
    page,
  );
  return json({ media: rows.map(mapMedia), ...info });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request); // 401 and the token scope before the body is read
  const len = request.headers.get('content-length');
  if (len === null || !/^\d+$/.test(len)) {
    throw new HttpError(411, 'content-length required', 'send the upload with a Content-Length header (curl -F and the CLI do)');
  }
  if (Number(len) > REQUEST_MAX) {
    throw new HttpError(413, 'file too large', 'uploads are limited to 95 MB (videos) and 15 MB (images)');
  }
  const boundary = boundaryOf(request.headers.get('content-type'));
  if (!boundary || !request.body) {
    throw new HttpError(415, 'multipart/form-data required', 'send multipart/form-data: device, fork_id?, area?, caption?, then file');
  }
  const query = new URL(request.url).searchParams;
  const fields: Record<string, string> = {};
  let upload: R2Upload | null = null;
  let device = '';
  let forkId: number | null = null;
  let area: string | null = null;
  let fileSeen = false;
  try {
    await parseMultipart(request.body, boundary, {
      field(name, value) {
        if (name in fields) throw new HttpError(400, `duplicate field ${name}`, 'send each field once');
        fields[name] = value.trim();
      },
      async fileStart(part) {
        if (part.name !== 'file') throw new HttpError(400, `unexpected file field ${part.name}`, 'send the file as the field "file"');
        if (fileSeen) throw new HttpError(400, 'one file per upload', 'send one file part');
        fileSeen = true;
        device = fields.device || fields.device_slug || query.get('device')?.trim() || '';
        if (!device) {
          throw new HttpError(400, 'device required', 'send the device field before the file part (or ?device=<slug>)');
        }
        await requireDeviceEditor(request, device);
        const areaRaw = fields.area || fields.area_slug || query.get('area')?.trim() || '';
        if (areaRaw) {
          if (!(await queryFirst('SELECT slug FROM areas WHERE slug = ?', [areaRaw]))) {
            throw new HttpError(404, 'unknown area', 'GET /api/areas for the valid area slugs');
          }
          area = areaRaw;
        }
        const forkRaw = fields.fork_id || query.get('fork_id')?.trim() || '';
        if (forkRaw) {
          if (!/^\d{1,15}$/.test(forkRaw) || !(await queryFirst('SELECT id FROM forks WHERE id = ?', [Number(forkRaw)]))) {
            throw new HttpError(404, 'unknown fork', 'fork_id must be a tracked fork (GET /api/forks)');
          }
          forkId = Number(forkRaw);
        }
        if ((fields.caption ?? '').length > 500) throw new HttpError(400, 'caption too long', 'captions are limited to 500 characters');
        const stamp = nowIso().slice(0, 10);
        upload = new R2Upload(mediaBucket(), (s) => `${device}/${stamp}-${randomTokenString(12)}.${s.ext}`);
      },
      async fileData(chunk) {
        await upload!.write(chunk);
      },
      async fileEnd() {
        await upload!.end();
      },
    });
  } catch (e) {
    if (upload) await (upload as R2Upload).abort();
    if (e instanceof MultipartError) throw new HttpError(e.status, e.message, e.hint);
    throw e;
  }
  const up = upload as R2Upload | null;
  if (!up || !up.sniffed) throw new HttpError(400, 'file required', 'send the file as the multipart field "file" (after device)');
  let row: { id: number } | null = null;
  try {
    row = await queryFirst<{ id: number }>(
      `INSERT INTO media (device_slug, fork_id, area_slug, user_id, r2_key, content_type, bytes, width, height, caption, created, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) RETURNING id`,
      [device, forkId, area, user.id, up.r2Key, up.sniffed.type, up.total, up.width, up.height, fields.caption ?? '', nowIso()],
    );
  } finally {
    if (!row) await up.abort();
  }
  if (!row) throw new HttpError(500, 'media record failed', 'retry the upload');
  await appendChangelog(
    actorName(user),
    `media #${row.id} uploaded for ${device}${area ? `/${area}` : ''} (${up.sniffed.kind}, ${Math.ceil(up.total / 1024)} KB)`,
  );
  return json({ media: mapMedia(await loadMedia(String(row.id))) }, 201);
}

export const Route = createFileRoute('/api/media')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
