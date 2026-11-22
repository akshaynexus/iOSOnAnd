// GET /api/auth/me — current user (session cookie or bearer token); 401 when
// anonymous. -> {user: {..., maintains, maintains_repos, can_post}, maintains,
// maintains_repos, can_post, is_admin, token_scopes?}: `maintains` lists the
// device slugs this user may edit (approved claims; admins may edit every
// device), `maintains_repos` the repos they maintain (OWNER/REPO), and
// `token_scopes` the scopes of the key the call was made with (absent with a
// session cookie).

import { createFileRoute } from '@tanstack/react-router';
import { authInfo, json, requireUser, toSelfUserWithTrust } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: apiHandlers({
      GET: async ({ request }) => {
        const user = await toSelfUserWithTrust(await requireUser(request));
        const a = await authInfo(request);
        return json({
          user,
          maintains: user.maintains,
          maintains_repos: user.maintains_repos,
          can_post: user.can_post,
          is_admin: user.is_admin,
          ...(a.via === 'token' ? { token_scopes: a.scopes } : {}),
        });
      },
    }),
  },
});
