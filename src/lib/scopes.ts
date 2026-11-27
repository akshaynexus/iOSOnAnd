// src/lib/scopes.ts — API key scopes and the one rule that says which scope a
// request needs. Dependency-free: src/lib/auth.ts enforces it (requireUser,
// which every write route calls through requireAdmin, requireDeviceEditor,
// requirePoster or directly), src/lib/openapi.ts documents it per operation
// (`x-scope`), and tests/api/openapi.test.ts imports it outside the Worker.
//
// A session cookie is not scoped. A token with `all` may do everything its
// owner may do. Every scope includes reading (GET/HEAD with the token). A
// scope never adds rights: the owner's trust level (admin, maintainer) still
// decides; the scope only narrows what the key may be used for.

export const SCOPES = ['all', 'read', 'status:write', 'fork:write', 'post:write', 'media:write'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_TEXT: Record<Scope, string> = {
  all: 'everything the owner may do, including keys, claims and account changes',
  read: 'only reads (GET) that need a login, such as /api/auth/me',
  'status:write': 'status cells, other notable features and device fields (PUT/POST /api/status..., /api/devices/{slug}/features..., PATCH /api/devices/{slug})',
  'fork:write': 'forks, repo claims and repo support rows (/api/forks..., /api/repos...)',
  'post:write': 'posts and the Reddit fetch (/api/posts..., /api/reddit/fetch)',
  'media:write': 'uploads and their deletion (/api/media...), and photo updates on a phone (/api/devices/{slug}/updates)',
};

/** [method regex, path regex, scope]; the first match wins. Paths may hold {params}. */
const RULES: Array<[RegExp, RegExp, Scope]> = [
  [/^(GET|HEAD|OPTIONS)$/, /.*/, 'read'],
  [/.*/, /^\/api\/status(\/|$)/, 'status:write'],
  [/^PATCH$/, /^\/api\/devices\/[^/]+$/, 'status:write'],
  [/.*/, /^\/api\/devices\/[^/]+\/features(\/|$)/, 'status:write'],
  [/.*/, /^\/api\/devices\/[^/]+\/gpu(\/|$)/, 'status:write'],
  [/^POST$/, /^\/api\/porting\/[^/]+\/apply$/, 'status:write'],
  [/.*/, /^\/api\/(forks|repos)(\/|$)/, 'fork:write'],
  [/.*/, /^\/api\/(posts(\/|$)|reddit\/)/, 'post:write'],
  [/.*/, /^\/api\/media(\/|$)/, 'media:write'],
  [/.*/, /^\/api\/devices\/[^/]+\/updates(\/|$)/, 'media:write'],
];

/** The scope a token needs for `method path`; `all` when no rule matches. */
export function scopeFor(method: string, path: string): Scope {
  const m = method.toUpperCase();
  for (const [mr, pr, scope] of RULES) if (mr.test(m) && pr.test(path)) return scope;
  return 'all';
}

/** True when a token holding `held` may make a request that needs `need`. */
export function scopeAllows(held: readonly string[], need: Scope): boolean {
  if (held.includes('all')) return true;
  if (need === 'read') return held.length > 0;
  return held.includes(need);
}

/** Parse a scopes value (array or "a,b" string). Throws a message on a bad scope. */
export function parseScopes(raw: unknown): Scope[] {
  const list = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : raw == null ? [] : [raw])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!list.length) return ['all'];
  const bad = list.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (bad.length) throw new Error(`unknown scope ${bad.join(', ')}; use: ${SCOPES.join(' | ')}`);
  if (list.includes('all')) return ['all'];
  return [...new Set(list)].sort() as Scope[];
}
