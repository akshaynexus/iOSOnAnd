// POST /api/repos/claims/$id/reject (an admin, or a maintainer of that repo):
// reject a pending repo claim. A
// fork row the claim created goes too, unless someone maintains it or other
// rows use it. -> {claim}.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { canReviewRepoClaim, expireStaleClaims, loadRepoClaim, mapRepoClaim, rejectRepoClaim } from '@/lib/repos';

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  await expireStaleClaims();
  const claim = await loadRepoClaim(params.id);
  if (!(await canReviewRepoClaim(user, claim))) {
    throw new HttpError(403, 'not a maintainer of this repo', `an admin or a maintainer of ${claim.repo} rejects claims on it`);
  }
  if (claim.status !== 'pending') throw new HttpError(409, `claim already ${claim.status}`, 'only a pending claim is rejected');
  return json({ claim: mapRepoClaim(await rejectRepoClaim(claim, user), user) });
}

export const Route = createFileRoute('/api/repos/claims/$id/reject')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
