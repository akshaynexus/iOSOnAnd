// GET /docs/search?query= — full-text search over content/docs for the docs
// search dialog (Fumadocs). Kept out of /api/*: /api/search is the tracker's
// own search, and src/lib/openapi.ts documents /api only.

import { createFileRoute } from '@tanstack/react-router';
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

const server = createFromSource(source, { language: 'english' });

export const Route = createFileRoute('/docs/search')({
  server: { handlers: { GET: ({ request }) => server.GET(request) } },
});
