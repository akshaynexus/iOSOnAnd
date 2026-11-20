// POST /api/auth/unlink — unlink your own GitHub account (UI shape).
// Same effect as DELETE /api/auth/gh-link (kept for the CLI/profile flow).

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import { HttpError, actorName, handleError, json, requireUser, toSelfUser } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';

export const Route = createFileRoute('/api/auth/unlink')({
  server: {
    handlers: {
  POST: async ({ request }: { request: Request }) => {
    try {
      const user = await requireUser(request);
      if (!user.github_id) throw new HttpError(404, 'no github linked', 'nothing to unlink');
      await exec('UPDATE users SET github_id = NULL, github_login = NULL, github_linked_at = NULL WHERE id = ?', [
        user.id,
      ]);
      await appendChangelog(actorName(user), 'unlinked github account');
      return json({ user: toSelfUser({ ...user, github_id: null, github_login: null, github_linked_at: null }) });
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
