// POST /api/repos/claims/$id/approve (admin): approve a pending repo claim
// without the proof file (method becomes 'admin'). The claimant becomes the
// repo's maintainer and a maintainer of its device. -> {claim, fork}.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, requireAdmin } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { forkView } from '@/lib/forks';
import { approveRepoClaim, expireStaleClaims, loadRepoClaim, mapRepoClaim } from '@/lib/repos';

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const admin = await requireAdmin(request);
  await expireStaleClaims();
  const claim = await loadRepoClaim(params.id);
  if (claim.status !== 'pending') throw new HttpError(409, `claim already ${claim.status}`, 'only a pending claim is approved');
  const done = await approveRepoClaim(claim, admin, 'admin');
  return json({ claim: mapRepoClaim(done.claim, admin), fork: await forkView(done.fork) });
}

export const Route = createFileRoute('/api/repos/claims/$id/approve')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
