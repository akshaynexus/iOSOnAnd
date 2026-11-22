// POST /api/auth/logout — destroy the session cookie's session. Always 200.

import { createFileRoute } from '@tanstack/react-router';
import { SESSION_COOKIE, clearSessionCookieHeader, destroySessionByToken, getCookie, json } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: apiHandlers({
      POST: async ({ request }) => {
        const tok = getCookie(request, SESSION_COOKIE);
        if (tok) await destroySessionByToken(tok);
        return json({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader(request) });
      },
    }),
  },
});
