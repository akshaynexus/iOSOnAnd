// GET /api/openapi.json — the API as an OpenAPI 3.1 document (public).
// Source: src/lib/openapi.ts. Rendered by /api-reference (Scalar).

import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';
import { openapiDocument } from '@/lib/openapi';

export const Route = createFileRoute('/api/openapi.json')({
  server: {
    handlers: apiHandlers({
      GET: ({ request }) => json(openapiDocument(new URL(request.url).origin), 200, { 'access-control-allow-origin': '*' }),
    }),
  },
});
