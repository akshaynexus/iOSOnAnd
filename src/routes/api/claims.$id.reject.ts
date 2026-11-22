// POST /api/claims/$id/reject — admin rejects a pending claim (409 if not pending).

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { reviewClaim } from '@/lib/claims';

export const Route = createFileRoute('/api/claims/$id/reject')({
  server: {
    handlers: apiHandlers({
      POST: ({ request, params }) => reviewClaim(request, params.id, 'rejected', true),
    }),
  },
});
