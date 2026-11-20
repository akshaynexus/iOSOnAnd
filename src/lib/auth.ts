// src/lib/auth.ts — Workers-safe auth for the iOSOnAnd tracker.
//
// - Password hashing: WebCrypto PBKDF2-SHA256 (>=100k iterations, per-user
//   random salt). No node:crypto — this runs on the Cloudflare Workers runtime.
// - Sessions: random 32-byte bearer stored as sha256(token_hash) in the
//   `sessions` table, sent as an HttpOnly cookie.
// - API tokens: same shape in `api_tokens` (plaintext shown once at mint),
//   sent as `Authorization: Bearer <token>`.
// - Login challenges: single-use nonces in `login_challenges` for the
//   gist-proof GitHub flow (see github.ts).
// - Also hosts the shared JSON / {error, hint} HTTP helpers used by every
//   /api route (kept here because every route already imports auth).
//
// Table contract (see PLAN.md section 2):
//   users: email UNIQUE NULLABLE, password_hash NULLABLE,
//          github_id UNIQUE NULLABLE, github_login (+ id, display_name,
//          contact, is_admin, created carried over)
//   sessions: token_hash UNIQUE, user_id, created, expires
//   login_challenges: nonce UNIQUE, github_id, gist_id, expires, used
//   api_tokens: token_hash UNIQUE, user_id, name, prefix, created, expires, revoked

import { getDb, queryAll, queryFirst, exec } from '@/lib/db';
import type { PublicUser } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* HTTP helpers shared by all /api routes                              */
/* ------------------------------------------------------------------ */

export class HttpError extends Error {
  status: number;
  hint?: string;
  constructor(status: number, error: string, hint?: string) {
    super(error);
    this.status = status;
    this.hint = hint;
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) },
  });
}

export function apiError(status: number, error: string, hint?: string): Response {
  const body: Record<string, string> = { error };
  if (hint) body.hint = hint;
  return json(body, status);
}

/** Map route exceptions to {error, hint} responses. Unknown bugs -> 500. */
export function handleError(e: unknown): Response {
  if (e instanceof HttpError) return apiError(e.status, e.message, e.hint);
  console.error('api error:', e);
  return apiError(500, 'internal error', 'retry; if it persists, report what you called');
}

/** Parse a JSON body. Empty body -> {}. Malformed JSON -> 400. */
export async function readJson(req: Request): Promise<any> {
  let text = '';
  try {
    text = await req.text();
  } catch {
    throw new HttpError(400, 'unreadable request body', 'send a JSON object with Content-Type: application/json');
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid JSON body', 'send a JSON object with Content-Type: application/json');
  }
}

/* ------------------------------------------------------------------ */
/* Cookies / bearer                                                    */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'iosonand_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 days

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return part.slice(i + 1).trim();
      }
    }
  }
  return null;
}

export function sessionCookieHeader(token: string, req: Request, maxAge = SESSION_TTL_SECONDS): string {
  const secure = req.url.startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/* ------------------------------------------------------------------ */
/* WebCrypto primitives (no node:crypto, no Buffer)                    */
/* ------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 210_000; // OWASP floor for HMAC-SHA256; spec needs >=100k
const SALT_BYTES = 16;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decodeToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlencode(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pbkdf2Key(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** Stored format: pbkdf2-sha256$<iterations>$<base64 salt>$<base64 hash> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await pbkdf2Key(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
    const salt = b64decodeToBytes(parts[2]);
    const expected = b64decodeToBytes(parts[3]);
    if (salt.length < 8 || expected.length !== 32) return false;
    const actual = await pbkdf2Key(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL-safe random secret (session cookies, API tokens, challenge nonces). */
export function randomTokenString(bytes = 32): string {
  return b64urlencode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/* ------------------------------------------------------------------ */
/* Env / time (Workers: process.env works via nodejs_compat; local: bun) */
/* ------------------------------------------------------------------ */

export function env(name: string): string | undefined {
  try {
    const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const v = p?.env?.[name];
    return typeof v === 'string' && v.length ? v : undefined;
  } catch {
    return undefined;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function expiresIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

/** Accepts ISO strings or epoch-ms (number or numeric string). Fail closed. */
export function isExpired(exp: string | number | null | undefined): boolean {
  if (exp === null || exp === undefined || exp === '') return false; // no expiry set
  let t: number;
  if (typeof exp === 'number') t = exp;
  else if (/^-?\d+$/.test(exp.trim())) t = Number(exp.trim());
  else t = Date.parse(exp);
  if (!Number.isFinite(t)) return true;
  return Date.now() > t;
}

/* ------------------------------------------------------------------ */
/* Row types (DB rows; PublicUser comes from @/lib/types)              */
/* ------------------------------------------------------------------ */

export interface UserRow {
  id: number;
  email: string | null;
  password_hash: string | null;
  display_name: string | null;
  contact: string | null;
  github_id: number | null;
  github_login: string | null;
  github_linked_at: string | null;
  is_admin: number | null;
  created: string | null;
}

export interface SessionRow {
  token_hash: string;
  user_id: number;
  created: string;
  expires: string | null;
}

export interface ApiTokenRow {
  token_hash: string;
  user_id: number;
  name: string;
  prefix: string;
  created: string;
  expires: string | null;
  revoked: number;
}

export interface ChallengeRow {
  nonce: string;
  github_id: number;
  github_login: string | null;
  gist_id: string | null;
  expires: string;
  used: number;
  created: string | null;
}

/* ------------------------------------------------------------------ */
/* Schema safety net (scaffold migration is authoritative; this is a    */
/* best-effort no-op when the new tables/columns already exist)        */
/* ------------------------------------------------------------------ */

let ensurePromise: Promise<void> | null = null;
/** Column names seen on users at last ensure (drives token_hash-compat inserts). */
let userColsCache: Set<string> | null = null;

export function ensureAuthSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doEnsure().catch((e) => {
      // Retry on next call (transient D1 hiccup); callers surface real errors.
      ensurePromise = null;
      console.error('ensureAuthSchema failed:', e);
    });
  }
  return ensurePromise;
}

async function doEnsure(): Promise<void> {
  await getDb(); // honor contract: resolve the binding before touching it
  await exec(
    `CREATE TABLE IF NOT EXISTS sessions (
       token_hash TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       created TEXT NOT NULL,
       expires TEXT
     )`,
  );
  await exec(
    `CREATE TABLE IF NOT EXISTS api_tokens (
       token_hash TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       name TEXT NOT NULL DEFAULT '',
       prefix TEXT NOT NULL DEFAULT '',
       created TEXT NOT NULL,
       expires TEXT,
       revoked INTEGER NOT NULL DEFAULT 0
     )`,
  );
  await exec(
    `CREATE TABLE IF NOT EXISTS login_challenges (
       nonce TEXT PRIMARY KEY,
       github_id INTEGER NOT NULL,
       github_login TEXT DEFAULT '',
       gist_id TEXT DEFAULT '',
       expires TEXT NOT NULL,
       used INTEGER NOT NULL DEFAULT 0,
       created TEXT NOT NULL
     )`,
  );
  // Backfill the post-v5 auth columns when the migration has not applied yet
  // (pure ADD COLUMNs; no-ops once migrations/0002_auth.sql has applied).
  const have = new Set(
    (await queryAll<{ name: string }>('PRAGMA table_info(users)')).map((c) => String(c.name)),
  );
  userColsCache = have;
  for (const ddl of [
    'ADD COLUMN email TEXT',
    'ADD COLUMN password_hash TEXT',
    'ADD COLUMN github_id INTEGER',
    'ADD COLUMN github_login TEXT',
    'ADD COLUMN github_linked_at TEXT',
    "ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    "ADD COLUMN contact TEXT NOT NULL DEFAULT ''",
    'ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
    "ADD COLUMN created TEXT NOT NULL DEFAULT ''",
  ]) {
    const col = ddl.split(' ')[2];
    if (!have.has(col)) {
      await exec(`ALTER TABLE users ${ddl}`);
      have.add(col);
    }
  }
  await exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  await exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)');
  // Same treatment for the token/challenge tables (0001 predates name/prefix/
  // revoked and github_id/gist_id/expires).
  const tokensHave = new Set(
    (await queryAll<{ name: string }>('PRAGMA table_info(api_tokens)')).map((c) => String(c.name)),
  );
  for (const ddl of [
    "ADD COLUMN name TEXT NOT NULL DEFAULT ''",
    "ADD COLUMN prefix TEXT NOT NULL DEFAULT ''",
    'ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0',
  ]) {
    const col = ddl.split(' ')[2];
    if (!tokensHave.has(col)) await exec(`ALTER TABLE api_tokens ${ddl}`);
  }
  const chHave = new Set(
    (await queryAll<{ name: string }>('PRAGMA table_info(login_challenges)')).map((c) => String(c.name)),
  );
  for (const ddl of ['ADD COLUMN github_id INTEGER', "ADD COLUMN gist_id TEXT DEFAULT ''", 'ADD COLUMN expires TEXT']) {
    const col = ddl.split(' ')[2];
    if (!chHave.has(col)) await exec(`ALTER TABLE login_challenges ${ddl}`);
  }
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function findUserById(id: number): Promise<UserRow | null> {
  return queryFirst<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryFirst<UserRow>('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
}

export async function findUserByGithubId(githubId: number): Promise<UserRow | null> {
  return queryFirst<UserRow>('SELECT * FROM users WHERE github_id = ?', [githubId]);
}

export async function countUsers(): Promise<number> {
  const row = await queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM users');
  return row ? Number(row.n) : 0;
}

export async function createUser(opts: {
  email?: string | null;
  passwordHash?: string | null;
  displayName: string;
  githubId?: number | null;
  githubLogin?: string | null;
  isAdmin?: boolean;
}): Promise<UserRow> {
  await ensureAuthSchema();
  const email = opts.email ? opts.email.toLowerCase() : null;
  // users.token_hash is a NOT NULL UNIQUE leftover of the pre-auth schema
  // (kept for backward compat); fill a random unique placeholder when present.
  const cols = ['email', 'password_hash', 'display_name', 'contact'];
  const vals: unknown[] = [email, opts.passwordHash ?? null, opts.displayName, ''];
  if (userColsCache?.has('token_hash')) {
    cols.push('token_hash');
    vals.push(`legacy-${randomTokenString(16)}`);
  }
  cols.push('github_id', 'github_login', 'github_linked_at', 'is_admin', 'created');
  vals.push(
    opts.githubId ?? null,
    opts.githubLogin ?? null,
    opts.githubId != null ? nowIso() : null,
    opts.isAdmin ? 1 : 0,
    nowIso(),
  );
  await exec(`INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals as never[]);
  // Re-read via a stable unique key (same connection assumptions avoided).
  if (email) {
    const u = await findUserByEmail(email);
    if (u) return u;
  }
  if (opts.githubId != null) {
    const u = await findUserByGithubId(opts.githubId);
    if (u) return u;
  }
  const fallback = await queryFirst<UserRow>('SELECT * FROM users ORDER BY id DESC LIMIT 1');
  if (!fallback) throw new HttpError(500, 'user creation failed', 'retry');
  return fallback;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    display_name: u.display_name ?? '',
    github_login: u.github_login,
    is_admin: Number(u.is_admin) === 1,
    created: u.created ?? '',
  } as unknown as PublicUser;
}

/** Self view: public fields plus own email. */
export function toSelfUser(u: UserRow): PublicUser & { email: string | null } {
  return { ...toPublicUser(u), email: u.email } as PublicUser & { email: string | null };
}

export function actorName(u: UserRow): string {
  if (u.github_login) return `@${u.github_login}`;
  if (u.display_name) return u.display_name;
  return `user#${u.id}`;
}

/** First-user bootstrap: ADMIN_EMAIL/ADMIN_PASSWORD env promotes user #1. */
export async function maybeBootstrapAdmin(user: UserRow, plaintextPassword: string): Promise<UserRow> {
  try {
    if ((await countUsers()) !== 1) return user;
    const adminEmail = env('ADMIN_EMAIL');
    const adminPassword = env('ADMIN_PASSWORD');
    if (!adminEmail || !adminPassword) return user;
    if (!user.email || user.email.toLowerCase() !== adminEmail.toLowerCase()) return user;
    const a = await sha256Hex(plaintextPassword);
    const b = await sha256Hex(adminPassword);
    if (a !== b) return user;
    await exec('UPDATE users SET is_admin = 1 WHERE id = ?', [user.id]);
    return { ...user, is_admin: 1 };
  } catch {
    return user;
  }
}

/* ------------------------------------------------------------------ */
/* Sessions + API tokens                                               */
/* ------------------------------------------------------------------ */

export async function createSession(userId: number): Promise<{ token: string; row: SessionRow }> {
  await ensureAuthSchema();
  const token = randomTokenString(32);
  const row: SessionRow = {
    token_hash: await sha256Hex(token),
    user_id: userId,
    created: nowIso(),
    expires: expiresIso(SESSION_TTL_SECONDS * 1000),
  };
  await exec('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)', [
    row.token_hash,
    row.user_id,
    row.created,
    row.expires,
  ]);
  return { token, row };
}

export async function destroySessionByToken(plaintext: string): Promise<void> {
  await ensureAuthSchema();
  await exec('DELETE FROM sessions WHERE token_hash = ?', [await sha256Hex(plaintext)]);
}

export async function mintApiToken(
  userId: number,
  name: string,
  ttlMs?: number | null,
): Promise<{ token: string; name: string; prefix: string; expires: string | null; id: number | null }> {
  await ensureAuthSchema();
  const token = `ion_${randomTokenString(32)}`;
  const tokenHash = await sha256Hex(token);
  const row = {
    name: name || 'cli',
    prefix: token.slice(0, 12),
    created: nowIso(),
    expires: ttlMs ? expiresIso(ttlMs) : null,
  };
  await exec(
    'INSERT INTO api_tokens (token_hash, user_id, name, prefix, created, expires, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [tokenHash, userId, row.name, row.prefix, row.created, row.expires],
  );
  const meta = await getTokenMeta(tokenHash);
  return { token, name: row.name, prefix: row.prefix, expires: row.expires, id: meta?.id ?? null };
}

export interface TokenMeta {
  id: number;
  name: string;
  prefix: string;
  created: string;
  expires: string | null;
}

/** Public metadata for one api_tokens row (never the hash). rowid works whether or not the migration declared an id column. */
export async function getTokenMeta(tokenHash: string): Promise<TokenMeta | null> {
  await ensureAuthSchema();
  return queryFirst<TokenMeta>(
    'SELECT rowid AS id, name, prefix, created, expires FROM api_tokens WHERE token_hash = ?',
    [tokenHash],
  );
}

/** Client-facing token record shape (last_used is not tracked; always null). */
export function tokenRecord(m: TokenMeta): {
  id: number;
  name: string;
  prefix: string;
  created: string;
  expires: string | null;
  last_used: null;
} {
  return { id: m.id, name: m.name, prefix: m.prefix, created: m.created, expires: m.expires, last_used: null };
}

export async function listApiTokens(
  userId: number,
): Promise<Array<{ id: number; name: string; prefix: string; created: string; expires: string | null }>> {
  await ensureAuthSchema();
  // rowid works regardless of whether the migration declared an id column.
  return queryAll(
    'SELECT rowid AS id, name, prefix, created, expires FROM api_tokens WHERE user_id = ? AND revoked = 0 ORDER BY rowid DESC',
    [userId],
  );
}

export async function revokeApiToken(userId: number, id?: number, plaintext?: string): Promise<boolean> {
  await ensureAuthSchema();
  if (plaintext) {
    const h = await sha256Hex(plaintext);
    await exec('UPDATE api_tokens SET revoked = 1 WHERE user_id = ? AND token_hash = ? AND revoked = 0', [
      userId,
      h,
    ]);
    const check = await queryFirst<{ n: number }>(
      'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND token_hash = ? AND revoked = 1',
      [userId, h],
    );
    return Number(check?.n) > 0;
  }
  if (id != null) {
    await exec('UPDATE api_tokens SET revoked = 1 WHERE user_id = ? AND rowid = ? AND revoked = 0', [userId, id]);
    const check = await queryFirst<{ n: number }>(
      'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND rowid = ? AND revoked = 1',
      [userId, id],
    );
    return Number(check?.n) > 0;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Request identity                                                    */
/* ------------------------------------------------------------------ */

/** Session cookie first, then Bearer API token. Null when anonymous. */
export async function getCurrentUser(req: Request): Promise<UserRow | null> {
  await ensureAuthSchema();
  const cookieTok = getCookie(req, SESSION_COOKIE);
  if (cookieTok) {
    const s = await queryFirst<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [
      await sha256Hex(cookieTok),
    ]);
    if (s && !isExpired(s.expires)) {
      const u = await findUserById(s.user_id);
      if (u) return u;
    }
  }
  const bearer = getBearer(req);
  if (bearer) {
    const t = await queryFirst<ApiTokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?', [
      await sha256Hex(bearer),
    ]);
    if (t && Number(t.revoked) === 0 && !isExpired(t.expires)) {
      const u = await findUserById(t.user_id);
      if (u) return u;
    }
  }
  return null;
}

export async function requireUser(req: Request): Promise<UserRow> {
  const u = await getCurrentUser(req);
  if (!u) {
    throw new HttpError(
      401,
      'auth required',
      'POST /api/auth/login with {email,password}, or send Authorization: Bearer <api-token>',
    );
  }
  return u;
}

export async function requireAdmin(req: Request): Promise<UserRow> {
  const u = await requireUser(req);
  if (!u.is_admin) throw new HttpError(403, 'admin required', 'this action needs a tracker admin');
  return u;
}

/* ------------------------------------------------------------------ */
/* Login challenges (gist-proof flow)                                  */
/* ------------------------------------------------------------------ */

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export async function createChallenge(githubId: number, githubLogin?: string | null): Promise<ChallengeRow> {
  await ensureAuthSchema();
  const row: ChallengeRow = {
    nonce: `ion-${randomTokenString(18)}`,
    github_id: githubId,
    github_login: githubLogin ?? null,
    gist_id: null,
    expires: expiresIso(CHALLENGE_TTL_MS),
    used: 0,
    created: nowIso(),
  };
  await exec(
    'INSERT INTO login_challenges (nonce, github_id, github_login, gist_id, expires, used, created) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [row.nonce, row.github_id, row.github_login ?? '', '', row.expires, row.created],
  );
  return row;
}

export async function getChallenge(nonce: string): Promise<ChallengeRow | null> {
  await ensureAuthSchema();
  return queryFirst<ChallengeRow>('SELECT * FROM login_challenges WHERE nonce = ?', [nonce]);
}

export async function latestChallengeFor(githubId: number): Promise<ChallengeRow | null> {
  await ensureAuthSchema();
  return queryFirst<ChallengeRow>(
    'SELECT * FROM login_challenges WHERE github_id = ? AND used = 0 ORDER BY rowid DESC LIMIT 1',
    [githubId],
  );
}

export async function markChallengeUsed(nonce: string, gistId?: string): Promise<void> {
  await exec('UPDATE login_challenges SET used = 1, gist_id = ? WHERE nonce = ?', [gistId ?? '', nonce]);
}

/* ------------------------------------------------------------------ */
/* Small validators                                                    */
/* ------------------------------------------------------------------ */
export const STATES = ['works', 'broken', 'in-progress', 'unknown'] as const;

export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function validSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
}

/**
 * INSERT then return the new row id. Uses RETURNING (supported by D1/SQLite);
 * falls back to the latest row when the helper layer cannot return it.
 */
export async function insertReturningId(sql: string, params: unknown[]): Promise<number | null> {
  const r = await queryFirst<{ id: number }>(`${sql} RETURNING id`, params as never[]).catch(() => null);
  return r && typeof r.id === 'number' ? r.id : null;
}
