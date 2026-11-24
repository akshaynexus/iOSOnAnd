// GET /api/auth/github — is "Continue with GitHub" set up? -> {enabled}
// (src/lib/githubOAuth.ts: needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET).

import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';
import { githubOAuthConfig } from '@/lib/githubOAuth';

export const Route = createFileRoute('/api/auth/github')({
  server: { handlers: apiHandlers({ GET: () => json({ enabled: githubOAuthConfig() !== null }) }) },
});
