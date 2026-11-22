// tests/api/helpers.ts — shared helpers for the API tests that run against a
// tracker (TRACKER_URL, default http://127.0.0.1:3001). Admin credentials come
// from ADMIN_EMAIL / ADMIN_PASSWORD or the repo's .dev.vars (never printed).

import { expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const BASE = (process.env.TRACKER_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
export const ROOT = path.join(import.meta.dir, '..', '..');
export const LOCAL = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(BASE).hostname);

export function adminCreds(): { email: string; password: string } {
  let email = process.env.ADMIN_EMAIL || '';
  let password = process.env.ADMIN_PASSWORD || '';
  const file = path.join(ROOT, '.dev.vars');
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

export type Res = { status: number; body: any; headers: Headers; bytes?: Uint8Array };

export interface Who {
  cookie?: string;
  token?: string;
}

export async function call(
  method: string,
  p: string,
  opts: { who?: Who; body?: unknown; form?: FormData; headers?: Record<string, string>; binary?: boolean } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
  else if (!opts.form && opts.who?.cookie && method !== 'GET') headers['content-type'] ??= 'application/json';
  if (opts.who?.cookie) headers.cookie = opts.who.cookie;
  if (opts.who?.token) headers.authorization = `Bearer ${opts.who.token}`;
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: opts.form ?? (opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
    redirect: 'manual',
  });
  if (opts.binary) {
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, body: null, headers: r.headers, bytes };
  }
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: r.status, body, headers: r.headers };
}

/**
 * A cleanup call that retries a 500 (the local D1 can answer SQLITE_BUSY while
 * another process, such as a wrangler d1 execute, holds the file).
 */
export async function cleanupCall(method: string, p: string, who: Who): Promise<Res> {
  let r = await call(method, p, { who });
  for (let i = 0; i < 4 && r.status >= 500; i++) {
    await Bun.sleep(300 * (i + 1));
    r = await call(method, p, { who });
  }
  if (r.status >= 500) console.warn(`cleanup ${method} ${p} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

export function cookieFrom(r: Res): string {
  const sc = r.headers.get('set-cookie') || '';
  const m = /iosonand_session=([^;]+)/.exec(sc);
  if (!m) throw new Error(`no session cookie in ${JSON.stringify(sc)}`);
  return `iosonand_session=${m[1]}`;
}

export async function signup(tag: string, run: string, password: string): Promise<{ who: Who; id: number; email: string }> {
  const email = `api-test-${tag}-${run}@example.test`;
  const res = await call('POST', '/api/auth/signup', { body: { email, password, display_name: `t-${tag}-${run}` } });
  expect(res.status).toBe(201);
  return { who: { cookie: cookieFrom(res) }, id: res.body.user.id, email };
}

export async function adminLogin(): Promise<Who> {
  const { email, password } = adminCreds();
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { cookie: cookieFrom(r) };
}

/** Run SQL on the local D1 (local trackers only; used for what has no API, e.g. setting a test github_login). */
export function localSql(sql: string): { ok: boolean; out: string } {
  if (!LOCAL) return { ok: false, out: 'not a local tracker' };
  const r = Bun.spawnSync([path.join(ROOT, 'node_modules', '.bin', 'wrangler'), 'd1', 'execute', 'oneios-tracker', '--local', '--json', '--command', sql], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
}

/** Remove the run's changelog rows from the local D1 (rows that name `run`). */
export function scrubChangelog(run: string, extra: string[] = []) {
  if (!LOCAL) return;
  const ex = extra.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
  const r = localSql(`DELETE FROM changelog WHERE who LIKE '%${run}%' OR summary LIKE '%${run}%'${ex ? ` OR summary IN (${ex})` : ''}`);
  if (!r.ok) console.warn('changelog scrub failed:', r.out.slice(0, 300));
}
