// /api/gpu/issues — every phone's known GPU issues (public), to find who hit
// the same symptom and how they fixed it: ?kind= (white-widgets, black-ui,
// gpu-fault, out-of-memory, artifacts, slow, crash, other) ?state= (open,
// workaround, fixed) ?device= ?q= (words in the title, cause, fix, detail)
// -> {issues}, newest first (at most 500).

import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { listGpuIssues } from '@/lib/gpuAccel';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const g = (k: string) => sp.get(k)?.trim().slice(0, 100) || undefined;
  return json({ issues: await listGpuIssues({ kind: g('kind'), state: g('state'), device: g('device'), q: g('q') }) });
}

export const Route = createFileRoute('/api/gpu/issues')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
