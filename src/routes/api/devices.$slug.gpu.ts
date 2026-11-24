// /api/devices/$slug/gpu — how the phone's GPU acceleration works and how fast
// (migration 0018). GET (public) -> {gpu: {gpu, gpu_family, gpu_driver,
// accel, issues}} where accel is the record or null and issues the known GPU issues. PUT {method, stack?, fps_low?,
// fps_high? | fps: "40-58", fps_note?, repos?, detail?, source?, os_version?}
// (the phone's maintainers or an admin; a token needs status:write) ->
// {accel}. DELETE removes the record.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, json, readJson } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { queryFirst } from '@/lib/db';
import { deleteGpuAccel, getGpuAccel, listGpuIssues, setGpuAccel } from '@/lib/gpuAccel';
import { gpuInfo } from '@/lib/gpu';

async function handleGet({ params }: ApiCtx): Promise<Response> {
  const d = await queryFirst<{ gpu: string; soc: string }>('SELECT gpu, soc FROM devices WHERE slug = ?', [params.slug]);
  if (!d) throw new HttpError(404, 'unknown device', 'GET /api/devices?q= to search known devices');
  const [accel, issues] = await Promise.all([getGpuAccel(params.slug), listGpuIssues({ device: params.slug })]);
  return json({ gpu: { ...gpuInfo(d), accel, issues } });
}

async function handlePut({ request, params }: ApiCtx): Promise<Response> {
  return json({ accel: await setGpuAccel(request, params.slug, await readJson(request)) });
}

async function handleDelete({ request, params }: ApiCtx): Promise<Response> {
  await deleteGpuAccel(request, params.slug);
  return json({ ok: true });
}

export const Route = createFileRoute('/api/devices/$slug/gpu')({
  server: { handlers: apiHandlers({ GET: handleGet, PUT: handlePut, DELETE: handleDelete }) },
});
