// POST /api/repos/claims/$id/approve (an admin, or a maintainer of that repo):
// approve a pending repo claim without the proof file (method becomes 'admin'
// or 'maintainer'). The claimant joins the repo's maintainers and maintains
// its phones. -> {claim, fork}.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, isAdmin, json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { forkView } from '@/lib/forks';
import { approveRepoClaim, canReviewRepoClaim, expireStaleClaims, loadRepoClaim, mapRepoClaim } from '@/lib/repos';

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  await expireStaleClaims();
  const claim = await loadRepoClaim(params.id);
  if (!(await canReviewRepoClaim(user, claim))) {
    throw new HttpError(403, 'not a maintainer of this repo', `an admin or a maintainer of ${claim.repo} approves claims on it`);
  }
  if (claim.status !== 'pending') throw new HttpError(409, `claim already ${claim.status}`, 'only a pending claim is approved');
  const done = await approveRepoClaim(claim, user, isAdmin(user) ? 'admin' : 'maintainer');
  return json({ claim: mapRepoClaim(done.claim, user), fork: await forkView(done.fork) });
}

export const Route = createFileRoute('/api/repos/claims/$id/approve')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
