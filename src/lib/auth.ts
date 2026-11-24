// src/lib/auth.ts — Workers-safe auth and the trust model for the tracker.
//
// - Password hashing: WebCrypto PBKDF2-SHA256, 100 000 iterations (the most
//   Cloudflare Workers' WebCrypto accepts; above that deriveBits throws in
//   production), per-user 16-byte salt. With PASSWORD_PEPPER set (a Worker
//   secret, never in the DB) the password is first HMAC-SHA256'd with it, so a
//   leaked database alone cannot be cracked. Older hashes are re-hashed on
//   login. Losing PASSWORD_PEPPER invalidates every peppered hash.
// - Sessions: random 32-byte secret in an HttpOnly, SameSite=Lax cookie
//   (Secure on https); only sha256(secret) is stored (`sessions`).
// - API tokens: `ion_<random>`, sent as `Authorization: Bearer`; only
//   sha256(token) is stored (`api_tokens`). Lookups are by hash, so no
//   plaintext comparison happens at all.
// - Login challenges: single-use, 10-minute nonces (`login_challenges`) for
//   the gist-proof GitHub flow; consumed atomically (see consumeChallenge).
// - Schema: owned by migrations/ only (no runtime DDL here).
//
// Trust model (the contract the UI and CLI build to):
//   admin               users.is_admin = 1 (bootstrap: ADMIN_EMAIL/ADMIN_PASSWORD)
//   maintainer of X     a user with an APPROVED claim on device X
//   any logged-in user  POST /api/claims, own tokens/profile, every read
//   admin | maintainer  of X: status writes, forks for X, fork sync for X
//   admin | any maint.  POST /api/posts
//   admin only          claim review, devices/areas/users create, reddit
//                       fetch, every DELETE
// Denials are 403 {error, hint}. Helpers: requireUser, requireAdmin,
// requireDeviceEditor(req, slug), requirePoster(req), maintainedSlugs(id).
//
// API key scopes (src/lib/scopes.ts) are enforced in ONE place: requireUser.
// Every guard above calls it, so every write route goes through it. A request
// authenticated by a token needs scopeFor(method, path); a miss is 403
// {error:"token scope", hint:"needs <scope>"}. An expired token is 401. A
// session cookie is not scoped. A scope only narrows a key, it never adds
// rights. last_used is written at most once a minute per token.

import { queryAll, queryFirst, exec } from '@/lib/db';
import type { PublicUser } from '@/lib/types';
import { SCOPES, parseScopes, scopeAllows, scopeFor, type Scope } from '@/lib/scopes';

export { SCOPES, parseScopes, scopeAllows, scopeFor };
export type { Scope };

/* ------------------------------------------------------------------ */
/* HTTP helpers shared by all /api routes                              */
/* ------------------------------------------------------------------ */

export class HttpError extends Error {
  status: number;
  hint?: string;
  headers?: Record<string, string>;
  constructor(status: number, error: string, hint?: string, headers?: Record<string, string>) {
    super(error);
    this.status = status;
    this.hint = hint;
    this.headers = headers;
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(headers || {}),
    },
  });
}

export function apiError(status: number, error: string, hint?: string, headers?: Record<string, string>): Response {
  const body: Record<string, string> = { error };
  if (hint) body.hint = hint;
  return json(body, status, headers);
}

/** Map route exceptions to {error, hint} responses. Unknown bugs -> 500. */
export function handleError(e: unknown): Response {
  if (e instanceof HttpError) return apiError(e.status, e.message, e.hint, e.headers);
  const msg = e instanceof Error ? e.message : String(e);
  // A UNIQUE index caught a race the route's own pre-check missed.
  if (/UNIQUE constraint failed/i.test(msg)) {
    return apiError(409, 'already exists', 'a row with the same unique key exists; GET it instead of creating it again');
  }
  console.error('api error:', e);
  return apiError(500, 'internal error', 'retry; if it persists, report what you called');
}

const MAX_BODY_BYTES = 64 * 1024;

/** Parse a JSON object body. Empty body -> {}. Malformed / non-object -> 400. */
export async function readJson(req: Request): Promise<Record<string, any>> {
  let text = '';
  try {
    text = await req.text();
  } catch {
    throw new HttpError(400, 'unreadable request body', 'send a JSON object with Content-Type: application/json');
  }
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'body too large', 'keep request bodies under 64 KB');
  if (!text.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid JSON body', 'send a JSON object with Content-Type: application/json');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new HttpError(400, 'body must be a JSON object', 'send {"field": value, ...}');
  }
  return v as Record<string, any>;
}

/** Optional string field, trimmed, length-capped. Non-strings are rejected. */
export function str(body: Record<string, any>, key: string, max = 2000): string {
  const v = body[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(400, `bad ${key}`, `${key} must be a string`);
  }
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `${key} too long`, `${key} is limited to ${max} characters`);
  return s;
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

function isHttps(req: Request): boolean {
  if (req.url.startsWith('https://')) return true;
  return (req.headers.get('x-forwarded-proto') || '').toLowerCase() === 'https';
}

export function sessionCookieHeader(token: string, req: Request, maxAge = SESSION_TTL_SECONDS): string {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(req?: Request): string {
  const secure = req && isHttps(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
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

// Cloudflare Workers rejects PBKDF2 above 100 000 iterations ("iteration
// counts above 100000 are not supported"), so this is the ceiling, not a
// choice. Local workerd does not enforce it, which is how 210 000 slipped in.
export const PBKDF2_ITERATIONS = 100_000;
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

async function pbkdf2Key(password: string | Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const raw = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  const base = await crypto.subtle.importKey('raw', raw as unknown as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}

const PLAIN = 'pbkdf2-sha256';
const PEPPERED = 'pbkdf2-sha256-hmac';

function pepper(): string | undefined {
  return env('PASSWORD_PEPPER');
}

/** HMAC-SHA256(PASSWORD_PEPPER, password): the PBKDF2 input of peppered hashes. */
async function peppered(password: string, key: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(password)));
}

/**
 * Stored format: <scheme>$<iterations>$<base64 salt>$<base64 hash>; scheme is
 * pbkdf2-sha256-hmac when PASSWORD_PEPPER is set, else pbkdf2-sha256.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const p = pepper();
  const key = await pbkdf2Key(p ? await peppered(password, p) : password, salt, PBKDF2_ITERATIONS);
  return `${p ? PEPPERED : PLAIN}$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(key)}`;
}

/** True when a stored hash uses other parameters than hashPassword does now. */
export function needsRehash(stored: string): boolean {
  const [scheme, iterations] = stored.split('$');
  return scheme !== (pepper() ? PEPPERED : PLAIN) || iterations !== String(PBKDF2_ITERATIONS);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 4 || (parts[0] !== PLAIN && parts[0] !== PEPPERED)) return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
    const salt = b64decodeToBytes(parts[2]);
    const expected = b64decodeToBytes(parts[3]);
    if (salt.length < 8 || expected.length !== 32) return false;
    let input: string | Uint8Array = password;
    if (parts[0] === PEPPERED) {
      const p = pepper();
      if (!p) {
        console.error('a peppered password hash was found but PASSWORD_PEPPER is not set');
        return false;
      }
      input = await peppered(password, p);
    }
    const actual = await pbkdf2Key(input, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const DUMMY_SALT = new Uint8Array(SALT_BYTES);

/**
 * The same work as verifyPassword, always false. Run it when there is no
 * account (or no password) for the email, so that login takes as long as a
 * wrong password and does not reveal which emails are registered.
 */
export async function dummyVerifyPassword(password: string): Promise<false> {
  const p = pepper();
  await pbkdf2Key(p ? await peppered(password, p) : password, DUMMY_SALT, PBKDF2_ITERATIONS);
  return false;
}

/** The new-password rule (signup, change, reset): 10 to 256 characters, else 400. */
export function checkNewPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
    throw new HttpError(400, 'bad password', 'use 10 to 256 characters');
  }
  return password;
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
/* Env / time                                                          */
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
  id: number;
  token_hash: string;
  scopes: string | null;
  last_used: string | null;
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

export async function createUser(opts: {
  email?: string | null;
  passwordHash?: string | null;
  displayName: string;
  githubId?: number | null;
  githubLogin?: string | null;
  isAdmin?: boolean;
}): Promise<UserRow> {
  const email = opts.email ? opts.email.toLowerCase() : null;
  // users.token_hash is a NOT NULL UNIQUE leftover of the pre-auth schema
  // (migrations/0001_init.sql; never read): fill a random placeholder.
  const row = await queryFirst<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, contact, token_hash,
                        github_id, github_login, github_linked_at, is_admin, created)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      email,
      opts.passwordHash ?? null,
      opts.displayName.slice(0, 64),
      `legacy-${randomTokenString(16)}`,
      opts.githubId ?? null,
      opts.githubLogin ?? null,
      opts.githubId != null ? nowIso() : null,
      opts.isAdmin ? 1 : 0,
      nowIso(),
    ],
  );
  if (!row) throw new HttpError(500, 'user creation failed', 'retry');
  return row;
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

/** Self view plus the trust fields the UI gates on (maintains, maintains_repos, can_post). */
export async function toSelfUserWithTrust(
  u: UserRow,
): Promise<PublicUser & { email: string | null; maintains: string[]; maintains_repos: string[]; can_post: boolean }> {
  const [maintains, maintains_repos] = await Promise.all([maintainedSlugs(u.id), maintainedRepos(u.id)]);
  return { ...toSelfUser(u), maintains, maintains_repos, can_post: isAdmin(u) || maintains.length > 0 };
}

/** Repos (OWNER/REPO) whose fork row names this user as maintainer, sorted. */
export async function maintainedRepos(userId: number): Promise<string[]> {
  const rows = await queryAll<{ repo: string }>('SELECT repo FROM forks WHERE maintainer_user_id = ? ORDER BY repo', [userId]);
  return rows.map((r) => r.repo);
}

export function actorName(u: UserRow): string {
  if (u.github_login) return `@${u.github_login}`;
  if (u.display_name) return u.display_name;
  return `user#${u.id}`;
}

export function isAdmin(u: UserRow | null | undefined): boolean {
  return !!u && Number(u.is_admin) === 1;
}

/* ------------------------------------------------------------------ */
/* Bootstrap admin (ADMIN_EMAIL / ADMIN_PASSWORD env)                  */
/* ------------------------------------------------------------------ */

/** True when ADMIN_EMAIL is set and equals `email` (case-insensitive). */
export function isBootstrapAdminEmail(email: string): boolean {
  const adminEmail = env('ADMIN_EMAIL');
  return !!adminEmail && adminEmail.trim().toLowerCase() === email.trim().toLowerCase();
}

/** Constant-time check of {email,password} against ADMIN_EMAIL/ADMIN_PASSWORD. */
export async function matchesBootstrapAdmin(email: string, password: string): Promise<boolean> {
  const adminPassword = env('ADMIN_PASSWORD');
  if (!adminPassword || !isBootstrapAdminEmail(email)) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(password), digest(adminPassword)]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

/**
 * Login with the env admin pair. The env pair is authoritative: the account
 * is created on first use, promoted, and its stored hash reset to the env
 * password (so an account squatted on ADMIN_EMAIL cannot lock the owner out).
 * Returns null when {email,password} is not the env admin pair.
 *
 * (The old rule "promote user #1 if it is the admin" never fired once any
 * other account signed up first, which is what happened locally.)
 */
export async function loginBootstrapAdmin(email: string, password: string): Promise<UserRow | null> {
  if (!(await matchesBootstrapAdmin(email, password))) return null;
  const existing = await findUserByEmail(email);
  if (!existing) {
    return createUser({ email, passwordHash: await hashPassword(password), displayName: 'admin', isAdmin: true });
  }
  const hashOk =
    !!existing.password_hash &&
    !needsRehash(existing.password_hash) &&
    (await verifyPassword(password, existing.password_hash));
  const hash = hashOk ? existing.password_hash! : await hashPassword(password);
  await exec('UPDATE users SET is_admin = 1, password_hash = ? WHERE id = ?', [hash, existing.id]);
  return { ...existing, is_admin: 1, password_hash: hash };
}

/* ------------------------------------------------------------------ */
/* Sessions + API tokens                                               */
/* ------------------------------------------------------------------ */

export async function createSession(userId: number): Promise<{ token: string; row: SessionRow }> {
  const token = randomTokenString(32);
  const row: SessionRow = {
    token_hash: await sha256Hex(token),
    user_id: userId,
    created: nowIso(),
    expires: expiresIso(SESSION_TTL_SECONDS * 1000),
  };
  // Sweep expired sessions so the table does not grow forever (indexed).
  await exec("DELETE FROM sessions WHERE expires != '' AND expires < ?", [row.created]);
  await exec('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)', [
    row.token_hash,
    row.user_id,
    row.created,
    row.expires,
  ]);
  return { token, row };
}

export async function destroySessionByToken(plaintext: string): Promise<void> {
  await exec('DELETE FROM sessions WHERE token_hash = ?', [await sha256Hex(plaintext)]);
}

/**
 * Mint a token. `ttlMs` sets the expiry from now; `expiresAt` (an ISO time,
 * used by rotate) wins over it. Scopes default to ['all'].
 */
export async function mintApiToken(
  userId: number,
  name: string,
  ttlMs?: number | null,
  opts: { scopes?: readonly string[]; expiresAt?: string | null } = {},
): Promise<{ token: string; name: string; prefix: string; expires: string | null; id: number | null; scopes: string[] }> {
  const token = `ion_${randomTokenString(32)}`;
  const tokenHash = await sha256Hex(token);
  const scopes: string[] = parseScopes(opts.scopes ?? ['all']);
  const row = {
    name: (name || 'cli').slice(0, 64),
    prefix: token.slice(0, 12),
    created: nowIso(),
    expires: opts.expiresAt !== undefined ? opts.expiresAt || null : ttlMs ? expiresIso(ttlMs) : null,
  };
  const ins = await queryFirst<{ id: number }>(
    `INSERT INTO api_tokens (token_hash, user_id, name, prefix, created, expires, revoked, scopes)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?) RETURNING rowid AS id`,
    [tokenHash, userId, row.name, row.prefix, row.created, row.expires, scopes.join(',')],
  );
  return { token, name: row.name, prefix: row.prefix, expires: row.expires, id: ins?.id ?? null, scopes };
}

export interface TokenMeta {
  id: number;
  name: string;
  prefix: string;
  created: string;
  expires: string | null;
  scopes: string[];
  last_used: string | null;
  revoked: boolean;
}

const TOKEN_META_COLS = 'rowid AS id, name, prefix, created, expires, scopes, last_used, revoked';
type TokenMetaRow = Omit<TokenMeta, 'scopes' | 'revoked'> & { scopes: string | null; revoked: number };

function toTokenMeta(r: TokenMetaRow): TokenMeta {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    created: r.created,
    expires: r.expires || null,
    scopes: tokenScopes(r.scopes),
    last_used: r.last_used || null,
    revoked: Number(r.revoked) === 1,
  };
}

/** Stored scopes ("a,b") as a list; empty or NULL is ['all'] (pre-0004 tokens). */
export function tokenScopes(stored: string | null | undefined): string[] {
  const list = String(stored ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ['all'];
}

/** Public metadata for one api_tokens row (never the hash). */
export async function getTokenMeta(tokenHash: string): Promise<TokenMeta | null> {
  const r = await queryFirst<TokenMetaRow>(`SELECT ${TOKEN_META_COLS} FROM api_tokens WHERE token_hash = ?`, [tokenHash]);
  return r ? toTokenMeta(r) : null;
}

export async function getTokenMetaById(userId: number, id: number): Promise<TokenMeta | null> {
  const r = await queryFirst<TokenMetaRow>(`SELECT ${TOKEN_META_COLS} FROM api_tokens WHERE user_id = ? AND rowid = ?`, [userId, id]);
  return r ? toTokenMeta(r) : null;
}

/** Client-facing token record (the contract's token meta; never the hash). */
export function tokenRecord(m: TokenMeta): TokenMeta {
  return { ...m };
}

/** Active tokens (GET /api/auth/tokens). */
export async function listApiTokens(userId: number): Promise<TokenMeta[]> {
  const rows = await queryAll<TokenMetaRow>(
    `SELECT ${TOKEN_META_COLS} FROM api_tokens WHERE user_id = ? AND revoked = 0 ORDER BY rowid DESC LIMIT 500`,
    [userId],
  );
  return rows.map(toTokenMeta);
}

/** Every token, revoked ones too, newest first (GET /api/tokens). */
export async function listAllApiTokens(
  userId: number,
  limit: number,
  offset: number,
): Promise<{ tokens: TokenMeta[]; total: number }> {
  const [rows, n] = await Promise.all([
    queryAll<TokenMetaRow>(`SELECT ${TOKEN_META_COLS} FROM api_tokens WHERE user_id = ? ORDER BY rowid DESC LIMIT ? OFFSET ?`, [
      userId,
      limit,
      offset,
    ]),
    queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?', [userId]),
  ]);
  return { tokens: rows.map(toTokenMeta), total: Number(n?.n ?? 0) };
}

/**
 * Rotate: revoke token `id` (atomically, so two rotations cannot both win)
 * and mint a new one with the same name, scopes and expiry.
 */
export async function rotateApiToken(userId: number, id: number): Promise<{ token: string; meta: TokenMeta }> {
  const old = await getTokenMetaById(userId, id);
  if (!old) throw new HttpError(404, 'token not found', 'GET /api/tokens lists your keys');
  if (old.revoked) throw new HttpError(409, 'token revoked', 'a revoked key cannot be rotated; POST /api/tokens for a new one');
  if (isExpired(old.expires)) throw new HttpError(409, 'token expired', 'an expired key cannot be rotated; POST /api/tokens for a new one');
  const gone = await queryFirst<{ id: number }>(
    'UPDATE api_tokens SET revoked = 1 WHERE user_id = ? AND rowid = ? AND revoked = 0 RETURNING rowid AS id',
    [userId, id],
  );
  if (!gone) throw new HttpError(409, 'token revoked', 'another request rotated or revoked it first');
  const t = await mintApiToken(userId, old.name, null, { scopes: old.scopes, expiresAt: old.expires });
  const meta = await getTokenMeta(await sha256Hex(t.token));
  if (!meta) throw new HttpError(500, 'token creation failed', 'retry');
  return { token: t.token, meta };
}

export async function revokeApiToken(userId: number, id?: number, plaintext?: string): Promise<boolean> {
  let row: { id: number } | null = null;
  if (plaintext) {
    row = await queryFirst<{ id: number }>(
      'UPDATE api_tokens SET revoked = 1 WHERE user_id = ? AND token_hash = ? AND revoked = 0 RETURNING rowid AS id',
      [userId, await sha256Hex(plaintext)],
    );
  } else if (id != null) {
    row = await queryFirst<{ id: number }>(
      'UPDATE api_tokens SET revoked = 1 WHERE user_id = ? AND rowid = ? AND revoked = 0 RETURNING rowid AS id',
      [userId, id],
    );
  }
  return !!row;
}

/* ------------------------------------------------------------------ */
/* Request identity                                                    */
/* ------------------------------------------------------------------ */

export interface AuthInfo {
  user: UserRow | null;
  via: 'session' | 'token' | null;
  /** The token's scopes when via === 'token'. */
  scopes: string[] | null;
  tokenId: number | null;
  /** Why a sent bearer token was refused (expired, revoked, unknown). */
  error: HttpError | null;
}

const AUTH_CACHE = new WeakMap<Request, Promise<AuthInfo>>();
const LAST_USED_EVERY_MS = 60_000;

async function resolveAuth(req: Request): Promise<AuthInfo> {
  const none: AuthInfo = { user: null, via: null, scopes: null, tokenId: null, error: null };
  const cookieTok = getCookie(req, SESSION_COOKIE);
  if (cookieTok) {
    const s = await queryFirst<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [await sha256Hex(cookieTok)]);
    if (s && !isExpired(s.expires)) {
      const u = await findUserById(s.user_id);
      if (u) return { ...none, user: u, via: 'session' };
    }
  }
  const bearer = getBearer(req);
  if (!bearer) return none;
  const t = await queryFirst<ApiTokenRow>('SELECT rowid AS id, * FROM api_tokens WHERE token_hash = ?', [await sha256Hex(bearer)]);
  const refuse = (error: string, hint: string): AuthInfo => ({ ...none, error: new HttpError(401, error, hint) });
  if (!t || Number(t.revoked) !== 0) {
    return refuse('invalid token', 'the key is unknown or revoked: log in again (node cli.mjs login) or create a key');
  }
  if (isExpired(t.expires)) {
    return refuse('token expired', 'the key expired: create a new one (POST /api/tokens, node cli.mjs keys-create)');
  }
  const u = await findUserById(t.user_id);
  if (!u) return refuse('invalid token', 'the owning account is gone; log in again');
  // Throttled: at most one write per token per minute, never one per request.
  const now = Date.now();
  const last = t.last_used ? Date.parse(t.last_used) : NaN;
  if (!Number.isFinite(last) || now - last > LAST_USED_EVERY_MS) {
    try {
      await exec('UPDATE api_tokens SET last_used = ? WHERE rowid = ? AND (last_used IS NULL OR last_used < ?)', [
        new Date(now).toISOString(),
        t.id,
        new Date(now - LAST_USED_EVERY_MS).toISOString(),
      ]);
    } catch (e) {
      console.error('last_used update failed:', e);
    }
  }
  return { user: u, via: 'token', scopes: tokenScopes(t.scopes), tokenId: t.id, error: null };
}

/** Who made this request (resolved once per Request object). */
export function authInfo(req: Request): Promise<AuthInfo> {
  let p = AUTH_CACHE.get(req);
  if (!p) {
    p = resolveAuth(req);
    AUTH_CACHE.set(req, p);
  }
  return p;
}

/** Session cookie first, then Bearer API token. Null when anonymous. Not scope-checked. */
export async function getCurrentUser(req: Request): Promise<UserRow | null> {
  return (await authInfo(req)).user;
}

/**
 * The login guard, and the one place token scopes are enforced: a request
 * made with a token needs scopeFor(method, path) (src/lib/scopes.ts).
 */
export async function requireUser(req: Request): Promise<UserRow> {
  const a = await authInfo(req);
  if (!a.user) {
    if (a.error) throw a.error;
    throw new HttpError(
      401,
      'auth required',
      'POST /api/auth/login with {email,password}, or send Authorization: Bearer <api-token>',
    );
  }
  if (a.via === 'token') {
    const need = scopeFor(req.method, new URL(req.url).pathname);
    if (!scopeAllows(a.scopes ?? [], need)) throw new HttpError(403, 'token scope', `needs ${need}`);
  }
  return a.user;
}

export async function requireAdmin(req: Request): Promise<UserRow> {
  const u = await requireUser(req);
  if (!isAdmin(u)) throw new HttpError(403, 'admin required', 'only a tracker admin can do this');
  return u;
}

/* ------------------------------------------------------------------ */
/* Trust model: maintainers = approved claims                          */
/* ------------------------------------------------------------------ */

/** Device slugs the user maintains (approved claims), sorted. */
export async function maintainedSlugs(userId: number): Promise<string[]> {
  const rows = await queryAll<{ device_slug: string }>(
    "SELECT DISTINCT device_slug FROM claims WHERE user_id = ? AND status = 'approved' ORDER BY device_slug",
    [userId],
  );
  return rows.map((r) => r.device_slug);
}

export async function isMaintainer(userId: number, deviceSlug: string): Promise<boolean> {
  return !!(await queryFirst(
    "SELECT 1 AS ok FROM claims WHERE user_id = ? AND device_slug = ? AND status = 'approved' LIMIT 1",
    [userId, deviceSlug],
  ));
}

export async function canEditDevice(u: UserRow, deviceSlug: string | null): Promise<boolean> {
  if (isAdmin(u)) return true;
  if (!deviceSlug) return false;
  return isMaintainer(u.id, deviceSlug);
}

function claimHint(deviceSlug: string): string {
  return `claim this device: POST /api/claims {"device":"${deviceSlug}"}; an admin approves it, then you maintain it`;
}

/**
 * Admin, or a maintainer of `deviceSlug`. 401 anonymous, 404 unknown device,
 * 403 otherwise. `deviceSlug` null (a fork with no device) is admin-only.
 */
export async function requireDeviceEditor(req: Request, deviceSlug: string | null): Promise<UserRow> {
  const u = await requireUser(req);
  if (deviceSlug !== null && !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [deviceSlug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  if (await canEditDevice(u, deviceSlug)) return u;
  if (deviceSlug === null) {
    throw new HttpError(403, 'admin required', 'forks without a device are admin-only; set device_slug to a device you maintain');
  }
  throw new HttpError(403, `not a maintainer of ${deviceSlug}`, claimHint(deviceSlug));
}

/** Admin, or a maintainer of any device (posting updates / reddit links). */
export async function requirePoster(req: Request): Promise<UserRow> {
  const u = await requireUser(req);
  if (isAdmin(u)) return u;
  const any = await queryFirst("SELECT 1 AS ok FROM claims WHERE user_id = ? AND status = 'approved' LIMIT 1", [u.id]);
  if (any) return u;
  throw new HttpError(
    403,
    'maintainers only',
    'posting updates needs an approved claim on any device: POST /api/claims {"device":"<slug>"}; an admin approves it',
  );
}

/* ------------------------------------------------------------------ */
/* Login challenges (gist-proof flow)                                  */
/* ------------------------------------------------------------------ */

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export async function createChallenge(githubId: number, githubLogin?: string | null): Promise<ChallengeRow> {
  const row: ChallengeRow = {
    nonce: `ion-${randomTokenString(18)}`,
    github_id: githubId,
    github_login: githubLogin ?? null,
    gist_id: null,
    expires: expiresIso(CHALLENGE_TTL_MS),
    used: 0,
    created: nowIso(),
  };
  // Sweep stale challenges (expired or used over a day ago); indexed on expires.
  await exec('DELETE FROM login_challenges WHERE expires < ?', [new Date(Date.now() - 86400000).toISOString()]);
  await exec(
    'INSERT INTO login_challenges (nonce, github_id, github_login, gist_id, expires, used, created) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [row.nonce, row.github_id, row.github_login ?? '', '', row.expires, row.created],
  );
  return row;
}

export async function getChallenge(nonce: string): Promise<ChallengeRow | null> {
  return queryFirst<ChallengeRow>('SELECT * FROM login_challenges WHERE nonce = ?', [nonce]);
}

export async function latestChallengeFor(githubId: number): Promise<ChallengeRow | null> {
  return queryFirst<ChallengeRow>(
    'SELECT * FROM login_challenges WHERE github_id = ? AND used = 0 AND expires > ? ORDER BY rowid DESC LIMIT 1',
    [githubId, nowIso()],
  );
}

/**
 * Atomically mark a challenge used. Throws 410 when another request consumed
 * it first (or it expired meanwhile), so one nonce proves exactly one login.
 */
export async function consumeChallenge(nonce: string, gistId?: string): Promise<void> {
  const r = await queryFirst<{ nonce: string }>(
    'UPDATE login_challenges SET used = 1, gist_id = ? WHERE nonce = ? AND used = 0 AND expires > ? RETURNING nonce',
    [gistId ?? '', nonce, nowIso()],
  );
  if (!r) {
    throw new HttpError(410, 'challenge already used or expired', 'POST /api/auth/gh-challenge for a fresh nonce and retry');
  }
}

/* ------------------------------------------------------------------ */
/* Validators                                                          */
/* ------------------------------------------------------------------ */

export const STATES = ['works', 'broken', 'in-progress', 'unknown'] as const;
export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const VERIFIED = ['fork-claim', 'reproduced', 'merged'] as const;
export const REPO_KINDS = ['home', 'fork', 'snapshot', 'mirror', 'none'] as const;
export const BASES = ['oneios', 'other'] as const;
export const AREA_SCOPES = ['all', 'oneios'] as const;
export const FORK_KINDS = ['upstream', 'fork', 'standalone'] as const;
export const SUPPORT_LEVELS = ['primary', 'merged', 'ported', 'claimed'] as const;
export const REPO_CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export const REPO_CLAIM_METHODS = ['owner', 'proof-file', 'admin'] as const;

/** ?limit= and ?offset= of a list endpoint. limit 1..max (default `def`), offset >= 0. */
export function pageParams(sp: URLSearchParams, def = 100, max = 500): { limit: number; offset: number } {
  const rawL = sp.get('limit');
  const rawO = sp.get('offset');
  const limit = rawL === null || rawL === '' ? def : Number(rawL);
  const offset = rawO === null || rawO === '' ? 0 : Number(rawO);
  if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, 'bad limit', `limit must be an integer from 1 to ${max}`);
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'bad offset', 'offset must be an integer >= 0');
  return { limit: Math.min(limit, max), offset };
}

/** The page fields every list response carries next to its array. */
export function pageInfo(
  total: number,
  limit: number,
  offset: number,
  count: number,
): { total: number; limit: number; offset: number; next: number | null } {
  return { total, limit, offset, next: offset + count < total ? offset + count : null };
}

export function oneOf<T extends string>(list: readonly T[], v: string, field: string): T {
  if (!(list as readonly string[]).includes(v)) {
    throw new HttpError(400, `bad ${field}`, `${field} must be one of: ${list.join(' | ')}`);
  }
  return v as T;
}

export function validEmail(e: string): boolean {
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function validSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
}

/** GitHub-style OWNER/REPO. */
export function validRepo(s: string): boolean {
  return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(s);
}

export function validHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Reddit post URL check + canonical form. Accepts
 * https://(www.|old.)reddit.com/r/<sub>/... and https://redd.it/<id>; old.
 * becomes www., query/fragment and trailing slash are dropped (so the same
 * post cannot be tracked twice under two spellings). Null when not reddit.
 */
export function normalizeRedditUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  if (host === 'redd.it') {
    return /^\/[A-Za-z0-9]{1,16}$/.test(path) ? `https://redd.it${path}` : null;
  }
  if (host !== 'reddit.com' && host !== 'www.reddit.com' && host !== 'old.reddit.com') return null;
  if (!/^\/r\/[A-Za-z0-9_]{1,21}(\/[^\s]*)?$/.test(path)) return null;
  return `https://www.reddit.com${path}`;
}

/** Strict YYYY-MM-DD that is a real calendar date. */
export function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** INSERT ... RETURNING id; null when nothing came back. */
export async function insertReturningId(sql: string, params: unknown[]): Promise<number | null> {
  const r = await queryFirst<{ id: number }>(`${sql} RETURNING id`, params);
  return r && typeof r.id === 'number' ? r.id : null;
}

/**
 * One page of a list: `sql` without LIMIT (LIMIT ? OFFSET ? is appended) and
 * `countSql` counting the same rows, both taking `params`.
 */
export async function paged<T>(
  sql: string,
  countSql: string,
  params: unknown[],
  p: { limit: number; offset: number },
): Promise<{ rows: T[]; page: { total: number; limit: number; offset: number; next: number | null } }> {
  const [rows, n] = await Promise.all([
    queryAll<T>(`${sql} LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]),
    queryFirst<{ n: number }>(countSql, params),
  ]);
  return { rows, page: pageInfo(Number(n?.n ?? 0), p.limit, p.offset, rows.length) };
}
