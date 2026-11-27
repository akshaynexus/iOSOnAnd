// /api/stats/hit — POST {kind, key} counts one page view or search (no login;
// the site sends it once per page and day). kind: device_view (key = phone
// slug), profile_view (key = user id), search (key = the search; kept only
// when it matches a phone). -> 204. Only daily totals are stored: no IP, no
// user, nothing per person.

import { createFileRoute } from '@tanstack/react-router';
import { readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { recordHit } from '@/lib/stats';

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  await recordHit(String(body.kind ?? ''), String(body.key ?? ''));
  return new Response(null, { status: 204 });
}

export const Route = createFileRoute('/api/stats/hit')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
