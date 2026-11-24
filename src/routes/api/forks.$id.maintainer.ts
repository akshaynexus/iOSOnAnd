// DELETE /api/forks/$id/maintainer — you step down as one of the repo's
// maintainers (others stay); ?user=ID: an admin or the repo's GitHub owner
// removes that one (an admin without ?user removes the first maintainer).
// The device claims their repo claim granted go too, unless they maintain
// another repo of that phone. -> {fork}. /api/forks/$id/maintainers lists
// and adds maintainers.

import { createFileRoute } from '@tanstack/react-router';
import { json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { forkView, loadForkRow } from '@/lib/forks';
import { removeMaintainer } from '@/lib/repos';

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const fork = await loadForkRow(params.id);
  const target = new URL(request.url).searchParams.get('user');
  return json({ fork: await forkView(await removeMaintainer(fork, user, target ? Number(target) : undefined)) });
}

export const Route = createFileRoute('/api/forks/$id/maintainer')({
  server: { handlers: apiHandlers({ DELETE: handleDelete }) },
});
