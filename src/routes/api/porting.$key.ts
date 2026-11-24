// /api/porting/$key — one porting record in full (public): per area its
// status, components, what it achieved, limits, next step, build/boot
// procedure and first evidence. key is "unixnu:<record>" or the record name.

import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { getPorting } from '@/lib/porting';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  return json({ record: await getPorting(decodeURIComponent(params.key)) });
}

export const Route = createFileRoute('/api/porting/$key')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
