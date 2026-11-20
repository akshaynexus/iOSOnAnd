// GET /api/auth/me — current user (session cookie or bearer token). 401 anonymous.

import { createFileRoute } from '@tanstack/react-router';
import { handleError, json, requireUser, toSelfUser } from '@/lib/auth';

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
  GET: async ({ request }: { request: Request }) => {
    try {
      const user = await requireUser(request);
      return json({ user: toSelfUser(user) });
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
