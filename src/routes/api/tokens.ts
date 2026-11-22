// /api/tokens — your own API keys (login; a token needs scope all).
// GET -> {tokens: [{id, name, prefix, scopes, created, last_used, expires,
// revoked}], total, limit, offset, next} (revoked keys too, newest first;
// never the secret). POST {name?, scopes?: ["status:write", ...] or "a,b"
// (default ["all"]), expires_in_days?: 30 | 90 | 365 | null (null or absent:
// never)} -> 201 {token, meta, record (= meta, the v1 name), note}; the
// plaintext is shown once, only sha256 is stored. The old field
// expires_days (any 1..3650) is still accepted.

import { createFileRoute } from '@tanstack/react-router';
import {
  HttpError,
  getTokenMeta,
  json,
  listAllApiTokens,
  mintApiToken,
  pageInfo,
  pageParams,
  parseScopes,
  readJson,
  requireUser,
  sha256Hex,
  str,
} from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';

const EXPIRY_DAYS = [30, 90, 365];

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const page = pageParams(new URL(request.url).searchParams, 100, 500);
  const { tokens, total } = await listAllApiTokens(user.id, page.limit, page.offset);
  return json({ tokens, ...pageInfo(total, page.limit, page.offset, tokens.length) });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const body = await readJson(request);
  let scopes: string[];
  try {
    scopes = parseScopes(body.scopes);
  } catch (e) {
    throw new HttpError(400, 'bad scopes', (e as Error).message);
  }
  let ttlMs: number | null = null;
  if (body.expires_in_days !== undefined && body.expires_in_days !== null && body.expires_in_days !== '') {
    const d = Number(body.expires_in_days);
    if (!EXPIRY_DAYS.includes(d)) throw new HttpError(400, 'bad expires_in_days', 'expires_in_days must be 30, 90, 365 or null (never)');
    ttlMs = d * 86400000;
  } else if (body.expires_days !== undefined && body.expires_days !== null) {
    const d = Number(body.expires_days);
    if (!Number.isFinite(d) || d <= 0) throw new HttpError(400, 'bad expires_days', 'expires_days must be a number of days from 1 to 3650');
    ttlMs = Math.min(d, 3650) * 86400000;
  }
  const t = await mintApiToken(user.id, str(body, 'name', 64) || 'tracker', ttlMs, { scopes });
  const meta = await getTokenMeta(await sha256Hex(t.token));
  if (!meta) throw new HttpError(500, 'token creation failed', 'retry');
  return json({ token: t.token, meta, record: meta, note: 'store this token now; the plaintext is never shown again' }, 201);
}

export const Route = createFileRoute('/api/tokens')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
