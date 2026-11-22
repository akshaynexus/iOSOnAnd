// DELETE /api/forks/$id/maintainer — the repo's maintainer steps down, or an
// admin removes them. The device claim their repo claim granted goes too,
// unless they maintain another repo of that device. -> {fork}.

import { createFileRoute } from '@tanstack/react-router';
import { json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { forkView, loadForkRow } from '@/lib/forks';
import { removeMaintainer } from '@/lib/repos';

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const fork = await loadForkRow(params.id);
  return json({ fork: await forkView(await removeMaintainer(fork, user)) });
}

export const Route = createFileRoute('/api/forks/$id/maintainer')({
  server: { handlers: apiHandlers({ DELETE: handleDelete }) },
});
