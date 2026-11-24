// /api/devices/$slug/features — a phone's other notable features (what the
// checklist does not list, or uncommon hardware that works). GET (public)
// -> {features}; POST {name, state?, detail?, source?, os?} (the phone's
// maintainers or an admin; a token needs status:write) -> {feature}, 201.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { queryFirst } from '@/lib/db';
import { addFeature, listFeatures } from '@/lib/features';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  if (!(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [params.slug]))) {
    throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  }
  return json({ features: await listFeatures(params.slug) });
}

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  return json({ feature: await addFeature(request, params.slug, await readJson(request)) }, 201);
}

export const Route = createFileRoute('/api/devices/$slug/features')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
