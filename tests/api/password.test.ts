// tests/api/password.test.ts — password change, password reset and the sign-in
// rate limit, against a running tracker (TRACKER_URL, default
// http://127.0.0.1:3001). Needs the admin pair (env or .dev.vars) to delete
// the test users afterwards.
//
// The reset mail cannot be read here, so the confirm step plants a reset row
// with a known secret in the local D1 (local tracker only). The rate-limit
// test is skipped when .dev.vars has RATE_LIMITS=off.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LOCAL, ROOT, adminLogin, call, cleanupCall, cookieFrom, localSql, signup, type Who } from './helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PW1 = `pw-${RUN}-first-one`;
const PW2 = `pw-${RUN}-second-one`;
const PW3 = `pw-${RUN}-third-one`;

let admin: Who;
let carol: { who: Who; id: number; email: string };
let dave: { who: Who; id: number; email: string };

function limitsOff(): boolean {
  const f = path.join(ROOT, '.dev.vars');
  return existsSync(f) && /^RATE_LIMITS=["']?off["']?\s*$/im.test(readFileSync(f, 'utf8'));
}

function sha256Hex(s: string): string {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex');
}

beforeAll(async () => {
  admin = await adminLogin();
  carol = await signup('carol', RUN, PW1);
  dave = await signup('dave', RUN, PW1);
});

afterAll(async () => {
  if (!admin) return;
  for (const u of [carol, dave]) if (u) await cleanupCall('DELETE', `/api/users/${u.id}`, admin);
});

describe('password change', () => {
  test('needs the current password; ends other sessions, keeps this one', async () => {
    const other = await call('POST', '/api/auth/login', { body: { email: carol.email, password: PW1 } });
    expect(other.status).toBe(200);
    const otherWho = { cookie: cookieFrom(other) };

    const wrong = await call('POST', '/api/auth/password', { who: carol.who, body: { current_password: 'not-my-password', new_password: PW2 } });
    expect(wrong.status).toBe(401);
    const short = await call('POST', '/api/auth/password', { who: carol.who, body: { current_password: PW1, new_password: 'short' } });
    expect(short.status).toBe(400);

    const ok = await call('POST', '/api/auth/password', { who: carol.who, body: { current_password: PW1, new_password: PW2 } });
    expect(ok.status).toBe(200);
    expect(ok.body.sessions_ended).toBeGreaterThanOrEqual(1);
    expect(ok.body.tokens_revoked).toBe(0);

    expect((await call('GET', '/api/auth/me', { who: carol.who })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', { who: otherWho })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: carol.email, password: PW1 } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: carol.email, password: PW2 } })).status).toBe(200);
  });

  test('anonymous is 401', async () => {
    const r = await call('POST', '/api/auth/password', { body: { current_password: PW1, new_password: PW2 } });
    expect(r.status).toBe(401);
  });
});

describe('password reset', () => {
  test('the request answers the same for known and unknown emails', async () => {
    const known = await call('POST', '/api/auth/password-reset', { body: { email: dave.email } });
    const unknown = await call('POST', '/api/auth/password-reset', { body: { email: `nobody-${RUN}@example.test` } });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect((await call('POST', '/api/auth/password-reset', { body: { email: 'not-an-email' } })).status).toBe(400);
  });

  test('a bad token is 400, an unknown one 410', async () => {
    expect((await call('POST', '/api/auth/password-reset/confirm', { body: { token: 'x', password: PW3 } })).status).toBe(400);
    const r = await call('POST', '/api/auth/password-reset/confirm', { body: { token: `unknown-token-${RUN}-padding`, password: PW3 } });
    expect(r.status).toBe(410);
  });

  test('a link works once: new password, sessions ended, keys revoked, logged in', async () => {
    if (!LOCAL) return; // plants a reset row in the local D1
    const key = await call('POST', '/api/tokens', { who: dave.who, body: { name: `k-${RUN}`, scopes: ['read'] } });
    expect(key.status).toBe(201);
    const secret = `reset-${RUN}-0123456789abcdef`;
    const planted = localSql(
      `INSERT INTO password_resets (token_hash, user_id, created, expires) VALUES ('${sha256Hex(secret)}', ${dave.id}, '${new Date().toISOString()}', '${new Date(Date.now() + 600_000).toISOString()}')`,
    );
    expect(planted.ok).toBe(true);

    const r = await call('POST', '/api/auth/password-reset/confirm', { body: { token: secret, password: PW3 } });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(dave.id);
    expect(r.body.tokens_revoked).toBe(1);
    const fresh = { cookie: cookieFrom(r) };
    expect((await call('GET', '/api/auth/me', { who: fresh })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', { who: dave.who })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { who: { token: key.body.token } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: dave.email, password: PW3 } })).status).toBe(200);

    const again = await call('POST', '/api/auth/password-reset/confirm', { body: { token: secret, password: PW1 } });
    expect(again.status).toBe(410);
  });

  test('an expired link is 410', async () => {
    if (!LOCAL) return;
    const secret = `reset-${RUN}-expired-0123456789`;
    const planted = localSql(
      `INSERT INTO password_resets (token_hash, user_id, created, expires) VALUES ('${sha256Hex(secret)}', ${dave.id}, '2020-01-01T00:00:00.000Z', '2020-01-01T00:30:00.000Z')`,
    );
    expect(planted.ok).toBe(true);
    const r = await call('POST', '/api/auth/password-reset/confirm', { body: { token: secret, password: PW1 } });
    expect(r.status).toBe(410);
  });
});

describe('sign-in rate limit', () => {
  test('the 6th login for one email within a minute is 429 with Retry-After', async () => {
    if (limitsOff()) return;
    const email = `limit-${RUN}@example.test`; // no such account: same answer, same limit
    const codes: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await call('POST', '/api/auth/login', { body: { email, password: `wrong-password-${i}` } });
      codes.push(r.status);
      if (r.status === 429) retryAfter = r.headers.get('retry-after');
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
    expect(retryAfter).toBe('60');
  });
});
