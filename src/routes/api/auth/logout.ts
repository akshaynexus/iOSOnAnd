// POST /api/auth/logout — destroy the session cookie's session. Always 200.

import { createFileRoute } from '@tanstack/react-router';
import {
  clearSessionCookieHeader,
  destroySessionByToken,
  getCookie,
  handleError,
  json,
  SESSION_COOKIE,
} from '@/lib/auth';

async function handlePost(req: Request): Promise<Response> {
  const tok = getCookie(req, SESSION_COOKIE);
  if (tok) await destroySessionByToken(tok);
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader() });
}

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
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
