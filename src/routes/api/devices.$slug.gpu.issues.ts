// /api/devices/$slug/gpu/issues — the phone's known GPU issues (migration
// 0020). GET (public) -> {issues}, open first. POST {title, kind?, state?,
// cause?, fix?, detail?, source?, os_version?} (the phone's maintainers or an
// admin; a token needs status:write) -> {issue}, 201.

import { createFileRoute } from '@tanstack/react-router';
import { json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { addGpuIssue, listGpuIssues } from '@/lib/gpuAccel';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ issues: await listGpuIssues({ device: params.slug }) });
}

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  return json({ issue: await addGpuIssue(request, params.slug, await readJson(request)) }, 201);
}

export const Route = createFileRoute('/api/devices/$slug/gpu/issues')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
