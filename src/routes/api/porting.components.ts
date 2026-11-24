// /api/porting/components — a porting framework's driver and tool components
// (UniXNU's components.toml; migration 0019). GET (public) ?q= (matches the
// id, what it does and the hardware, e.g. q=adreno, q=wifi) ?framework= ->
// {components}, each with used_by: the records that use it and that area's
// status, best-verified first. POST {components: [...]} (admin): the import.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, readJson, requireAdmin } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { importComponents, listComponents } from '@/lib/porting';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  return json({ components: await listComponents(sp.get('q')?.trim().slice(0, 80) || '', sp.get('framework')?.trim() || undefined) });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  await requireAdmin(request);
  const body = await readJson(request);
  if (!Array.isArray(body.components) || !body.components.length) throw new HttpError(400, 'components required', 'send {"components": [{framework, id, ...}]}');
  if (body.components.length > 200) throw new HttpError(400, 'too many components', 'send at most 200 per request');
  return json({ imported: await importComponents(body.components) });
}

export const Route = createFileRoute('/api/porting/components')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
