// /api/porting/$key/apply — POST {overwrite?, areas?}: write a porting record's
// areas to its phone's statuses (device-verified -> works, host-verified /
// implemented -> in-progress; planned skipped), citing the record. Rows that
// already have a state stay unless overwrite. Fills the phone's iOS version
// from the record's OS profile when it has none. The phone's maintainers or an
// admin; a token needs status:write. -> {device, applied, kept, ios_version}.

import { createFileRoute } from '@tanstack/react-router';
import { json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { applyPorting } from '@/lib/porting';
import { upsertStatus } from '@/lib/status';

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const body = await readJson(request);
  const areas = Array.isArray(body.areas) ? body.areas.map(String).slice(0, 40) : undefined;
  return json(await applyPorting(request, decodeURIComponent(params.key), { overwrite: body.overwrite === true, areas }, (req, d, a, b) => upsertStatus(req, d, a, b as Record<string, any>)));
}

export const Route = createFileRoute('/api/porting/$key/apply')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
