// src/lib/api.ts — one wrapper for every /api route's server handlers.
//
//   server: { handlers: apiHandlers({ GET: ..., PUT: ... }) }
//
// - Errors become {error, hint} JSON (handleError), never the HTML shell.
// - Any method the route does not define gets a JSON 405 with an Allow header
//   (TanStack Start falls back to the `ANY` handler, then to SSR, so without
//   this an unsupported method returned the HTML page with 200).
// - Unknown /api paths are answered by src/routes/api/$.ts (JSON 404).
// - CSRF: unsafe methods with a foreign Origin are refused (403). Every cookie-
//   authenticated unsafe request (same-site Origin or none) must also show it was not sent by a
//   cross-site <form>: Content-Type: application/json, or the header
//   X-Requested-With: iosonand (uploads are multipart, so the page sends the
//   header; a cross-site page cannot add a custom header without a CORS
//   preflight, which this API never allows). When Sec-Fetch-Site is sent it
//   must be same-origin or same-site. Bearer-token clients (the CLI) send no
//   cookie and are unaffected.

import { HttpError, SESSION_COOKIE, apiError, getCookie, handleError } from '@/lib/auth';

export type ApiCtx = { request: Request; params: Record<string, string> };
export type ApiHandler = (ctx: ApiCtx) => Promise<Response> | Response;
type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Throws 403 when an unsafe request looks cross-site. */
/** The header a page sends on cookie writes that cannot be JSON (multipart uploads). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'iosonand';

export function checkCsrf(req: Request): void {
  if (SAFE.has(req.method.toUpperCase())) return;
  const origin = req.headers.get('origin');
  if (origin) {
    const own = new Set(
      [req.headers.get('host'), req.headers.get('x-forwarded-host'), hostOf(req.url)]
        .filter((h): h is string => !!h)
        .map((h) => h.toLowerCase()),
    );
    const o = origin === 'null' ? null : hostOf(origin);
    if (!o || !own.has(o)) {
      throw new HttpError(403, 'cross-origin write refused', 'call the API from the tracker site itself, or use a Bearer token');
    }
  }
  if (!getCookie(req, SESSION_COOKIE)) return; // no ambient credentials to abuse
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'same-site') {
    throw new HttpError(403, 'cross-site write refused', 'call the API from the tracker site itself, or use a Bearer token');
  }
  const ct = req.headers.get('content-type') || '';
  if (/^application\/json\b/i.test(ct)) return;
  if ((req.headers.get(CSRF_HEADER) || '').toLowerCase() === CSRF_HEADER_VALUE) return;
  throw new HttpError(
    403,
    'json content-type required',
    'cookie-authenticated writes must send Content-Type: application/json, or the header X-Requested-With: iosonand (uploads), or use Authorization: Bearer',
  );
}

export function apiHandlers(map: Partial<Record<Method, ApiHandler>>): Record<string, ApiHandler> {
  const methods = Object.keys(map) as Method[];
  if (map.GET && !map.HEAD) methods.push('HEAD');
  const allow = methods.join(', ');
  const out: Record<string, ApiHandler> = {};
  for (const [m, h] of Object.entries(map) as Array<[Method, ApiHandler]>) {
    out[m] = async (ctx) => {
      try {
        checkCsrf(ctx.request);
        return await h(ctx);
      } catch (e) {
        return handleError(e);
      }
    };
  }
  out.ANY = ({ request }) =>
    apiError(405, `method ${request.method.toUpperCase()} not allowed`, `this endpoint accepts: ${allow}; GET /api/docs lists every endpoint`, {
      allow,
    });
  return out;
}
