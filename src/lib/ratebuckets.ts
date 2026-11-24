// src/lib/ratebuckets.ts — which rate-limit bucket a request counts against.
// Dependency-free so tests/api/unit.test.ts and src/lib/openapi.ts can import
// it outside the Worker; src/lib/ratelimit.ts enforces it. Keep `limit` equal
// to the matching `ratelimits` entry in wrangler.jsonc (unit-tested).

export type Bucket = 'auth' | 'authEmail' | 'expensive' | 'upload' | 'write' | 'read';

export const BUCKETS: Record<Bucket, { binding: string; limit: number }> = {
  auth: { binding: 'RL_AUTH', limit: 20 },
  authEmail: { binding: 'RL_AUTH_EMAIL', limit: 5 },
  expensive: { binding: 'RL_EXPENSIVE', limit: 10 },
  upload: { binding: 'RL_UPLOAD', limit: 20 },
  write: { binding: 'RL_WRITE', limit: 60 },
  read: { binding: 'RL_READ', limit: 300 },
};

const AUTH_PATHS = /^\/api\/auth\/(login|signup|register|link|password-reset(\/confirm)?|password|gh-challenge|gh-verify|token-check)$/;
const EXPENSIVE_PATHS = /^\/api\/(reddit\/fetch|forks\/sync|repos\/claim(\/[^/]+\/verify)?|auth\/gh-link)$/;

/** Which bucket a request counts against. Pure; unit-tested. */
export function bucketFor(method: string, path: string): Bucket {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
  if (AUTH_PATHS.test(path)) return 'auth';
  if (EXPENSIVE_PATHS.test(path)) return 'expensive';
  if (path === '/api/media') return 'upload';
  return 'write';
}

