// tests/api/v2.test.ts — v2 API against a running tracker: the not-applicable
// rule, pagination, API keys (scopes, expiry, last_used, rotate, revoke),
// repo claims (owner, proof file, admin approve/reject, maintainer removal),
// repo support rows and lineage, media on R2 (upload, sniffing, limits, Range,
// delete) and the /cli.mjs download.
//
//   bun test tests/api                       # TRACKER_URL defaults to http://127.0.0.1:3001
//
// Needs the admin pair (env or .dev.vars). The owner flow and the key-expiry
// case write to the local D1 directly (a test github_login and a past expiry
// have no API), so those two run against a local tracker only. The proof-file
// success path needs a real GitHub push; it is covered by
// tests/api/unit.test.ts with a stubbed fetch, and here only the "file not
// found" answer (422) is checked. Every run uses random names (RUN) and
// afterAll deletes what it made; the changelog rows naming RUN are scrubbed.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BASE, LOCAL, ROOT, adminLogin, call, cleanupCall, localSql, scrubChangelog, signup, type Who } from './helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DEV = `t-${RUN}`; // base other
const DEVO = `to-${RUN}`; // base oneios
const PASSWORD = `pw-${RUN}-correct-horse`;
const GH = `tgh${RUN}`; // alice's (test) GitHub login
const GHB = `tgb${RUN}`; // bob's (test) GitHub login, set in the repo-claim tests
// A real GitHub organization, so a repo under it takes the proof-file path.
const ORG = 'UniXNU';

// A 2x3 PNG (signature + IHDR) and the first bytes of an MP4 (ftyp isom).
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0, 0, 0, 0, 0,
  ...new Array(40).fill(7),
]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, ...new Array(200).fill(1)]);

let admin: Who;
let alice: { who: Who; id: number; email: string };
let bob: { who: Who; id: number; email: string };
const made = { forks: [] as number[], media: [] as number[] };

function form(fields: Record<string, string>, file?: { bytes: Uint8Array; name: string; type?: string }): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append('file', new Blob([file.bytes], { type: file.type ?? 'application/octet-stream' }), file.name);
  return f;
}

async function key(who: Who, scopes: string[], extra: Record<string, unknown> = {}): Promise<{ token: string; id: number }> {
  const r = await call('POST', '/api/tokens', { who, body: { name: `k-${RUN}`, scopes, ...extra } });
  expect(r.status).toBe(201);
  expect(r.body.meta.scopes).toEqual(scopes.includes('all') ? ['all'] : [...scopes].sort());
  return { token: r.body.token, id: r.body.meta.id };
}

beforeAll(async () => {
  admin = await adminLogin();
  for (const [slug, base] of [
    [DEV, 'other'],
    [DEVO, 'oneios'],
  ]) {
    const d = await call('POST', '/api/devices', { who: admin, body: { slug, name: `Test ${slug}`, base } });
    expect(d.status).toBe(201);
    expect(d.body.device.base).toBe(base);
  }
  alice = await signup('alice2', RUN, PASSWORD);
  bob = await signup('bob2', RUN, PASSWORD);
  if (LOCAL) expect(localSql(`UPDATE users SET github_login = '${GH}' WHERE id = ${alice.id}`).ok).toBe(true);
}, 60_000);

afterAll(async () => {
  if (!admin) return;
  for (const id of made.media) await cleanupCall('DELETE', `/api/media/${id}`, admin);
  for (const id of made.forks) await cleanupCall('DELETE', `/api/forks/${id}`, admin);
  for (const d of [DEV, DEVO]) await cleanupCall('DELETE', `/api/devices/${d}`, admin);
  for (const u of [alice, bob]) if (u) await cleanupCall('DELETE', `/api/users/${u.id}`, admin);
  scrubChangelog(RUN);
}, 60_000);

describe('devices, areas and the not-applicable rule', () => {
  test('areas carry scope; return-to-oneui, ipc and kernel-mem are oneios', async () => {
    const r = await call('GET', '/api/areas');
    expect(r.status).toBe(200);
    const scoped = r.body.areas.filter((a: any) => a.scope === 'oneios').map((a: any) => a.slug).sort();
    expect(scoped).toEqual(['ipc', 'kernel-mem', 'return-to-oneui']);
    expect(r.body.total).toBe(r.body.areas.length);
  });

  test('a oneios-scope area on a non-OneiOS device is 400 "area not applicable"', async () => {
    const r = await call('PUT', `/api/status/${DEV}/ipc`, { who: admin, body: { state: 'works' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('area not applicable');
    expect(r.body.hint).toBe('ipc only applies to OneiOS-based ports');
    const body = await call('PUT', '/api/status', { who: admin, body: { device: DEV, area: 'return-to-oneui', state: 'unknown' } });
    expect(body.status).toBe(400);
    const ok = await call('PUT', `/api/status/${DEVO}/ipc`, { who: admin, body: { state: 'in-progress', detail: 'test' } });
    expect(ok.status).toBe(200);
    const plain = await call('PUT', `/api/status/${DEV}/wifi`, { who: admin, body: { state: 'works' } });
    expect(plain.status).toBe(200);
  });

  test('device fields: base and image_* are admin-only, ios_version is not; bad values are 400', async () => {
    const r = await call('PATCH', `/api/devices/${DEV}`, {
      who: admin,
      body: { ios_version: 'iOS 16.7.16', image_url: 'https://upload.wikimedia.org/x.jpg', image_license: 'CC BY-SA 4.0' },
    });
    expect(r.status).toBe(200);
    expect(r.body.device.ios_version).toBe('iOS 16.7.16');
    expect((await call('PATCH', `/api/devices/${DEV}`, { who: admin, body: { base: 'ios' } })).status).toBe(400);
    expect((await call('PATCH', `/api/devices/${DEV}`, { who: admin, body: { image_url: 'javascript:alert(1)' } })).status).toBe(400);
    const d = await call('GET', `/api/devices/${DEV}`);
    for (const k of ['base', 'ios_version', 'image_url', 'image_credit', 'image_license', 'image_source_url', 'supported_by', 'latest_media', 'media_count']) {
      expect(d.body.device, k).toHaveProperty(k);
    }
  });

  test('lists page with limit/offset and report total and next', async () => {
    const a = await call('GET', '/api/devices?limit=2');
    expect(a.status).toBe(200);
    expect(a.body.devices.length).toBe(2);
    expect(a.body.limit).toBe(2);
    expect(a.body.next).toBe(2);
    expect(a.body.total).toBeGreaterThan(2);
    const b = await call('GET', '/api/devices?limit=2&offset=2');
    expect(b.body.devices[0].slug).not.toBe(a.body.devices[0].slug);
    const last = await call('GET', `/api/devices?limit=1&offset=${a.body.total - 1}`);
    expect(last.body.next).toBeNull();
    for (const p of ['/api/posts?limit=1', '/api/changelog?limit=1', '/api/forks?limit=1', '/api/status?limit=1', '/api/claims?limit=1', '/api/media?limit=1']) {
      const r = await call('GET', p);
      expect(r.status, p).toBe(200);
      expect(typeof r.body.total, p).toBe('number');
      expect(r.body.limit, p).toBe(1);
    }
    expect((await call('GET', '/api/posts?limit=0')).status).toBe(400);
    expect((await call('GET', '/api/posts?offset=-1')).status).toBe(400);
    expect((await call('GET', '/api/posts?limit=9999')).body.limit).toBe(500);
  });
});

describe('API keys', () => {
  test('scopes are enforced in one place: a miss is 403 {error:"token scope", hint:"needs <scope>"}', async () => {
    const st = await key(admin, ['status:write']);
    const me = await call('GET', '/api/auth/me', { who: { token: st.token } });
    expect(me.status).toBe(200);
    expect(me.body.token_scopes).toEqual(['status:write']);
    expect((await call('PUT', `/api/status/${DEV}/wifi`, { who: { token: st.token }, body: { state: 'broken' } })).status).toBe(200);
    const deny = await call('POST', '/api/posts', { who: { token: st.token }, body: { title: 'x', url: `https://redd.it/${RUN}` } });
    expect(deny.status).toBe(403);
    expect(deny.body).toEqual({ error: 'token scope', hint: 'needs post:write' });
    const keyDeny = await call('POST', '/api/tokens', { who: { token: st.token }, body: { name: 'escalate', scopes: ['all'] } });
    expect(keyDeny.status).toBe(403);
    expect(keyDeny.body.hint).toBe('needs all');
    const ro = await key(admin, ['read']);
    const roDeny = await call('PUT', `/api/status/${DEV}/wifi`, { who: { token: ro.token }, body: { state: 'works' } });
    expect(roDeny.body.hint).toBe('needs status:write');
    expect((await call('GET', '/api/tokens', { who: { token: ro.token } })).status).toBe(200);
    const fd = form({ device: DEV }, { bytes: PNG, name: 'a.png' });
    const mediaDeny = await call('POST', '/api/media', { who: { token: st.token }, form: fd });
    expect(mediaDeny.status).toBe(403);
    expect(mediaDeny.body.hint).toBe('needs media:write');
    // A session cookie is not scoped; the session reports no token_scopes.
    expect((await call('GET', '/api/auth/me', { who: admin })).body.token_scopes).toBeUndefined();
  });

  test('a key never exceeds its owner: an all-scope key of a plain user is still 403 on admin routes', async () => {
    const k = await key(bob.who, ['all']);
    const r = await call('POST', '/api/areas', { who: { token: k.token }, body: { slug: `x-${RUN}`, name: 'x' } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('admin required');
  });

  test('bad scopes and expiry values are 400', async () => {
    expect((await call('POST', '/api/tokens', { who: bob.who, body: { scopes: ['root'] } })).status).toBe(400);
    expect((await call('POST', '/api/tokens', { who: bob.who, body: { expires_in_days: 7 } })).status).toBe(400);
  });

  test('expiry: expires_in_days sets it, an expired key is 401', async () => {
    const k = await key(bob.who, ['read'], { expires_in_days: 30 });
    const list = await call('GET', '/api/tokens', { who: bob.who });
    const meta = list.body.tokens.find((t: any) => t.id === k.id);
    const days = (Date.parse(meta.expires) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    if (!LOCAL) return; // the past expiry is written to the local D1
    expect(localSql(`UPDATE api_tokens SET expires = '2020-01-01T00:00:00.000Z' WHERE rowid = ${k.id}`).ok).toBe(true);
    const r = await call('GET', '/api/auth/me', { who: { token: k.token } });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('token expired');
  });

  test('last_used is set on use and written at most once a minute', async () => {
    const k = await key(bob.who, ['read']);
    let meta = (await call('GET', '/api/tokens', { who: bob.who })).body.tokens.find((t: any) => t.id === k.id);
    expect(meta.last_used).toBeNull();
    await call('GET', '/api/auth/me', { who: { token: k.token } });
    meta = (await call('GET', '/api/tokens', { who: bob.who })).body.tokens.find((t: any) => t.id === k.id);
    expect(meta.last_used).toBeString();
    const first = meta.last_used;
    await Bun.sleep(1100);
    await call('GET', '/api/auth/me', { who: { token: k.token } });
    meta = (await call('GET', '/api/tokens', { who: bob.who })).body.tokens.find((t: any) => t.id === k.id);
    expect(meta.last_used).toBe(first);
  });

  test('rotate: a new secret with the same name, scopes and expiry; the old one stops working', async () => {
    const k = await key(bob.who, ['status:write', 'media:write'], { expires_in_days: 90 });
    const before = (await call('GET', '/api/tokens', { who: bob.who })).body.tokens.find((t: any) => t.id === k.id);
    const r = await call('POST', `/api/tokens/${k.id}/rotate`, { who: bob.who });
    expect(r.status).toBe(201);
    expect(r.body.token).not.toBe(k.token);
    expect(r.body.meta.name).toBe(before.name);
    expect(r.body.meta.scopes).toEqual(before.scopes);
    expect(r.body.meta.expires).toBe(before.expires);
    expect((await call('GET', '/api/auth/me', { who: { token: k.token } })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { who: { token: r.body.token } })).status).toBe(200);
    expect((await call('POST', `/api/tokens/${k.id}/rotate`, { who: bob.who })).status).toBe(409);
    expect((await call('POST', `/api/tokens/${r.body.meta.id}/rotate`, { who: alice.who })).status).toBe(404);
  });

  test('revoke: the key is 401 afterwards and listed as revoked', async () => {
    const k = await key(bob.who, ['read']);
    const r = await call('DELETE', `/api/tokens/${k.id}`, { who: bob.who });
    expect(r.status).toBe(200);
    expect(r.body.meta.revoked).toBe(true);
    const me = await call('GET', '/api/auth/me', { who: { token: k.token } });
    expect(me.status).toBe(401);
    expect(me.body.error).toBe('invalid token');
    const list = await call('GET', '/api/tokens', { who: bob.who });
    expect(list.body.tokens.find((t: any) => t.id === k.id).revoked).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(k.token);
  });
});

describe('repo claims', () => {
  const ownRepo = `${GH}/port-${RUN}`;
  const otherRepo = `${ORG}/port-${RUN}`;
  /** GitHub could not be reached or rate limited the tracker: the GitHub-backed checks are skipped. */
  const githubDown = (r: { status: number }) => r.status === 502 || r.status === 503;
  let ownFork = 0;

  test('anonymous is 401; no linked GitHub account is 403; an untracked repo needs a device', async () => {
    expect((await call('POST', '/api/repos/claim', { body: { repo: otherRepo } })).status).toBe(401);
    const unlinked = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: otherRepo, device: DEV } });
    expect(unlinked.status).toBe(403);
    expect(unlinked.body.error).toBe('link your GitHub account first');
    expect((await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: 'not a repo', device: DEV } })).status).toBe(400);
    if (!LOCAL) return; // the test github_login is set in the local D1
    expect(localSql(`UPDATE users SET github_login = '${GHB}' WHERE id = ${bob.id}`).ok).toBe(true);
    const r = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: otherRepo } });
    if (githubDown(r)) return;
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('device required');
  });

  test("another person's repo is 403, even for a linked account", async () => {
    if (!LOCAL) return;
    const r = await call('POST', '/api/repos/claim', { who: alice.who, body: { repo: `torvalds/port-${RUN}`, device: DEV } });
    if (githubDown(r)) return;
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('not the repo owner');
    expect(r.body.hint).toContain('@torvalds');
    expect(r.body.hint).toContain(`@${GH}`);
  });

  test('the GitHub owner is approved at once and becomes repo and device maintainer', async () => {
    if (!LOCAL) return; // the test github_login is set in the local D1
    const r = await call('POST', '/api/repos/claim', { who: alice.who, body: { repo: `https://github.com/${ownRepo}.git`, device: DEV, best_result: 'boots' } });
    expect(r.status).toBe(200);
    expect(r.body.claim.status).toBe('approved');
    expect(r.body.claim.method).toBe('owner');
    expect(r.body.claim.nonce).toBeNull();
    expect(r.body.fork.repo).toBe(ownRepo);
    expect(r.body.fork.maintainer.id).toBe(alice.id);
    expect(r.body.fork.maintainer_since).toBeString();
    expect(r.body.fork.supports.map((s: any) => s.device_slug)).toEqual([DEV]);
    ownFork = r.body.fork.id;
    made.forks.push(ownFork);
    const me = await call('GET', '/api/auth/me', { who: alice.who });
    expect(me.body.maintains).toEqual([DEV]);
    expect(me.body.maintains_repos).toEqual([ownRepo]);
    expect((await call('PUT', `/api/status/${DEV}/touch`, { who: alice.who, body: { state: 'works', detail: 'test' } })).status).toBe(200);
    const again = await call('POST', '/api/repos/claim', { who: alice.who, body: { repo: ownRepo } });
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
    // Someone with no commits in it cannot claim it (a repo can have several
    // maintainers, but they join as owner, contributor or by a maintainer's add).
    const taken = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: ownRepo } });
    expect([403, 404, 502, 503]).toContain(taken.status);
    const f = await call('GET', `/api/forks/${ownFork}/maintainers`);
    expect(f.body.maintainers.map((m: any) => m.id)).toEqual([alice.id]);
  });

  test("an organization's repo gets a pending proof-file claim; a missing file is 422; an admin rejects it and the created fork goes", async () => {
    if (!LOCAL) return;
    const r = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: otherRepo, device: DEV, note: 'mine' } });
    if (githubDown(r)) return;
    expect(r.status).toBe(202);
    const c = r.body.claim;
    expect(c.status).toBe('pending');
    expect(c.method).toBe('proof-file');
    expect(c.nonce).toMatch(/^iosonand-verify-/);
    expect(c.path).toBe('.iosonand-verify');
    expect(Date.parse(c.expires) - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
    const forkId = r.body.fork.id;
    const same = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: otherRepo } });
    expect(same.status).toBe(202);
    expect(same.body.claim.id).toBe(c.id);
    // Only the claimant (and admins) see the nonce; others cannot verify it.
    expect((await call('POST', `/api/repos/claim/${c.id}/verify`, { who: alice.who })).status).toBe(403);
    const v = await call('POST', `/api/repos/claim/${c.id}/verify`, { who: bob.who });
    expect([422, 502]).toContain(v.status); // 502 only when GitHub is unreachable from the tracker
    if (v.status === 422) expect(v.body.error).toBe('verification file not found or wrong');
    const mine = await call('GET', '/api/repos/claims', { who: bob.who });
    expect(mine.body.claims.every((x: any) => x.user_id === bob.id)).toBe(true);
    const all = await call('GET', `/api/repos/claims?repo=${encodeURIComponent(otherRepo)}&status=pending`, { who: admin });
    expect(all.body.claims.map((x: any) => x.id)).toEqual([c.id]);
    expect((await call('POST', `/api/repos/claims/${c.id}/reject`, { who: bob.who })).status).toBe(403);
    const rej = await call('POST', `/api/repos/claims/${c.id}/reject`, { who: admin });
    expect(rej.status).toBe(200);
    expect(rej.body.claim.status).toBe('rejected');
    expect(rej.body.claim.nonce).toBeNull();
    expect((await call('GET', `/api/forks/${forkId}`)).status).toBe(404);
    expect((await call('POST', `/api/repos/claims/${c.id}/reject`, { who: admin })).status).toBe(409);
  });

  test('a repo has several maintainers: a maintainer adds one, who maintains its phones; only the owner or an admin removes others', async () => {
    if (!LOCAL) return; // ownFork and the test GitHub logins live in the local D1
    // bob has no account linked to this login yet: 404.
    expect((await call('POST', `/api/forks/${ownFork}/maintainers`, { who: alice.who, body: { github_login: 'nobody-' + RUN } })).status).toBe(404);
    // Not a maintainer: cannot add anyone.
    expect((await call('POST', `/api/forks/${ownFork}/maintainers`, { who: bob.who, body: { github_login: GHB } })).status).toBe(403);
    const add = await call('POST', `/api/forks/${ownFork}/maintainers`, { who: alice.who, body: { github_login: GHB } });
    expect(add.status).toBe(200);
    expect(add.body.fork.maintainers.map((m: any) => m.id)).toEqual([alice.id, bob.id]);
    expect(add.body.fork.maintainer.id).toBe(alice.id); // the first one, for older clients
    const me = await call('GET', '/api/auth/me', { who: bob.who });
    expect(me.body.maintains_repos).toContain(ownRepo);
    expect(me.body.maintains).toContain(DEV);
    expect((await call('PUT', `/api/status/${DEV}/touch`, { who: bob.who, body: { state: 'works', detail: 'test', source: 'test' } })).status).toBe(200);
    // bob is not the repo's GitHub owner: he cannot remove alice. alice (the owner) can remove bob.
    expect((await call('DELETE', `/api/forks/${ownFork}/maintainers?user=${alice.id}`, { who: bob.who })).status).toBe(403);
    const rm = await call('DELETE', `/api/forks/${ownFork}/maintainers?github_login=${GHB}`, { who: alice.who });
    expect(rm.status).toBe(200);
    expect(rm.body.fork.maintainers.map((m: any) => m.id)).toEqual([alice.id]);
    expect((await call('GET', '/api/auth/me', { who: bob.who })).body.maintains).not.toContain(DEV);
    // Added again, bob steps down himself; alice stays.
    expect((await call('POST', `/api/forks/${ownFork}/maintainers`, { who: alice.who, body: { github_login: GHB } })).status).toBe(200);
    const down = await call('DELETE', `/api/forks/${ownFork}/maintainer`, { who: bob.who });
    expect(down.status).toBe(200);
    expect(down.body.fork.maintainers.map((m: any) => m.id)).toEqual([alice.id]);
  });

  test("a maintainer of the repo approves another person's pending claim on it; they join the maintainers", async () => {
    if (!LOCAL) return;
    const r = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: `${otherRepo}-3`, device: DEVO } });
    if (githubDown(r)) return;
    expect(r.status).toBe(202);
    made.forks.push(r.body.fork.id);
    const forkId = r.body.fork.id;
    // Nobody maintains it yet: alice cannot approve; an admin adds alice; now she can.
    expect((await call('POST', `/api/repos/claims/${r.body.claim.id}/approve`, { who: alice.who })).status).toBe(403);
    expect((await call('POST', `/api/forks/${forkId}/maintainers`, { who: admin, body: { github_login: GH } })).status).toBe(200);
    const queue = await call('GET', '/api/repos/claims?status=pending', { who: alice.who });
    expect(queue.body.claims.map((c: any) => c.id)).toContain(r.body.claim.id);
    const ok = await call('POST', `/api/repos/claims/${r.body.claim.id}/approve`, { who: alice.who });
    expect(ok.status).toBe(200);
    expect(ok.body.claim.method).toBe('maintainer');
    expect(ok.body.fork.maintainers.map((m: any) => m.id).sort()).toEqual([alice.id, bob.id].sort());
    // Clean up: both step down (bob first, then alice), so later tests see the old state.
    expect((await call('DELETE', `/api/forks/${forkId}/maintainer`, { who: bob.who })).status).toBe(200);
    expect((await call('DELETE', `/api/forks/${forkId}/maintainer`, { who: alice.who })).status).toBe(200);
  });

  test('an admin approves a pending claim (method admin); the maintainer steps down and loses the granted device', async () => {
    if (!LOCAL) return;
    const r = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: `${otherRepo}-2`, device: DEVO } });
    if (githubDown(r)) return;
    expect(r.status).toBe(202);
    const ok = await call('POST', `/api/repos/claims/${r.body.claim.id}/approve`, { who: admin });
    expect(ok.status).toBe(200);
    expect(ok.body.claim.method).toBe('admin');
    expect(ok.body.fork.maintainer.id).toBe(bob.id);
    made.forks.push(ok.body.fork.id);
    let me = await call('GET', '/api/auth/me', { who: bob.who });
    expect(me.body.maintains).toEqual([DEVO]);
    expect(me.body.maintains_repos).toEqual([`${otherRepo}-2`]);
    // alice does not maintain it: nothing to step down from.
    expect((await call('DELETE', `/api/forks/${ok.body.fork.id}/maintainer`, { who: alice.who })).status).toBe(404);
    const down = await call('DELETE', `/api/forks/${ok.body.fork.id}/maintainer`, { who: bob.who });
    expect(down.status).toBe(200);
    expect(down.body.fork.maintainer).toBeNull();
    me = await call('GET', '/api/auth/me', { who: bob.who });
    expect(me.body.maintains).toEqual([]);
    expect(me.body.maintains_repos).toEqual([]);
    expect((await call('DELETE', `/api/forks/${ok.body.fork.id}/maintainer`, { who: admin })).status).toBe(404);
  });

  test('support rows: admin records merged/ported (with via); a repo maintainer only claimed', async () => {
    if (!LOCAL) return;
    const via = made.forks[made.forks.length - 1];
    const viaRepo = (await call('GET', `/api/forks/${via}`)).body.fork.repo;
    const r = await call('POST', `/api/forks/${ownFork}/devices`, { who: admin, body: { device_slug: DEVO, support: 'ported', via: viaRepo, note: 'test port' } });
    expect(r.status).toBe(200);
    const row = r.body.fork.supports.find((s: any) => s.device_slug === DEVO);
    expect(row).toMatchObject({ support: 'ported', via: viaRepo, note: 'test port' });
    const d = await call('GET', `/api/devices/${DEVO}`);
    expect(d.body.device.supported_by.some((s: any) => s.repo === ownRepo && s.support === 'ported' && s.via === viaRepo)).toBe(true);
    const f = await call('GET', `/api/forks?device=${DEVO}`);
    expect(f.body.forks.some((x: any) => x.id === ownFork)).toBe(true);
    expect((await call('POST', `/api/forks/${ownFork}/devices`, { who: alice.who, body: { device_slug: DEVO, support: 'merged' } })).status).toBe(403);
    expect((await call('POST', `/api/forks/${ownFork}/devices`, { who: bob.who, body: { device_slug: DEVO, support: 'claimed' } })).status).toBe(403);
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: alice.who })).status).toBe(403); // ported: admin only
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: admin })).status).toBe(200);
    const cl = await call('POST', `/api/forks/${ownFork}/devices`, { who: alice.who, body: { device_slug: DEVO, support: 'claimed' } });
    expect(cl.status).toBe(200);
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: alice.who })).status).toBe(200);
    expect((await call('POST', `/api/forks/${ownFork}/devices`, { who: admin, body: { device_slug: DEVO, support: 'best' } })).status).toBe(400);
  });

  test('a phone the tracker does not list is added with the claim of your own repo', async () => {
    if (!LOCAL) return;
    const name = `Test Phone ${RUN}`;
    const repo = `${GH}/newphone-${RUN}`;
    // Not your repo (or no GitHub account): 403 before anything is created.
    const other = await call('POST', '/api/repos/claim', { who: bob.who, body: { repo: `${GH}/x-${RUN}`, new_device: { name } } });
    expect(other.status).toBe(403);
    expect((await call('GET', `/api/devices?q=${encodeURIComponent(name)}`)).body.total).toBe(0);
    const r = await call('POST', '/api/repos/claim', { who: alice.who, body: { repo, new_device: { name, model: 'tst', soc: 'Test SoC' } } });
    expect(r.status).toBe(200);
    expect(r.body.claim.status).toBe('approved');
    const slug = r.body.fork.device_slug;
    expect(slug).toBe(`test-phone-${RUN}`);
    made.forks.push(r.body.fork.id);
    const d = await call('GET', `/api/devices/${slug}`);
    expect(d.body.device).toMatchObject({ name, model: 'tst', soc: 'Test SoC', status: 'unknown' });
    expect((await call('GET', '/api/auth/me', { who: alice.who })).body.maintains).toContain(slug);
    const dup = await call('POST', '/api/repos/claim', { who: alice.who, body: { repo: `${GH}/newphone2-${RUN}`, new_device: { name: name.toUpperCase() } } });
    expect(dup.status).toBe(409);
    expect(dup.body.hint).toContain(slug);
    // Clean up: the repo row, then the phone.
    expect((await call('DELETE', `/api/forks/${r.body.fork.id}`, { who: admin })).status).toBe(200);
    made.forks.splice(made.forks.indexOf(r.body.fork.id), 1);
    expect((await call('DELETE', `/api/devices/${slug}`, { who: admin })).status).toBe(200);
  });

  test("a repo's maintainer maintains its primary/merged/ported phones without a claim", async () => {
    if (!LOCAL) return;
    const before = await call('GET', '/api/auth/me', { who: alice.who });
    expect(before.body.maintains).not.toContain(DEVO);
    expect((await call('POST', `/api/forks/${ownFork}/devices`, { who: admin, body: { device_slug: DEVO, support: 'ported', note: 'test' } })).status).toBe(200);
    const me = await call('GET', '/api/auth/me', { who: alice.who });
    expect(me.body.maintains).toContain(DEVO);
    expect((await call('PUT', `/api/status/${DEVO}/touch`, { who: alice.who, body: { state: 'works', detail: 'test', source: 'test' } })).status).toBe(200);
    const d = await call('GET', `/api/devices/${DEVO}`);
    expect(d.body.device.maintainers).toContain(`@${GH}`);
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: admin })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', { who: alice.who })).body.maintains).not.toContain(DEVO);
    expect((await call('PUT', `/api/status/${DEVO}/touch`, { who: alice.who, body: { state: 'works', detail: 'test', source: 'test' } })).status).toBe(403);
  });

  test('a phone the maintainer adds: theirs at once when nobody maintains it, else an admin decides; removing it drops it', async () => {
    if (!LOCAL) return;
    const add = await call('POST', `/api/forks/${ownFork}/devices`, { who: alice.who, body: { device_slug: DEVO, support: 'claimed' } });
    expect(add.status).toBe(200);
    expect(add.body.device_claim.status).toBe('approved');
    expect((await call('GET', '/api/auth/me', { who: alice.who })).body.maintains).toContain(DEVO);
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: alice.who })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', { who: alice.who })).body.maintains).not.toContain(DEVO);

    // Bob maintains DEVO: alice adding it to her repo does not take it over.
    const bc = await call('POST', '/api/claims', { who: bob.who, body: { device: DEVO, note: 'test' } });
    expect(bc.status).toBe(201);
    expect((await call('POST', `/api/claims/${bc.body.claim.id}/approve`, { who: admin })).status).toBe(200);
    const taken = await call('POST', `/api/forks/${ownFork}/devices`, { who: alice.who, body: { device_slug: DEVO, support: 'claimed' } });
    expect(taken.status).toBe(200);
    expect(taken.body.device_claim.status).toBe('pending');
    expect((await call('GET', '/api/auth/me', { who: alice.who })).body.maintains).not.toContain(DEVO);
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: alice.who })).status).toBe(200);
    expect((await call('DELETE', `/api/claims/${bc.body.claim.id}`, { who: admin })).status).toBe(200);

    // Claiming a repo you already maintain with another phone adds that phone.
    const again = await call('POST', '/api/repos/claim', { who: alice.who, body: { repo: ownRepo, device: DEVO } });
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
    expect(again.body.device_claim.status).toBe('approved');
    expect(again.body.fork.supports.map((x: any) => x.device_slug)).toContain(DEVO);
    expect((await call('DELETE', `/api/forks/${ownFork}/devices?device=${DEVO}`, { who: alice.who })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', { who: alice.who })).body.maintains).not.toContain(DEVO);
  });

  test('lineage: the maintainer records "based on"; /api/lineage and ?base_project= show it', async () => {
    if (!LOCAL) return;
    const r = await call('POST', `/api/forks/${ownFork}/lineage`, {
      who: alice.who,
      body: { base: `https://github.com/base-${RUN}/ios-sweet`, relation: 'derived-from', note: 'README', base_project: `fam-${RUN}` },
    });
    expect(r.status).toBe(200);
    expect(r.body.fork.based_on).toEqual([
      { base: `base-${RUN}/ios-sweet`, base_repo_url: `https://github.com/base-${RUN}/ios-sweet`, relation: 'derived-from', note: 'README' },
    ]);
    expect(r.body.fork.base_project).toBe(`fam-${RUN}`);
    expect((await call('POST', `/api/forks/${ownFork}/lineage`, { who: bob.who, body: { base: 'x', relation: 'uses' } })).status).toBe(403);
    expect((await call('POST', `/api/forks/${ownFork}/lineage`, { who: alice.who, body: { base: 'x', relation: 'cousin-of' } })).status).toBe(400);
    const tree = await call('GET', '/api/lineage');
    expect(tree.body.edges).toContainEqual({ from: ownRepo, to: `base-${RUN}/ios-sweet`, relation: 'derived-from' });
    expect(tree.body.nodes.some((n: any) => n.repo === `base-${RUN}/ios-sweet` && n.tracked === false)).toBe(true);
    expect(tree.body.families[`fam-${RUN}`]).toBe(1);
    const fam = await call('GET', `/api/forks?base_project=fam-${RUN}`);
    expect(fam.body.forks.map((x: any) => x.id)).toEqual([ownFork]);
    // The device's family comes from the repos that support it.
    const d = await call('GET', `/api/devices/${DEV}`);
    expect(d.body.device.families).toEqual([`fam-${RUN}`]);
    expect(d.body.device.family).toBe(`fam-${RUN}`);
    const byFam = await call('GET', `/api/devices?family=FAM-${RUN}`);
    expect(byFam.body.devices.map((x: any) => x.slug)).toEqual([DEV]);
    expect(byFam.body.total).toBe(1);
    const none = await call('GET', `/api/devices/${DEVO}`);
    // DEVO has one repo without a family label: unknown.
    expect(none.body.device.families).toEqual(['unknown']);
    expect(none.body.device.family).toBe('unknown');
    const del = await call('DELETE', `/api/forks/${ownFork}/lineage?base=${encodeURIComponent(`base-${RUN}/ios-sweet`)}`, { who: alice.who });
    expect(del.status).toBe(200);
    expect(del.body.fork.based_on).toEqual([]);
  });
});

describe('media', () => {
  let mediaKey: { token: string; id: number };
  let png: any;

  beforeAll(async () => {
    if (LOCAL) mediaKey = await key(alice.who, ['media:write']);
  });

  test('a maintainer uploads a PNG (type and size read from the bytes) and an MP4', async () => {
    if (!LOCAL) return; // alice maintains DEV through the owner claim (local only)
    const r = await call('POST', '/api/media', {
      who: { token: mediaKey.token },
      form: form({ device: DEV, area: 'wifi', caption: `cap ${RUN}` }, { bytes: PNG, name: 'shot.txt', type: 'text/plain' }),
    });
    expect(r.status).toBe(201);
    png = r.body.media;
    made.media.push(png.id);
    expect(png).toMatchObject({ device_slug: DEV, area_slug: 'wifi', content_type: 'image/png', kind: 'image', bytes: PNG.length, width: 2, height: 3, caption: `cap ${RUN}` });
    expect(png.url).toMatch(new RegExp(`^/media/${DEV}/`));
    expect(png.user.id).toBe(alice.id);
    const v = await call('POST', '/api/media', { who: { token: mediaKey.token }, form: form({ device: DEV }, { bytes: MP4, name: 'clip.bin' }) });
    expect(v.status).toBe(201);
    made.media.push(v.body.media.id);
    expect(v.body.media).toMatchObject({ content_type: 'video/mp4', kind: 'video', width: null });
    const list = await call('GET', `/api/media?device=${DEV}`);
    expect(list.body.media.map((m: any) => m.id)).toEqual([v.body.media.id, png.id]);
    expect(list.body.total).toBe(2);
    const d = await call('GET', `/api/devices/${DEV}`);
    expect(d.body.device.media_count).toBe(2);
    expect(d.body.device.latest_media.id).toBe(png.id); // the newest image
  });

  test('GET /media/<key> streams the bytes, with Range (206), 416 and immutable caching', async () => {
    if (!png) return;
    const r = await call('GET', png.url, { binary: true });
    expect(r.status).toBe(200);
    expect([...r.bytes!]).toEqual([...PNG]);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    const part = await call('GET', png.url, { binary: true, headers: { range: 'bytes=1-3' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 1-3/${PNG.length}`);
    expect([...part.bytes!]).toEqual([0x50, 0x4e, 0x47]);
    const tail = await call('GET', png.url, { binary: true, headers: { range: 'bytes=-2' } });
    expect([...tail.bytes!]).toEqual([7, 7]);
    expect((await call('GET', png.url, { binary: true, headers: { range: `bytes=${PNG.length}-` } })).status).toBe(416);
    const etag = r.headers.get('etag')!;
    expect((await call('GET', png.url, { binary: true, headers: { 'if-none-match': etag } })).status).toBe(304);
  });

  test('a wrong type is 415, a body over 95 MB by Content-Length is 413, no file is 400, a non-maintainer is 403', async () => {
    if (!LOCAL) return;
    const t = { token: mediaKey.token };
    const txt = await call('POST', '/api/media', { who: t, form: form({ device: DEV }, { bytes: new TextEncoder().encode('not an image, just text'), name: 'x.png', type: 'image/png' }) });
    expect(txt.status).toBe(415);
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63, ...new Array(64).fill(0)]);
    expect((await call('POST', '/api/media', { who: t, form: form({ device: DEV }, { bytes: heic, name: 'x.heic' }) })).status).toBe(415);
    expect((await call('POST', '/api/media', { who: t, form: form({ device: DEV }) })).status).toBe(400);
    expect((await call('POST', '/api/media', { who: t, form: form({}, { bytes: PNG, name: 'a.png' }) })).status).toBe(400);
    expect((await call('POST', '/api/media', { who: t, body: { device: DEV } })).status).toBe(415);
    const bobKey = await key(bob.who, ['media:write']);
    const deny = await call('POST', '/api/media', { who: { token: bobKey.token }, form: form({ device: DEV }, { bytes: PNG, name: 'a.png' }) });
    expect(deny.status).toBe(403);
    // 413 from the header alone: a raw request that claims 200 MB and sends almost nothing.
    const big = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL('/api/media', BASE);
      const req = http.request(
        { method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname, headers: { authorization: `Bearer ${mediaKey.token}`, 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(200 * 1024 * 1024) } },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: b });
            req.destroy();
          });
        },
      );
      req.on('error', (e) => (String(e).includes('socket hang up') ? undefined : reject(e)));
      req.write('--x\r\n');
    });
    expect(big.status).toBe(413);
    expect(JSON.parse(big.body).error).toBe('file too large');
  });

  test('cookie uploads: X-Requested-With: iosonand passes the CSRF rule; without it 403; a foreign Origin is 403', async () => {
    if (!LOCAL) return;
    const no = await call('POST', '/api/media', { who: alice.who, form: form({ device: DEV }, { bytes: PNG, name: 'a.png' }) });
    expect(no.status).toBe(403);
    expect(no.body.error).toBe('json content-type required');
    const sameOrigin = await call('POST', '/api/media', { who: alice.who, headers: { origin: BASE }, form: form({ device: DEV }, { bytes: PNG, name: 'a.png' }) });
    expect(sameOrigin.status).toBe(403); // a same-site Origin alone is not enough for a non-JSON body
    const ok = await call('POST', '/api/media', {
      who: alice.who,
      headers: { 'x-requested-with': 'iosonand', origin: BASE, 'sec-fetch-site': 'same-origin' },
      form: form({ device: DEV, caption: `cookie ${RUN}` }, { bytes: PNG, name: 'a.png' }),
    });
    expect(ok.status).toBe(201);
    made.media.push(ok.body.media.id);
    const foreign = await call('POST', '/api/media', {
      who: alice.who,
      headers: { 'x-requested-with': 'iosonand', origin: 'https://evil.example' },
      form: form({ device: DEV }, { bytes: PNG, name: 'a.png' }),
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe('cross-origin write refused');
    const crossSite = await call('POST', '/api/media', {
      who: alice.who,
      headers: { 'x-requested-with': 'iosonand', 'sec-fetch-site': 'cross-site' },
      form: form({ device: DEV }, { bytes: PNG, name: 'a.png' }),
    });
    expect(crossSite.status).toBe(403);
    // The header also works for a JSON-less cookie write elsewhere; a bearer token needs none of this.
    expect((await call('DELETE', `/api/media/${ok.body.media.id}`, { who: alice.who, headers: { 'x-requested-with': 'iosonand' } })).status).toBe(200);
    made.media = made.media.filter((id) => id !== ok.body.media.id);
  });

  test('delete: only the uploader or an admin; afterwards /media/<key> is 404', async () => {
    if (!png) return;
    const bobKey = await key(bob.who, ['media:write']);
    expect((await call('DELETE', `/api/media/${png.id}`, { who: { token: bobKey.token } })).status).toBe(403);
    const r = await call('DELETE', `/api/media/${png.id}`, { who: { token: mediaKey.token } });
    expect(r.status).toBe(200);
    expect((await call('GET', png.url, { binary: true })).status).toBe(404);
    expect((await call('GET', `/api/media/${png.id}`)).status).toBe(404);
    made.media = made.media.filter((id) => id !== png.id);
  });
});

describe('photo updates and the device catalog', () => {
  test('a maintainer posts an update with an upload; others cannot attach it; the author removes it', async () => {
    if (!LOCAL) return; // alice maintains DEV through the owner claim (local only)
    const k = await key(alice.who, ['media:write']);
    const up = await call('POST', '/api/media', { who: { token: k.token }, form: form({ device: DEV, caption: `upd ${RUN}` }, { bytes: PNG, name: 'u.png' }) });
    expect(up.status).toBe(201);
    made.media.push(up.body.media.id);
    // A status:write key cannot post updates (media:write).
    const sk = await key(alice.who, ['status:write']);
    expect((await call('POST', `/api/devices/${DEV}/updates`, { who: { token: sk.token }, body: { body: 'x' } })).status).toBe(403);
    // Not a maintainer of DEV: 403. An empty update: 400.
    expect((await call('POST', `/api/devices/${DEV}/updates`, { who: bob.who, body: { body: 'x' } })).status).toBe(403);
    expect((await call('POST', `/api/devices/${DEV}/updates`, { who: { token: k.token }, body: {} })).status).toBe(400);
    const r = await call('POST', `/api/devices/${DEV}/updates`, { who: { token: k.token }, body: { body: `Wi-Fi joins networks ${RUN}`, media_ids: [up.body.media.id] } });
    expect(r.status).toBe(201);
    expect(r.body.update).toMatchObject({ device_slug: DEV, body: `Wi-Fi joins networks ${RUN}` });
    expect(r.body.update.media.map((m: any) => m.id)).toEqual([up.body.media.id]);
    // The same upload cannot go into a second update.
    const again = await call('POST', `/api/devices/${DEV}/updates`, { who: { token: k.token }, body: { body: 'again', media_ids: [up.body.media.id] } });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('bad media_ids');
    const list = await call('GET', `/api/devices/${DEV}/updates`);
    expect(list.status).toBe(200);
    expect(list.body.updates[0].id).toBe(r.body.update.id);
    expect(list.body.updates[0].media[0].url).toMatch(new RegExp(`^/media/${DEV}/`));
    expect((await call('DELETE', `/api/devices/${DEV}/updates/${r.body.update.id}`, { who: bob.who })).status).toBe(403);
    expect((await call('DELETE', `/api/devices/${DEV}/updates/${r.body.update.id}`, { who: { token: k.token } })).status).toBe(200);
    expect((await call('GET', `/api/devices/${DEV}/updates`)).body.total).toBe(0);
    expect((await call('GET', '/api/devices/no-such-phone/updates')).status).toBe(404);
  });

  test('the catalog finds phones by name and codename and marks tracked ones', async () => {
    if (!LOCAL) return; // loaded locally by scripts/sync-catalog.mjs
    const short = await call('GET', '/api/catalog?q=a');
    expect(short.status).toBe(400);
    const r = await call('GET', '/api/catalog?q=lavender');
    if (!r.body.catalog?.length) return; // catalog not loaded in this database
    expect(r.body.catalog.some((c: any) => c.codenames.includes('lavender') && c.display === 'Redmi Note 7')).toBe(true);
    const s24 = await call('GET', '/api/catalog?q=galaxy%20s24%20ultra');
    expect(s24.body.catalog[0].display).toBe('Galaxy S24 Ultra');
    expect(s24.body.catalog[0].tracked).toBe('s24-ultra');
  });
});

describe('post thumbnails', () => {
  test('a post carries image_url / image_width / image_height; an admin sets them; bad values are 400', async () => {
    const r = await call('POST', '/api/posts', {
      who: admin,
      body: { title: `thumb ${RUN}`, url: `https://www.reddit.com/r/hackios/comments/${RUN}/thumb`, image_url: 'https://i.redd.it/abc.jpeg', image_width: 1080, image_height: 2340 },
    });
    expect(r.status).toBe(201);
    expect(r.body.post).toMatchObject({ image_url: 'https://i.redd.it/abc.jpeg', image_width: 1080, image_height: 2340 });
    const id = r.body.post.id;
    try {
      const p = await call('PATCH', `/api/posts/${id}`, { who: admin, body: { image_url: 'https://preview.redd.it/x.png?width=640', image_width: null, image_height: null } });
      expect(p.status).toBe(200);
      expect(p.body.post).toMatchObject({ image_url: 'https://preview.redd.it/x.png?width=640', image_width: null, image_height: null });
      expect((await call('PATCH', `/api/posts/${id}`, { who: admin, body: { image_url: 'http://i.redd.it/x.png' } })).status).toBe(400);
      expect((await call('PATCH', `/api/posts/${id}`, { who: admin, body: { image_width: -3 } })).status).toBe(400);
      expect((await call('PATCH', `/api/posts/${id}`, { who: bob.who, body: { image_url: '' } })).status).toBe(403);
      const list = await call('GET', '/api/posts?limit=500');
      expect(list.body.posts.find((x: any) => x.id === id).image_url).toBe('https://preview.redd.it/x.png?width=640');
    } finally {
      await call('DELETE', `/api/posts/${id}`, { who: admin });
      scrubChangelog(RUN, [`post #${id} updated`, `post #${id} removed`]);
    }
  });
});

describe('static CLI download', () => {
  test('GET /cli.mjs serves cli.mjs as JavaScript', async () => {
    const r = await fetch(`${BASE}/cli.mjs`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/javascript');
    const text = await r.text();
    expect(text.startsWith('#!/usr/bin/env node')).toBe(true);
    if (LOCAL) expect(text).toBe(readFileSync(path.join(ROOT, 'cli.mjs'), 'utf8'));
  });
});
