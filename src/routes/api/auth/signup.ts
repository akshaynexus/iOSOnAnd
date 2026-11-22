// POST /api/auth/signup — email+password signup (public). 201 + session cookie.
// /api/auth/register is an alias. Logic: src/lib/signup.ts.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import { handleSignup } from '@/lib/signup';

export const Route = createFileRoute('/api/auth/signup')({
  server: { handlers: apiHandlers({ POST: ({ request }) => handleSignup(request) }) },
});
