// DELETE /api/tokens/$id — revoke one of your tracker tokens (UI shape).

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, handleError, json, requireUser, revokeApiToken } from '@/lib/auth';

export const Route = createFileRoute('/api/tokens/$id')({
  server: {
    handlers: {
  DELETE: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
    try {
      const user = await requireUser(request);
      const id = Number(params.id);
      if (!Number.isInteger(id)) throw new HttpError(404, 'token not found', 'token ids are numeric');
      if (!(await revokeApiToken(user.id, id))) {
        throw new HttpError(404, 'token not found', 'it may already be revoked, or belong to another user');
      }
      return json({ ok: true });
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
