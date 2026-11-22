// GET /media/<key> — an upload, streamed from R2 (the MEDIA binding). Not an
// /api route: <img src> and <video src> load it directly.
//   - Content-Type from the stored (sniffed) type, nosniff, a sandboxing CSP
//   - Cache-Control: public, max-age=31536000, immutable (keys never change)
//   - ETag / If-None-Match -> 304
//   - Range: bytes=a-b | a- | -n -> 206 with Content-Range (video seeking);
//     an unsatisfiable range -> 416
//   - a deleted or unknown key -> 404 (DELETE /api/media/{id} removes the object)

import { createFileRoute } from '@tanstack/react-router';
import { mediaBucket } from '@/lib/media';

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}\/[A-Za-z0-9._-]{1,120}$/;

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Parse one `bytes=` range against `size`; null = no/ignored Range, 'bad' = unsatisfiable. */
function parseRange(h: string | null, size: number): { offset: number; length: number } | null | 'bad' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // multiple ranges or junk: send the whole object
  if (m[1] === '') {
    const n = Math.min(Number(m[2]), size);
    if (n <= 0) return 'bad';
    return { offset: size - n, length: n };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'bad';
  return { offset: start, length: end - start + 1 };
}

async function serve(request: Request, splat: string | undefined, head: boolean): Promise<Response> {
  let key = '';
  try {
    key = decodeURIComponent(splat ?? '');
  } catch {
    return notFound();
  }
  if (!KEY_RE.test(key)) return notFound();
  const bucket = mediaBucket();
  const meta = await bucket.head(key);
  if (!meta) return notFound();
  const headers = new Headers({
    'content-type': meta.httpMetadata?.contentType || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
    etag: meta.httpEtag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
  });
  const inm = request.headers.get('if-none-match');
  if (inm && inm.split(',').map((s) => s.trim()).includes(meta.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }
  const range = parseRange(request.headers.get('range'), meta.size);
  if (range === 'bad') {
    headers.set('content-range', `bytes */${meta.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`);
    headers.set('content-length', String(range.length));
    if (head) return new Response(null, { status: 206, headers });
    const obj = await bucket.get(key, { range });
    if (!obj) return notFound();
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(meta.size));
  if (head) return new Response(null, { status: 200, headers });
  const obj = await bucket.get(key);
  if (!obj) return notFound();
  return new Response(obj.body, { status: 200, headers });
}

export const Route = createFileRoute('/media/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => serve(request, (params as { _splat?: string })._splat, false),
      HEAD: ({ request, params }) => serve(request, (params as { _splat?: string })._splat, true),
    },
  },
});
