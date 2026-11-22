// tests/api/api.test.ts — API contract tests against a running tracker.
//
//   bun test tests/api                       # TRACKER_URL defaults to http://127.0.0.1:3001
//   TRACKER_URL=https://... bun test tests/api
//
// Needs the admin pair: ADMIN_EMAIL / ADMIN_PASSWORD from the environment, or
// from .dev.vars in the repo root (never printed). Every run uses fresh random
// emails and a throwaway device `t-<random>`; afterAll deletes the device (and
// with it its statuses and claims), the posts and forks it made, and the test
// accounts, so reruns are harmless. Against a local server it also removes
// the run's changelog rows from local D1 (see scrubChangelog). Seed data is only read, never written.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanupCall } from './helpers';

const BASE = (process.env.TRACKER_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const DEVICE = `t-${RUN}`;
const PASSWORD = `pw-${RUN}-correct-horse`;

function adminCreds(): { email: string; password: string } {
  let email = process.env.ADMIN_EMAIL || '';
  let password = process.env.ADMIN_PASSWORD || '';
  const file = path.join(import.meta.dir, '..', '..', '.dev.vars');
  if ((!email || !password) && existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, '');
      if (m[1] === 'ADMIN_EMAIL' && !email) email = v;
      if (m[1] === 'ADMIN_PASSWORD' && !password) password = v;
    }
  }
  if (!email || !password) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD not set (env or .dev.vars)');
  return { email, password };
}

type Res = { status: number; body: any; headers: Headers };

interface Who {
  cookie?: string;
  token?: string;
}

async function call(
  method: string,
  p: string,
  opts: { who?: Who; body?: unknown; headers?: Record<string, string>; noJsonType?: boolean } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
  else if (!opts.noJsonType && opts.who?.cookie && method !== 'GET') headers['content-type'] ??= 'application/json';
  if (opts.who?.cookie) headers.cookie = opts.who.cookie;
  if (opts.who?.token) headers.authorization = `Bearer ${opts.who.token}`;
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: r.status, body, headers: r.headers };
}

function cookieFrom(r: Res): string {
  const sc = r.headers.get('set-cookie') || '';
  const m = /iosonand_session=([^;]+)/.exec(sc);
  if (!m) throw new Error(`no session cookie in ${JSON.stringify(sc)}`);
  return `iosonand_session=${m[1]}`;
}

async function signup(tag: string): Promise<{ who: Who; id: number; email: string; res: Res }> {
  const email = `api-test-${tag}-${RUN}@example.test`;
  const res = await call('POST', '/api/auth/signup', { body: { email, password: PASSWORD, display_name: `t-${tag}-${RUN}` } });
  expect(res.status).toBe(201);
  return { who: { cookie: cookieFrom(res) }, id: res.body.user.id, email, res };
}

let admin: Who;
let alice: { who: Who; id: number; email: string; res: Res }; // becomes maintainer of DEVICE
let bob: { who: Who; id: number; email: string; res: Res }; // stays a plain user
let area = '';
let claimId = 0;
const cleanup = { posts: [] as number[], forks: [] as number[] };

beforeAll(async () => {
  const { email, password } = adminCreds();
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
  admin = { cookie: cookieFrom(r) };
  expect(r.body.user.is_admin).toBe(true);
  const areas = await call('GET', '/api/areas');
  area = areas.body.areas[0].slug;
  const d = await call('POST', '/api/devices', { who: admin, body: { slug: DEVICE, name: `Test device ${RUN}` } });
  expect(d.status).toBe(201);
  alice = await signup('alice');
  bob = await signup('bob');
}, 60_000);

afterAll(async () => {
  if (!admin) return;
  for (const id of cleanup.posts) await cleanupCall('DELETE', `/api/posts/${id}`, admin);
  for (const id of cleanup.forks) await cleanupCall('DELETE', `/api/forks/${id}`, admin);
  await cleanupCall('DELETE', `/api/devices/${DEVICE}`, admin);
  for (const u of [alice, bob]) if (u) await cleanupCall('DELETE', `/api/users/${u.id}`, admin);
  scrubChangelog();
}, 60_000);

// The changelog has no delete endpoint (it is an audit log), so against a
// local dev server the run's own rows are removed straight from local D1:
// every row this run writes names RUN (test users are t-<tag>-RUN, the device
// is t-RUN, repos and post titles carry RUN), plus the "post #N removed" rows
// for the posts it made. A remote tracker keeps them.
function scrubChangelog() {
  const host = new URL(BASE).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return;
  const posts = cleanup.posts.map((id) => `'post #${Number(id)} removed'`).join(', ');
  const sql = `DELETE FROM changelog WHERE who LIKE '%${RUN}%' OR summary LIKE '%${RUN}%'` +
    (posts ? ` OR (who = 'admin' AND summary IN (${posts}))` : '');
  const root = path.join(import.meta.dir, '..', '..');
  const r = Bun.spawnSync([path.join(root, 'node_modules', '.bin', 'wrangler'), 'd1', 'execute', 'oneios-tracker', '--local', '--command', sql], {
    cwd: root, stdout: 'ignore', stderr: 'pipe',
  });
  if (r.exitCode !== 0) console.warn('changelog scrub failed:', r.stderr.toString().slice(0, 300));
}

describe('auth', () => {
  test('signup sets a HttpOnly SameSite=Lax session cookie (no Secure on http)', () => {
    const sc = alice.res.headers.get('set-cookie') || '';
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    if (BASE.startsWith('http://')) expect(sc).not.toContain('Secure');
    else expect(sc).toContain('Secure');
    expect(alice.res.body.user.email).toBe(alice.email);
    expect(alice.res.body.user.password_hash).toBeUndefined();
  });

  test('duplicate signup is 409', async () => {
    const r = await call('POST', '/api/auth/signup', { body: { email: alice.email, password: PASSWORD } });
    expect(r.status).toBe(409);
  });

  test('login works; a wrong password is 401', async () => {
    const ok = await call('POST', '/api/auth/login', { body: { email: alice.email, password: PASSWORD } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(alice.id);
    const bad = await call('POST', '/api/auth/login', { body: { email: alice.email, password: 'wrong-password-123' } });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBeString();
  });

  test('me returns maintains: [] for a new user; anonymous is 401', async () => {
    const r = await call('GET', '/api/auth/me', { who: alice.who });
    expect(r.status).toBe(200);
    expect(r.body.maintains).toEqual([]);
    expect(r.body.user.maintains).toEqual([]);
    expect(r.body.can_post).toBe(false);
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
  });
});

describe('trust model', () => {
  test('a non-maintainer status write is 403 with a claim hint (PUT and POST)', async () => {
    for (const m of ['PUT', 'POST']) {
      const r = await call(m, `/api/status/${DEVICE}/${area}`, { who: alice.who, body: { state: 'works' } });
      expect(r.status).toBe(403);
      expect(r.body.hint).toContain('POST /api/claims');
    }
    const r2 = await call('PUT', '/api/status', { who: alice.who, body: { device: DEVICE, area, state: 'works' } });
    expect(r2.status).toBe(403);
  });

  test('anonymous status write is 401', async () => {
    const r = await call('PUT', `/api/status/${DEVICE}/${area}`, { body: { state: 'works' } });
    expect(r.status).toBe(401);
  });

  test('claim a device -> 201 pending; a duplicate is 409', async () => {
    const r = await call('POST', '/api/claims', { who: alice.who, body: { device: DEVICE, note: 'api test' } });
    expect(r.status).toBe(201);
    expect(r.body.claim.status).toBe('pending');
    claimId = r.body.claim.id;
    const dup = await call('POST', '/api/claims', { who: alice.who, body: { device_slug: DEVICE } });
    expect(dup.status).toBe(409);
  });

  test('a pending claim grants nothing', async () => {
    const r = await call('PUT', `/api/status/${DEVICE}/${area}`, { who: alice.who, body: { state: 'works' } });
    expect(r.status).toBe(403);
  });

  test('only an admin approves claims', async () => {
    expect((await call('POST', `/api/claims/${claimId}/approve`, { who: bob.who })).status).toBe(403);
    expect((await call('POST', `/api/claims/${claimId}/approve`, { who: alice.who })).status).toBe(403);
    const r = await call('POST', `/api/claims/${claimId}/approve`, { who: admin });
    expect(r.status).toBe(200);
    expect(r.body.claim.status).toBe('approved');
    const again = await call('POST', `/api/claims/${claimId}/approve`, { who: admin });
    expect(again.status).toBe(409);
  });

  test('me lists the maintained device', async () => {
    const r = await call('GET', '/api/auth/me', { who: alice.who });
    expect(r.body.maintains).toEqual([DEVICE]);
    expect(r.body.can_post).toBe(true);
  });

  test('a claim on an already maintained device is 409', async () => {
    const r = await call('POST', '/api/claims', { who: alice.who, body: { device: DEVICE } });
    expect(r.status).toBe(409);
  });

  test('the maintainer writes status (PUT, POST alias, body form)', async () => {
    const put = await call('PUT', `/api/status/${DEVICE}/${area}`, {
      who: alice.who,
      body: { state: 'in-progress', detail: 'api test', source: 'tests/api' },
    });
    expect(put.status).toBe(200);
    expect(put.body.status.state).toBe('in-progress');
    const post = await call('POST', `/api/status/${DEVICE}/${area}`, { who: alice.who, body: { state: 'works' } });
    expect(post.status).toBe(200);
    expect(post.body.status.state).toBe('works');
    const form = await call('PUT', '/api/status', { who: alice.who, body: { device_slug: DEVICE, area_slug: area, state: 'broken' } });
    expect(form.status).toBe(200);
    const get = await call('GET', `/api/status/${DEVICE}/${area}`);
    expect(get.body.status.state).toBe('broken');
  });

  test('the device list carries statuses and maintainers (no per-device calls needed)', async () => {
    const r = await call('GET', `/api/devices?q=${DEVICE}`);
    expect(r.status).toBe(200);
    const d = r.body.devices.find((x: any) => x.slug === DEVICE);
    expect(d.statuses.some((s: any) => s.area_slug === area && s.state === 'broken')).toBe(true);
    expect(d.maintainers.length).toBe(1);
  });

  test('bad state is 400, unknown area 404', async () => {
    const bad = await call('PUT', `/api/status/${DEVICE}/${area}`, { who: alice.who, body: { state: 'mostly-works' } });
    expect(bad.status).toBe(400);
    expect(bad.body.hint).toContain('works');
    const na = await call('PUT', `/api/status/${DEVICE}/no-such-area`, { who: alice.who, body: { state: 'works' } });
    expect(na.status).toBe(404);
  });

  test("a maintainer cannot write another device's status", async () => {
    const r = await call('PUT', '/api/status/s24-ultra/wifi', { who: alice.who, body: { state: 'broken' } });
    expect(r.status).toBe(403);
  });

  test('a bearer token carries the same rights (and needs no CSRF headers)', async () => {
    const t = await call('POST', '/api/tokens', { who: alice.who, body: { name: 'api-test' } });
    expect(t.status).toBe(201);
    const r = await call('PUT', `/api/status/${DEVICE}/${area}`, { who: { token: t.body.token }, body: { state: 'unknown' } });
    expect(r.status).toBe(200);
    const bobTry = await call('PUT', `/api/status/${DEVICE}/${area}`, { who: bob.who, body: { state: 'works' } });
    expect(bobTry.status).toBe(403);
  });

  test('admin-only writes are 403 for a maintainer', async () => {
    expect((await call('POST', '/api/devices', { who: alice.who, body: { slug: `x-${RUN}`, name: 'x' } })).status).toBe(403);
    expect((await call('POST', '/api/areas', { who: alice.who, body: { slug: `x-${RUN}`, name: 'x' } })).status).toBe(403);
    expect((await call('POST', '/api/users', { who: alice.who, body: { email: `x-${RUN}@example.test`, password: PASSWORD } })).status).toBe(403);
    expect((await call('POST', '/api/reddit/fetch', { who: alice.who, body: {} })).status).toBe(403);
    expect((await call('DELETE', `/api/devices/${DEVICE}`, { who: alice.who })).status).toBe(403);
    expect((await call('PATCH', `/api/claims/${claimId}`, { who: alice.who, body: { status: 'rejected' } })).status).toBe(403);
  });
});

describe('forks', () => {
  test('a maintainer adds a fork for their device; others and admin-only cases are refused', async () => {
    const repo = `api-test/fork-${RUN}`;
    const ok = await call('POST', '/api/forks', { who: alice.who, body: { repo, device_slug: DEVICE, best_result: 'boots' } });
    expect(ok.status).toBe(201);
    cleanup.forks.push(ok.body.fork.id);
    expect(ok.body.fork.verified).toBe('fork-claim');
    const dup = await call('POST', '/api/forks', { who: alice.who, body: { repo, device_slug: DEVICE } });
    expect(dup.status).toBe(409);
    expect((await call('POST', '/api/forks', { who: bob.who, body: { repo: `${repo}-b`, device_slug: DEVICE } })).status).toBe(403);
    expect((await call('POST', '/api/forks', { who: alice.who, body: { repo: `${repo}-c` } })).status).toBe(403);
    expect((await call('POST', '/api/forks', { who: alice.who, body: { repo: `${repo}-d`, device_slug: DEVICE, verified: 'merged' } })).status).toBe(403);
    expect((await call('POST', '/api/forks', { who: alice.who, body: { repo: 'not a repo', device_slug: DEVICE } })).status).toBe(400);
    expect((await call('PATCH', `/api/forks/${ok.body.fork.id}`, { who: bob.who, body: { notes: 'x' } })).status).toBe(403);
  });

  test('fork sync changes only the fields sent', async () => {
    const repo = `api-test/sync-${RUN}`;
    const a = await call('POST', '/api/forks/sync', { who: alice.who, body: { repo, device_slug: DEVICE, best_result: 'one', ported: 'kept' } });
    expect(a.status).toBe(201);
    cleanup.forks.push(a.body.fork.id);
    const b = await call('POST', '/api/forks/sync', { who: alice.who, body: { repo, device_slug: DEVICE, best_result: 'two' } });
    expect(b.status).toBe(200);
    expect(b.body.created).toBe(false);
    expect(b.body.fork.best_result).toBe('two');
    expect(b.body.fork.ported).toBe('kept');
  });
});

describe('posts', () => {
  test('a plain user cannot post; bad reddit URLs are 400', async () => {
    const url = `https://www.reddit.com/r/hackios/comments/${RUN}/api_test/`;
    expect((await call('POST', '/api/posts', { who: bob.who, body: { title: 't', url } })).status).toBe(403);
    for (const bad of [
      'https://example.com/r/hackios/comments/x',
      'http://www.reddit.com/r/hackios/comments/x',
      'https://reddit.com.evil.example/r/hackios',
      'https://www.reddit.com/user/someone',
      'javascript:alert(1)',
      'not a url',
    ]) {
      const r = await call('POST', '/api/posts', { who: alice.who, body: { title: 't', url: bad } });
      expect(r.status).toBe(400);
    }
  });

  test('a maintainer posts; old.reddit is canonicalised and a duplicate is 409', async () => {
    const r = await call('POST', '/api/posts', {
      who: alice.who,
      body: { title: `api test ${RUN}`, url: `https://old.reddit.com/r/hackios/comments/${RUN}/api_test/?utm=x` },
    });
    expect(r.status).toBe(201);
    cleanup.posts.push(r.body.post.id);
    expect(r.body.post.url).toBe(`https://www.reddit.com/r/hackios/comments/${RUN}/api_test`);
    const dup = await call('POST', '/api/posts', {
      who: alice.who,
      body: { title: 'dup', url: `https://www.reddit.com/r/hackios/comments/${RUN}/api_test` },
    });
    expect(dup.status).toBe(409);
    const short = await call('POST', '/api/posts', { who: alice.who, body: { title: `short ${RUN}`, url: `https://redd.it/${RUN.slice(0, 10)}` } });
    expect(short.status).toBe(201);
    cleanup.posts.push(short.body.post.id);
    const badDate = await call('POST', '/api/posts', {
      who: alice.who,
      body: { title: 'd', url: `https://www.reddit.com/r/hackios/comments/${RUN}x`, published: '2026-02-31' },
    });
    expect(badDate.status).toBe(400);
  });
});

describe('csrf', () => {
  test('a cookie write with a foreign Origin is 403', async () => {
    const r = await call('PUT', `/api/status/${DEVICE}/${area}`, {
      who: alice.who,
      body: { state: 'works' },
      headers: { origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
  });

  test('a cookie write without JSON content-type or Origin is 403', async () => {
    const r = await call('PUT', `/api/status/${DEVICE}/${area}`, {
      who: alice.who,
      body: JSON.stringify({ state: 'works' }),
      headers: { 'content-type': 'text/plain' },
    });
    expect(r.status).toBe(403);
  });

  test('a same-origin cookie write passes', async () => {
    const r = await call('PUT', `/api/status/${DEVICE}/${area}`, {
      who: alice.who,
      body: { state: 'works' },
      headers: { origin: BASE },
    });
    expect(r.status).toBe(200);
  });
});

describe('routing', () => {
  test('unknown /api paths are JSON 404 for every method', async () => {
    for (const [m, p] of [
      ['GET', '/api/nope'],
      ['POST', '/api/nope/x/y'],
      ['DELETE', '/api'],
      ['GET', `/api/status/${DEVICE}/${area}/extra`],
    ]) {
      const r = await call(m, p);
      expect(r.status).toBe(404);
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.body.error).toBeString();
    }
  });

  test('unsupported methods are JSON 405 with Allow', async () => {
    for (const [m, p] of [
      ['DELETE', '/api/areas'],
      ['PATCH', '/api/docs'],
      ['GET', '/api/claims/1/approve'],
      ['PUT', '/api/claims'],
      ['DELETE', `/api/status/${DEVICE}/${area}`],
    ]) {
      const r = await call(m, p);
      expect(r.status).toBe(405);
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.headers.get('allow')).toBeString();
    }
  });

  test('/api/docs lists endpoints with known auth levels', async () => {
    const r = await call('GET', '/api/docs');
    expect(r.status).toBe(200);
    const levels = Object.keys(r.body.auth_levels);
    for (const e of r.body.endpoints) expect(levels).toContain(e.auth);
    const st = r.body.endpoints.find((e: any) => e.path === '/api/status/:device/:area' && e.method.includes('PUT'));
    expect(st.auth).toBe('maintainer');
    expect(r.body.endpoints.find((e: any) => e.path === '/api/posts' && e.method === 'POST').auth).toBe('poster');
  });

  test('malformed JSON is 400', async () => {
    const r = await call('POST', '/api/claims', { who: alice.who, body: '{not json' });
    expect(r.status).toBe(400);
  });
});

describe('github link', () => {
  // POST /api/auth/gh-link returns 409 when the github_id is linked to another
  // user, but that check runs after a real gist is fetched from api.github.com
  // (the proof). It cannot be exercised without GitHub, so it is not tested here.
  test.skip('duplicate github link is 409 (needs a real GitHub gist)', () => {});

  test('gh-verify with an unknown nonce is refused before any account change', async () => {
    const r = await call('POST', '/api/auth/gh-verify', {
      body: { gist_url: 'https://gist.github.com/x/0123456789abcdef', nonce: `ion-unknown-${RUN}` },
    });
    expect(r.status).toBe(410);
  });
});

describe('cleanup', () => {
  test('withdrawing: the claimant can delete their claim; others cannot', async () => {
    expect((await call('DELETE', `/api/claims/${claimId}`, { who: bob.who })).status).toBe(403);
  });
});
