// GET /api/changelog — write feed (public; ?limit= default 50, max 500,
// ?offset=; newest first; -> {changelog, total, limit, offset, next}).
// Account events (sign-ups, new accounts from GitHub sign-in, GitHub links,
// removed accounts) are left out; an admin gets them too with ?accounts=1.

import { createFileRoute } from '@tanstack/react-router';
import { getCurrentUser, json, paged, pageParams } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';
import type { ChangelogEntry } from '@/lib/types';

/** Changelog lines about accounts: only admins see them. */
const ACCOUNT_EVENTS = [
  "summary LIKE 'registered a new account%'",
  "summary LIKE 'created account %'",
  "summary LIKE 'account % removed'",
  "summary LIKE 'github login:%'",
  "summary LIKE 'github sign-in:%'",
  "summary LIKE 'linked github%'",
  "summary LIKE 'unlinked github%'",
].join(' OR ');

export const Route = createFileRoute('/api/changelog')({
  server: {
    handlers: apiHandlers({
      GET: async ({ request }) => {
        const sp = new URL(request.url).searchParams;
        const page = pageParams(sp, 50, 500);
        const admin = sp.get('accounts') === '1' && (await getCurrentUser(request))?.is_admin;
        const w = admin ? '' : `WHERE NOT (${ACCOUNT_EVENTS})`;
        const { rows, page: info } = await paged<ChangelogEntry>(`SELECT * FROM changelog ${w} ORDER BY id DESC`, `SELECT COUNT(*) AS n FROM changelog ${w}`, [], page);
        return json({ changelog: rows, ...info });
      },
    }),
  },
});
