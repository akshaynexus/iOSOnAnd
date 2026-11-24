// src/lib/password.ts — change and reset a password.
//
// Change (POST /api/auth/password, logged in): needs the current password.
//   Ends every other session of the account; API keys stay unless
//   revoke_tokens is true.
// Reset (no login):
//   1. POST /api/auth/password-reset {email} always answers the same 200, so
//      it does not reveal whether the email has an account. When it does (and
//      has a password), a link /reset-password#token=<secret> is mailed
//      (src/lib/mail.ts). The secret sits in the URL fragment, which browsers
//      never send to a server, so it stays out of logs and Referer headers.
//      Only sha256(secret) is stored (password_resets); 30-minute expiry;
//      a new request replaces older unused links.
//   2. POST /api/auth/password-reset/confirm {token, password} spends the
//      link once (atomic UPDATE ... WHERE used IS NULL), sets the password,
//      ends every session, revokes every API key (whoever had the old
//      password may have made some), and logs the caller in.

import { waitUntil } from 'cloudflare:workers';
import { exec, queryFirst } from '@/lib/db';
import {
  HttpError,
  type UserRow,
  checkNewPassword,
  createSession,
  env,
  expiresIso,
  findUserByEmail,
  findUserById,
  getCookie,
  hashPassword,
  nowIso,
  randomTokenString,
  SESSION_COOKIE,
  sha256Hex,
  verifyPassword,
} from '@/lib/auth';
import { sendMail } from '@/lib/mail';

export const RESET_TTL_MS = 30 * 60 * 1000;

/** The site origin for links in mail: PUBLIC_URL when set, else the request's own. */
export function publicOrigin(req: Request): string {
  const set = env('PUBLIC_URL');
  if (set) return set.replace(/\/+$/, '');
  return new URL(req.url).origin;
}

function background(p: Promise<unknown>): Promise<unknown> {
  // Answer before the mail goes out, so response time does not reveal whether
  // the email has an account. Outside the Workers runtime, just await it.
  try {
    waitUntil(p.catch((e) => console.error('background task failed:', e)));
    return Promise.resolve();
  } catch {
    return p;
  }
}

export async function changePassword(
  req: Request,
  user: UserRow,
  current: string,
  next: unknown,
  revokeTokens: boolean,
): Promise<{ sessions_ended: number; tokens_revoked: number }> {
  if (!user.password_hash) {
    throw new HttpError(409, 'no password set', 'this account logs in with GitHub; it has no password to change');
  }
  if (!current || current.length > 256 || !(await verifyPassword(current, user.password_hash))) {
    throw new HttpError(401, 'wrong current password', 'send the password you log in with now as current_password');
  }
  const password = checkNewPassword(next);
  await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id]);
  const cookie = getCookie(req, SESSION_COOKIE);
  const keep = cookie ? await sha256Hex(cookie) : '';
  const s = await queryFirst<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND token_hash != ?',
    [user.id, keep],
  );
  await exec('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [user.id, keep]);
  let tokens = 0;
  if (revokeTokens) tokens = await revokeAllTokens(user.id);
  return { sessions_ended: Number(s?.n ?? 0), tokens_revoked: tokens };
}

async function revokeAllTokens(userId: number): Promise<number> {
  const t = await queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked = 0', [userId]);
  await exec('UPDATE api_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', [userId]);
  return Number(t?.n ?? 0);
}

/**
 * Step 1, run after the response (waitUntil): the lookup, the insert and the
 * mail all happen in the background, so the answer takes the same time
 * whether or not the email has an account.
 */
export function scheduleReset(req: Request, email: string): Promise<unknown> {
  return background(requestReset(req, email));
}

async function requestReset(req: Request, email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash || !user.email) return;
  const secret = randomTokenString(32);
  const now = nowIso();
  await exec('DELETE FROM password_resets WHERE expires < ? OR (user_id = ? AND used IS NULL)', [now, user.id]);
  await exec('INSERT INTO password_resets (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)', [
    await sha256Hex(secret),
    user.id,
    now,
    expiresIso(RESET_TTL_MS),
  ]);
  const link = `${publicOrigin(req)}/reset-password#token=${secret}`;
  const text = [
    'Someone asked to reset the password of your iOSOnAnd account.',
    '',
    'Set a new password (the link works once, for 30 minutes):',
    link,
    '',
    'If it was not you, ignore this mail. Your password stays as it is.',
  ].join('\n');
  const html = `<p>Someone asked to reset the password of your iOSOnAnd account.</p>
<p><a href="${link}">Set a new password</a>. The link works once, for 30 minutes.</p>
<p>If it was not you, ignore this mail. Your password stays as it is.</p>`;
  await sendMail({ to: user.email, subject: 'Reset your iOSOnAnd password', text, html }, req.url);
}

/** Step 2. Returns the user and a fresh session token. */
export async function confirmReset(token: unknown, next: unknown): Promise<{ user: UserRow; session: string; tokens_revoked: number }> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    throw new HttpError(400, 'bad token', 'send the token from the reset link');
  }
  const password = checkNewPassword(next);
  const row = await queryFirst<{ user_id: number }>(
    'UPDATE password_resets SET used = ? WHERE token_hash = ? AND used IS NULL AND expires > ? RETURNING user_id',
    [nowIso(), await sha256Hex(token), nowIso()],
  );
  if (!row) throw new HttpError(410, 'reset link expired or used', 'ask for a new link at /forgot-password');
  const user = await findUserById(row.user_id);
  if (!user) throw new HttpError(410, 'reset link expired or used', 'the account is gone');
  const hash = await hashPassword(password);
  await exec('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
  await exec('DELETE FROM sessions WHERE user_id = ?', [user.id]);
  await exec('DELETE FROM password_resets WHERE user_id = ? AND used IS NULL', [user.id]);
  const tokens = await revokeAllTokens(user.id);
  const { token: session } = await createSession(user.id);
  return { user: { ...user, password_hash: hash }, session, tokens_revoked: tokens };
}
