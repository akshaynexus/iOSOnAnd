// /api/auth/tokens — manage your own bearer API tokens (auth required).
// GET: list metadata (never hashes). POST {name?, expires_days?}: mint (plaintext once).
// DELETE ?id= or {id} or {token}: revoke.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import {
  HttpError,
  json,
  listApiTokens,
  mintApiToken,
  readJson,
  requireUser,
  revokeApiToken,
} from '@/lib/auth';

async function handleGet(req: Request): Promise<Response> {
  const user = await requireUser(req);
  return json({ tokens: await listApiTokens(user.id) });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const name = String(body.name || 'cli').slice(0, 64);
  const days = Number(body.expires_days);
  const ttlMs = Number.isFinite(days) && days > 0 ? Math.min(days, 3650) * 86400000 : null;
  const t = await mintApiToken(user.id, name, ttlMs);
  return json(
    { ...t, note: 'store this token now; the plaintext is never shown again' },
    201,
  );
}

async function handleDelete(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const body = await readJson(req);
  const idRaw = url.searchParams.get('id') ?? body.id;
  const id = idRaw != null && idRaw !== '' ? Number(idRaw) : undefined;
  const token = typeof body.token === 'string' && body.token ? body.token : undefined;
  if ((id === undefined || !Number.isFinite(id)) && !token) {
    throw new HttpError(400, 'nothing to revoke', 'send {"id"} (from GET /api/auth/tokens) or {"token"}');
  }
  const ok = await revokeApiToken(user.id, id, token);
  if (!ok) throw new HttpError(404, 'token not found', 'it may already be revoked, or belong to another user');
  return json({ revoked: true });
}

export const Route = createFileRoute('/api/auth/tokens')({
  server: { handlers: apiHandlers({ GET: ({ request }) => handleGet(request), POST: ({ request }) => handlePost(request), DELETE: ({ request }) => handleDelete(request) }) },
});
