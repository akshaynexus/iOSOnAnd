// POST /api/claims/$id/approve — admin approves a pending claim (409 if not pending).

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { reviewClaim } from '@/lib/claims';

export const Route = createFileRoute('/api/claims/$id/approve')({
  server: {
    handlers: apiHandlers({
      POST: ({ request, params }) => reviewClaim(request, params.id, 'approved', true),
    }),
  },
});
