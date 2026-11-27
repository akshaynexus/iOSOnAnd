// /api/stats — public usage statistics (migration 0021). GET ?range=7|30|all
// (default 30) -> {stats}: totals, the most viewed and most searched phones,
// top search terms, most viewed profiles, the most updated phones, the top
// contributors (status changes, admins left out) and one row per day.
// Counts only: nothing per person is stored.

import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { publicStats, type Range } from '@/lib/stats';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const r = new URL(request.url).searchParams.get('range');
  const range: Range = r === '7' || r === 'all' ? r : '30';
  return json({ stats: await publicStats(range) });
}

export const Route = createFileRoute('/api/stats')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
