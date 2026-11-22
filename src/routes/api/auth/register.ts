// POST /api/auth/register — email+password signup (public). 201 + session cookie.
// Alias of /api/auth/signup. Logic: src/lib/signup.ts.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { handleSignup } from '@/lib/signup';

export const Route = createFileRoute('/api/auth/register')({
  server: { handlers: apiHandlers({ POST: ({ request }) => handleSignup(request) }) },
});
