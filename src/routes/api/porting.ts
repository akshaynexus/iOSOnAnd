// /api/porting — porting records imported from a porting framework (UniXNU's
// device records, the source of unixnu.com/devices; migration 0019).
// GET (public) ?device= ?repo= ?codename= ?component= (records that use it,
// e.g. Adreno740, Ath12kWifi) ?framework= ?area= ?status= (e.g. area=gpu&
// status=device-verified) ?limit= (default 50, max 500) ?offset= ->
// {records: [summary], total, limit, offset, next}, best-verified first.
// POST {records: [...]} (admin): the import, upserted by framework + record.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, actorName, json, pageInfo, pageParams, readJson, requireAdmin } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { importPorting, listPorting } from '@/lib/porting';
import { appendChangelog } from '@/lib/changelog';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const page = pageParams(sp, 50, 500);
  const g = (k: string) => sp.get(k)?.trim().slice(0, 120) || undefined;
  const { rows, total } = await listPorting(
    { device: g('device'), repo: g('repo'), codename: g('codename'), component: g('component'), framework: g('framework'), area: g('area'), status: g('status') },
    page.limit,
    page.offset,
  );
  return json({ records: rows, ...pageInfo(total, page.limit, page.offset, rows.length) });
}

async function handlePost({ request }: ApiCtx): Promise<Response> {
  const user = await requireAdmin(request);
  const body = await readJson(request);
  if (!Array.isArray(body.records) || !body.records.length) throw new HttpError(400, 'records required', 'send {"records": [{framework, record, areas, ...}]}');
  if (body.records.length > 50) throw new HttpError(400, 'too many records', 'send at most 50 records per request');
  const n = await importPorting(body.records);
  await appendChangelog(actorName(user), `porting records imported: ${n} (${[...new Set(body.records.map((r: any) => String(r.framework)))].join(', ')})`);
  return json({ imported: n });
}

export const Route = createFileRoute('/api/porting')({
  server: { handlers: apiHandlers({ GET: handleGet, POST: handlePost }) },
});
