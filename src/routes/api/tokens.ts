// /api/tokens — tracker-token management (UI shape).
// GET: list metadata (never hashes). POST {name?, expires_days?}: mint, returns
// {token, record} (plaintext shown once).

import { createFileRoute } from '@tanstack/react-router';
import {
  HttpError,
  getTokenMeta,
  handleError,
  json,
  listApiTokens,
  mintApiToken,
  readJson,
  requireUser,
  sha256Hex,
  tokenRecord,
} from '@/lib/auth';

async function handleGet(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const tokens = (await listApiTokens(user.id)).map((t) => ({ ...t, last_used: null }));
  return json({ tokens });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const name = String(body.name || 'tracker').slice(0, 64);
  const days = Number(body.expires_days);
  const ttlMs = Number.isFinite(days) && days > 0 ? Math.min(days, 3650) * 86400000 : null;
  const t = await mintApiToken(user.id, name, ttlMs);
  if (t.id == null) throw new HttpError(500, 'token creation failed', 'retry');
  const meta = await getTokenMeta(await sha256Hex(t.token));
  if (!meta) throw new HttpError(500, 'token creation failed', 'retry');
  return json(
    { token: t.token, record: tokenRecord(meta), note: 'store this token now; the plaintext is never shown again' },
    201,
  );
}

export const Route = createFileRoute('/api/tokens')({
  server: {
    handlers: {
  GET: async ({ request }: { request: Request }) => {
    try {
      return await handleGet(request);
    } catch (e) {
      return handleError(e);
    }
  },
  POST: async ({ request }: { request: Request }) => {
    try {
      return await handlePost(request);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
