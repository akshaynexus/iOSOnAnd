// GET /api/docs — live endpoint list with each endpoint's real auth level.
// Derived from src/lib/openapi.ts (the same source as GET /api/openapi.json);
// tests/api/openapi.test.ts fails when a handler under src/routes/api/ is
// missing there.

import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';
import { API_NOTES, AUTH_LEVELS, docsEndpoints } from '@/lib/openapi';

const ENDPOINTS = docsEndpoints();

export const Route = createFileRoute('/api/docs')({
  server: { handlers: apiHandlers({ GET: () => json({ auth_levels: AUTH_LEVELS, notes: API_NOTES, endpoints: ENDPOINTS }) }) },
});
