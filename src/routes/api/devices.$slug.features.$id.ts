// /api/devices/$slug/features/$id — PATCH {name?, state?, detail?, source?,
// os?} or DELETE one of a phone's other notable features (the phone's
// maintainers or an admin; a token needs status:write).

import { createFileRoute } from '@tanstack/react-router';
import { json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { deleteFeature, updateFeature } from '@/lib/features';

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  return json({ feature: await updateFeature(request, params.slug, params.id, await readJson(request)) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  await deleteFeature(request, params.slug, params.id);
  return json({ ok: true });
}

export const Route = createFileRoute('/api/devices/$slug/features/$id')({
  server: { handlers: apiHandlers({ PATCH: handlePatch, DELETE: handleDelete }) },
});
