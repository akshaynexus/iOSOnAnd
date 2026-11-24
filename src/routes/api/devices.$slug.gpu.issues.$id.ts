// /api/devices/$slug/gpu/issues/$id — PATCH (any field; e.g. {"state":
// "fixed", "fix": "..."}) or DELETE one GPU issue (the phone's maintainers or
// an admin; a token needs status:write).

import { createFileRoute } from '@tanstack/react-router';
import { json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { deleteGpuIssue, updateGpuIssue } from '@/lib/gpuAccel';

async function handlePatch({ request, params }: ApiCtx): Promise<Response> {
  return json({ issue: await updateGpuIssue(request, params.slug, params.id, await readJson(request)) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  await deleteGpuIssue(request, params.slug, params.id);
  return json({ ok: true });
}

export const Route = createFileRoute('/api/devices/$slug/gpu/issues/$id')({
  server: { handlers: apiHandlers({ PATCH: handlePatch, DELETE: handleDelete }) },
});
