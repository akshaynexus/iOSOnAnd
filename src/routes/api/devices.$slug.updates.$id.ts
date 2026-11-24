// /api/devices/$slug/updates/$id — DELETE an update (its author or an admin;
// a token needs media:write). Its files stay in the phone's gallery. -> {ok}.

import { createFileRoute } from '@tanstack/react-router';
import { json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { deleteUpdate } from '@/lib/updates';

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  await deleteUpdate(user, params.slug, params.id);
  return json({ ok: true });
}

export const Route = createFileRoute('/api/devices/$slug/updates/$id')({
  server: { handlers: apiHandlers({ DELETE: handleDelete }) },
});
