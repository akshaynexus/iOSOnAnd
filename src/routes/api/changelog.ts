// GET /api/changelog — write feed (?limit=, default 50, max 200).

import { createFileRoute } from '@tanstack/react-router';
import { handleError, json } from '@/lib/auth';
import { listChangelog } from '@/lib/changelog';

export const Route = createFileRoute('/api/changelog')({
  server: {
    handlers: {
  GET: async ({ request }: { request: Request }) => {
    try {
      const limit = new URL(request.url).searchParams.get('limit');
      return json({ changelog: await listChangelog(limit ? Number(limit) : 50) });
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
