// /api/claims/$id — GET one (public), PATCH {status} (admin), DELETE
// (the claimant withdraws or steps down from their own claim; admin: any).

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import { HttpError, actorName, isAdmin, json, readJson, requireUser } from '@/lib/auth';
import { loadClaim, reviewClaim } from '@/lib/claims';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { mapClaimRow } from '@/lib/devices';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ claim: mapClaimRow(await loadClaim(params.id)) });
}

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  return reviewClaim(request, params.id, String(body.status ?? ''), false);
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const claim = await loadClaim(params.id);
  if (claim.user_id !== user.id && !isAdmin(user)) {
    throw new HttpError(403, 'not your claim', 'only the claimant or an admin can delete a claim');
  }
  await exec('DELETE FROM claims WHERE id = ?', [claim.id]);
  await appendChangelog(actorName(user), `claim #${claim.id} withdrawn (${claim.device_slug})`);
  return json({ deleted: claim.id });
}

export const Route = createFileRoute('/api/claims/$id')({
  server: { handlers: apiHandlers({ GET: handleGet, PATCH: handlePatch, DELETE: handleDelete }) },
});
