// /api/* catch-all — any path no other /api route matches answers a JSON 404
// (every method), instead of falling through to the SSR HTML shell.

import { createFileRoute } from '@tanstack/react-router';
import { apiError } from '@/lib/auth';

const notFound = ({ request }: { request: Request }) =>
  apiError(404, `no such endpoint: ${request.method.toUpperCase()} ${new URL(request.url).pathname}`, 'GET /api/docs lists every endpoint');

export const Route = createFileRoute('/api/$')({
  server: { handlers: { ANY: notFound } },
});
