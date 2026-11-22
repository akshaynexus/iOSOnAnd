// DELETE /api/tokens/$id — revoke one of your own API keys (login; a token
// needs scope all). -> {ok: true, meta}. CLI: keys-revoke <id>.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, getTokenMetaById, json, requireUser, revokeApiToken } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';

export const Route = createFileRoute('/api/tokens/$id')({
  server: {
    handlers: apiHandlers({
      DELETE: async ({ request, params }) => {
        const user = await requireUser(request);
        if (!/^\d{1,15}$/.test(params.id)) throw new HttpError(404, 'token not found', 'token ids are numeric');
        if (!(await revokeApiToken(user.id, Number(params.id)))) {
          throw new HttpError(404, 'token not found', 'it may already be revoked, or belong to another user');
        }
        return json({ ok: true, meta: await getTokenMetaById(user.id, Number(params.id)) });
      },
    }),
  },
});
