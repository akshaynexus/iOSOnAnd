// src/lib/media.ts — uploads (images and clips as proof) in the R2 bucket bound
// as MEDIA (wrangler.jsonc; local dev uses the emulated R2 under .wrangler/).
//
// POST /api/media streams the multipart file part into R2 (src/lib/multipart.ts):
// files up to 8 MiB go in one put, larger ones as an R2 multipart upload of
// 8 MiB parts, so a 95 MB clip never sits in memory whole. The type comes
// from the magic bytes (src/lib/sniff.ts) before anything is written; a wrong
// type is 415, a file over its limit 413 (the upload is aborted). GET
// /media/<key> (src/routes/media.$.ts) streams the object back with Range
// support. DELETE is a soft delete (media.deleted = 1) plus the R2 delete.

import { env } from 'cloudflare:workers';
import { queryAll, queryFirst } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { imageSize, sniff, type Sniffed } from '@/lib/sniff';
import type { UserRef } from '@/lib/forks';

export function mediaBucket(): R2Bucket {
  const b = (env as unknown as { MEDIA?: R2Bucket }).MEDIA;
  if (!b) throw new HttpError(503, 'media storage not configured', 'bind an R2 bucket as MEDIA in wrangler.jsonc (r2_buckets)');
  return b;
}

export interface MediaRow {
  id: number;
  device_slug: string;
  fork_id: number | null;
  area_slug: string | null;
  history_id?: number | null;
  feature_id?: number | null;
  user_id: number;
  r2_key: string;
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  caption: string;
  created: string;
  deleted: number;
  display_name?: string | null;
  github_login?: string | null;
}

export interface Media {
  id: number;
  device_slug: string;
  fork_id: number | null;
  area_slug: string | null;
  /** The status change it is evidence for (status_history id, migration 0015). */
  history_id: number | null;
  /** The notable feature it shows (device_features id). */
  feature_id: number | null;
  url: string;
  content_type: string;
  kind: 'image' | 'video';
  bytes: number;
  width: number | null;
  height: number | null;
  caption: string;
  user: UserRef;
  created: string;
}

export const MEDIA_SELECT = `SELECT m.*, u.display_name, u.github_login FROM media m LEFT JOIN users u ON u.id = m.user_id`;

export function mediaUrl(key: string): string {
  return `/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function mapMedia(r: MediaRow): Media {
  return {
    id: r.id,
    device_slug: r.device_slug,
    fork_id: r.fork_id ?? null,
    area_slug: r.area_slug ?? null,
    history_id: r.history_id ?? null,
    feature_id: r.feature_id ?? null,
    url: mediaUrl(r.r2_key),
    content_type: r.content_type,
    kind: r.content_type.startsWith('video/') ? 'video' : 'image',
    bytes: r.bytes,
    width: r.width ?? null,
    height: r.height ?? null,
    caption: r.caption ?? '',
    user: { id: r.user_id, display_name: r.display_name ?? '', github_login: r.github_login ?? null },
    created: r.created,
  };
}

export async function loadMedia(id: string): Promise<MediaRow> {
  if (!/^\d{1,15}$/.test(id)) throw new HttpError(404, 'unknown media', 'media ids are numeric');
  const r = await queryFirst<MediaRow>(`${MEDIA_SELECT} WHERE m.id = ? AND m.deleted = 0`, [Number(id)]);
  if (!r) throw new HttpError(404, 'unknown media', 'GET /api/media?device=<slug> lists uploads');
  return r;
}

const CHUNK = 90;

/**
 * Check the links an upload may carry: a status change and a notable feature,
 * both on `device`. The change's area becomes the upload's area when none is
 * given; a different area is 400. -> {history_id, feature_id, area}.
 */
export async function mediaLinks(
  device: string,
  raw: { history?: string | number | null; feature?: string | number | null; area?: string | null },
): Promise<{ history_id: number | null; feature_id: number | null; area: string | null }> {
  const id = (v: unknown, what: string) => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).trim();
    if (!/^\d{1,15}$/.test(s)) throw new HttpError(400, `bad ${what}`, `${what} is numeric`);
    return Number(s);
  };
  let area = raw.area || null;
  const history_id = id(raw.history, 'history_id');
  const feature_id = id(raw.feature, 'feature_id');
  if (history_id !== null) {
    const h = await queryFirst<{ device_slug: string; area_slug: string }>('SELECT device_slug, area_slug FROM status_history WHERE id = ?', [history_id]);
    if (!h || h.device_slug !== device) {
      throw new HttpError(404, 'unknown status change', `history_id must be a status change of ${device} (GET /api/devices/${device}/history)`);
    }
    if (area && area !== h.area_slug) throw new HttpError(400, 'area mismatch', `status change #${history_id} is for ${h.area_slug}, not ${area}`);
    area = h.area_slug;
  }
  if (feature_id !== null) {
    const ft = await queryFirst<{ device_slug: string }>('SELECT device_slug FROM device_features WHERE id = ?', [feature_id]);
    if (!ft || ft.device_slug !== device) {
      throw new HttpError(404, 'unknown feature', `feature_id must be a feature of ${device} (GET /api/devices/${device}/features)`);
    }
  }
  return { history_id, feature_id, area };
}

/** The uploads linked to these status changes or features, by id. */
export async function mediaByLink(column: 'history_id' | 'feature_id', ids: number[]): Promise<Map<number, Media[]>> {
  const out = new Map<number, Media[]>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    if (!part.length) continue;
    const rows = await queryAll<MediaRow>(
      `${MEDIA_SELECT} WHERE m.deleted = 0 AND m.${column} IN (${part.map(() => '?').join(', ')}) ORDER BY m.id`,
      part,
    );
    for (const r of rows) {
      const k = Number(r[column]);
      (out.get(k) ?? out.set(k, []).get(k)!).push(mapMedia(r));
    }
  }
  return out;
}


/** Per device: the newest image and the upload count (deleted ones excluded). */
export async function mediaSummary(slugs: string[]): Promise<Map<string, { latest: Media | null; count: number }>> {
  const out = new Map<string, { latest: Media | null; count: number }>();
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const part = slugs.slice(i, i + CHUNK);
    const q = part.map(() => '?').join(', ');
    const [counts, latest] = await Promise.all([
      queryAll<{ device_slug: string; n: number }>(
        `SELECT device_slug, COUNT(*) AS n FROM media WHERE deleted = 0 AND device_slug IN (${q}) GROUP BY device_slug`,
        part,
      ),
      queryAll<MediaRow>(
        `${MEDIA_SELECT} WHERE m.id IN (SELECT MAX(id) FROM media WHERE deleted = 0 AND content_type LIKE 'image/%'
           AND device_slug IN (${q}) GROUP BY device_slug)`,
        part,
      ),
    ]);
    for (const c of counts) out.set(c.device_slug, { latest: null, count: Number(c.n) });
    for (const l of latest) {
      const e = out.get(l.device_slug) ?? { latest: null, count: 0 };
      e.latest = mapMedia(l);
      out.set(l.device_slug, e);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Streaming upload into R2                                            */
/* ------------------------------------------------------------------ */

/** R2 multipart parts: at least 5 MiB, all but the last the same size. */
export const PART_BYTES = 8 * 1024 * 1024;
const SNIFF_BYTES = 64;

export class R2Upload {
  private pending: Uint8Array[] = [];
  private pendingLen = 0;
  private mpu: R2MultipartUpload | null = null;
  private parts: R2UploadedPart[] = [];
  sniffed: Sniffed | null = null;
  total = 0;
  width: number | null = null;
  height: number | null = null;
  written = false;
  private completed = false;

  constructor(
    private bucket: R2Bucket,
    readonly key: (s: Sniffed) => string,
  ) {}

  private resolvedKey = '';
  get r2Key(): string {
    return this.resolvedKey;
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const c = this.pending[0];
      const need = n - o;
      if (c.length <= need) {
        out.set(c, o);
        o += c.length;
        this.pending.shift();
      } else {
        out.set(c.subarray(0, need), o);
        this.pending[0] = c.subarray(need);
        o += need;
      }
    }
    this.pendingLen -= n;
    return out;
  }

  private peek(n: number): Uint8Array {
    const out = new Uint8Array(Math.min(n, this.pendingLen));
    let o = 0;
    for (const c of this.pending) {
      if (o >= out.length) break;
      const piece = c.subarray(0, out.length - o);
      out.set(piece, o);
      o += piece.length;
    }
    return out;
  }

  private detect(): void {
    if (this.sniffed) return;
    const s = sniff(this.peek(SNIFF_BYTES));
    if (!s) {
      throw new HttpError(
        415,
        'unsupported media type',
        'upload image/jpeg, png, webp or avif (15 MB max) or video/mp4, webm or quicktime (95 MB max); the type is read from the file bytes',
      );
    }
    this.sniffed = s;
    this.resolvedKey = this.key(s);
    this.checkSize();
  }

  private checkSize(): void {
    if (this.sniffed && this.total > this.sniffed.max) {
      const mb = Math.round(this.sniffed.max / 1048576);
      throw new HttpError(413, 'file too large', `${this.sniffed.kind}s are limited to ${mb} MB`);
    }
  }

  private dims(bytes: Uint8Array): void {
    if (this.sniffed?.kind !== 'image' || this.width !== null) return;
    const d = imageSize(this.sniffed.type, bytes);
    if (d && d.width > 0 && d.height > 0 && d.width < 1e6 && d.height < 1e6) {
      this.width = d.width;
      this.height = d.height;
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (!chunk.length) return;
    this.total += chunk.length;
    this.pending.push(chunk.slice());
    this.pendingLen += chunk.length;
    if (!this.sniffed && this.pendingLen >= SNIFF_BYTES) this.detect();
    this.checkSize();
    while (this.pendingLen >= PART_BYTES + 1) {
      const body = this.take(PART_BYTES);
      this.dims(body);
      if (!this.mpu) {
        this.mpu = await this.bucket.createMultipartUpload(this.resolvedKey, { httpMetadata: { contentType: this.sniffed!.type } });
        this.written = true;
      }
      this.parts.push(await this.mpu.uploadPart(this.parts.length + 1, body));
    }
  }

  async end(): Promise<void> {
    if (!this.total) throw new HttpError(400, 'empty file', 'the file part has no bytes');
    this.detect();
    const rest = this.take(this.pendingLen);
    this.dims(rest);
    if (this.mpu) {
      if (rest.length) this.parts.push(await this.mpu.uploadPart(this.parts.length + 1, rest));
      await this.mpu.complete(this.parts);
      this.completed = true;
    } else {
      this.written = true;
      await this.bucket.put(this.resolvedKey, rest, { httpMetadata: { contentType: this.sniffed!.type } });
    }
  }

  /** Undo whatever reached R2 (a failed or refused upload). */
  async abort(): Promise<void> {
    try {
      if (this.mpu && !this.completed) await this.mpu.abort();
      else if (this.written && this.resolvedKey) await this.bucket.delete(this.resolvedKey);
    } catch (e) {
      console.error('media abort failed:', e);
    }
  }
}
