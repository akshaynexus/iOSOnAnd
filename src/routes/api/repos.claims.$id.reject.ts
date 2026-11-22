// POST /api/repos/claims/$id/reject (admin): reject a pending repo claim. A
// fork row the claim created goes too, unless someone maintains it or other
// rows use it. -> {claim}.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, requireAdmin } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { expireStaleClaims, loadRepoClaim, mapRepoClaim, rejectRepoClaim } from '@/lib/repos';

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const admin = await requireAdmin(request);
  await expireStaleClaims();
  const claim = await loadRepoClaim(params.id);
  if (claim.status !== 'pending') throw new HttpError(409, `claim already ${claim.status}`, 'only a pending claim is rejected');
  return json({ claim: mapRepoClaim(await rejectRepoClaim(claim, admin), admin) });
}

export const Route = createFileRoute('/api/repos/claims/$id/reject')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
