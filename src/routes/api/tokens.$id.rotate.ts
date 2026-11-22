// POST /api/tokens/$id/rotate — a new secret with the same name, scopes and
// expiry; the old key is revoked in the same step (login; a token needs scope
// all). -> 201 {token, meta, note}. 409 when the key is revoked or expired.
// CLI: keys-rotate <id>.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, requireUser, rotateApiToken } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';

export const Route = createFileRoute('/api/tokens/$id/rotate')({
  server: {
    handlers: apiHandlers({
      POST: async ({ request, params }) => {
        const user = await requireUser(request);
        if (!/^\d{1,15}$/.test(params.id)) throw new HttpError(404, 'token not found', 'token ids are numeric');
        const r = await rotateApiToken(user.id, Number(params.id));
        return json({ ...r, note: 'store this token now; the old one no longer works' }, 201);
      },
    }),
  },
});
