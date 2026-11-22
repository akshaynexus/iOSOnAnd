// src/lib/posts.ts — reddit_posts field validation (POST and PATCH).

import { HttpError, normalizeRedditUrl, str, validDate } from '@/lib/auth';

const URL_HINT = 'url must be a reddit post: https://www.reddit.com/r/<sub>/comments/..., old.reddit.com, or https://redd.it/<id>';

export interface PostFields {
  title?: string;
  url?: string;
  published?: string;
  note?: string;
  image_url?: string;
  image_width?: number | null;
  image_height?: number | null;
}

function dim(body: Record<string, any>, k: string): number | null {
  const v = body[k];
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 20000) throw new HttpError(400, `bad ${k}`, `${k} is a whole number of pixels (1 to 20000), or null`);
  return n;
}

/**
 * Validated {title,url,published,note,image_url,image_width,image_height};
 * only keys present in body (all of title+url when `create`). image_url: an
 * https:// URL (e.g. i.redd.it, preview.redd.it) or '' for none.
 */
export function postFields(body: Record<string, any>, create: boolean): PostFields {
  const out: PostFields = {};
  if (create || body.title !== undefined) {
    out.title = str(body, 'title', 300);
    if (!out.title) throw new HttpError(400, 'title required', 'send {"title","url"} plus optional published/note');
  }
  if (create || body.url !== undefined) {
    const raw = str(body, 'url', 500);
    const url = raw ? normalizeRedditUrl(raw) : null;
    if (!url) throw new HttpError(400, 'bad url', URL_HINT);
    out.url = url;
  }
  if (body.published !== undefined && body.published !== '') {
    out.published = str(body, 'published', 10);
    if (!validDate(out.published)) throw new HttpError(400, 'bad published', 'use a real date as YYYY-MM-DD');
  }
  if (body.note !== undefined) out.note = str(body, 'note', 1000);
  if (body.image_url !== undefined) {
    out.image_url = str(body, 'image_url', 1000);
    if (out.image_url && !/^https:\/\/[^\s]+$/.test(out.image_url)) {
      throw new HttpError(400, 'bad image_url', 'image_url must be an https:// URL (or empty for none)');
    }
  }
  if (body.image_width !== undefined) out.image_width = dim(body, 'image_width');
  if (body.image_height !== undefined) out.image_height = dim(body, 'image_height');
  return out;
}
