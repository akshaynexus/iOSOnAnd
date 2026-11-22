// GET /api/changelog — write feed (public; ?limit= default 50, max 500,
// ?offset=; newest first; -> {changelog, total, limit, offset, next}).

import { createFileRoute } from '@tanstack/react-router';
import { json, paged, pageParams } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';
import type { ChangelogEntry } from '@/lib/types';

export const Route = createFileRoute('/api/changelog')({
  server: {
    handlers: apiHandlers({
      GET: async ({ request }) => {
        const page = pageParams(new URL(request.url).searchParams, 50, 500);
        const { rows, page: info } = await paged<ChangelogEntry>('SELECT * FROM changelog ORDER BY id DESC', 'SELECT COUNT(*) AS n FROM changelog', [], page);
        return json({ changelog: rows, ...info });
      },
    }),
  },
});
