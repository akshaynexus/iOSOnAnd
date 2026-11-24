// src/lib/ratelimit.ts — per-caller request limits for every /api route.
//
// apiHandlers() (src/lib/api.ts) calls checkRateLimit() before each handler.
// The limits are Workers Rate Limiting bindings declared in wrangler.jsonc
// (`ratelimits`): each counts calls per key per 60 s in the Cloudflare
// location that served the request. That is approximate and per location,
// which is what abuse protection needs; it is not a billing quota.
//
//   bucket      binding         key                  limit / 60 s
//   auth        RL_AUTH         client IP            20  login, signup, link, password reset
//   authEmail   RL_AUTH_EMAIL   the email in the body 5  login, link, reset request (per target account)
//   expensive   RL_EXPENSIVE    user, else IP        10  calls out to GitHub or Reddit
//   upload      RL_UPLOAD       user, else IP        20  POST /api/media
//   write       RL_WRITE        user, else IP        60  every other non-GET
//   read        RL_READ         client IP           300  GET and HEAD
//
// A logged-in admin skips expensive, upload and write (not the sign-in limits).
// Over the limit: 429 {error, hint} with Retry-After: 60. A missing binding
// (an old wrangler.jsonc) lets the request through. RATE_LIMITS=off in
// .dev.vars turns every limit off, for local test runs only.

import { env as cfEnv } from 'cloudflare:workers';
import { HttpError, authInfo, env, isAdmin, sha256Hex } from '@/lib/auth';
import { BUCKETS, bucketFor, type Bucket } from '@/lib/ratebuckets';

export { BUCKETS, bucketFor, type Bucket };

interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** The caller's IP as Cloudflare saw it ('local' in dev, where the header is absent). */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') || 'local';
}

function limiter(bucket: Bucket): RateLimiter | null {
  const b = (cfEnv as unknown as Record<string, RateLimiter | undefined>)[BUCKETS[bucket].binding];
  return b && typeof b.limit === 'function' ? b : null;
}

export function rateLimitsOff(): boolean {
  return (env('RATE_LIMITS') || '').toLowerCase() === 'off';
}

function tooMany(bucket: Bucket): HttpError {
  const what = bucket === 'auth' || bucket === 'authEmail' ? 'sign-in attempts' : 'requests';
  return new HttpError(429, 'rate limited', `too many ${what}; wait a minute and retry`, { 'retry-after': '60' });
}

/** Count one call against `bucket` for `key`; throws 429 when over. */
export async function hit(bucket: Bucket, key: string): Promise<void> {
  if (rateLimitsOff()) return;
  const rl = limiter(bucket);
  if (!rl) return;
  let ok = true;
  try {
    ok = (await rl.limit({ key: `${bucket}:${key}` })).success;
  } catch (e) {
    console.error('rate limit check failed:', e); // fail open: never lock everyone out
  }
  if (!ok) throw tooMany(bucket);
}

/** Per-account limit for sign-in style calls (login, link, reset). */
export async function hitEmail(email: string): Promise<void> {
  if (!email) return;
  await hit('authEmail', await sha256Hex(email.trim().toLowerCase()));
}

/** The route-independent check apiHandlers runs before every handler. */
export async function checkRateLimit(req: Request): Promise<void> {
  if (rateLimitsOff()) return;
  const path = new URL(req.url).pathname;
  const bucket = bucketFor(req.method, path);
  if (bucket === 'read' || bucket === 'auth') return hit(bucket, clientIp(req));
  // Writes count per account when the caller is logged in (authInfo is cached
  // per Request, so the handler does not look it up again), else per IP.
  // Admins are not counted: they already may do everything, and their sync
  // scripts (scripts/sync-hakios.mjs) write hundreds of rows in a row.
  const who = await authInfo(req);
  if (who.user && isAdmin(who.user)) return;
  await hit(bucket, who.user ? `u${who.user.id}` : `ip:${clientIp(req)}`);
}
