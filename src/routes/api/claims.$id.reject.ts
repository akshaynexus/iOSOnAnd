// POST /api/claims/$id/reject — admin rejects a pending claim.

import { createFileRoute } from '@tanstack/react-router';
import { queryFirst, exec } from '@/lib/db';
import { HttpError, actorName, handleError, json, nowIso, requireAdmin } from '@/lib/auth';
import { claimLabel, loadClaim } from '@/routes/api/claims.$id';
import { findUserById } from '@/lib/auth';
import { appendChangelog } from '@/lib/changelog';
import type { Claim } from '@/lib/types';

export const Route = createFileRoute('/api/claims/$id/reject')({
  server: {
    handlers: {
  POST: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
    try {
      const admin = await requireAdmin(request);
      const claim = await loadClaim(params.id);
      if (claim.status !== 'pending') {
        throw new HttpError(409, `claim already ${claim.status}`, 'only pending claims can be rejected');
      }
      await exec('UPDATE claims SET status = ?, updated = ? WHERE id = ?', ['rejected', nowIso(), claim.id]);
      const row = await queryFirst<Claim>('SELECT * FROM claims WHERE id = ?', [claim.id]);
      const who = await findUserById(claim.user_id);
      await appendChangelog(actorName(admin), `claim #${claim.id} rejected (${claim.device_slug})`);
      return json({
        claim: {
          id: claim.id,
          device_slug: claim.device_slug,
          user: claimLabel(who?.display_name, who?.github_login, claim.user_id),
          note: row?.note ?? '',
          status: 'rejected',
          updated: row?.updated ?? '',
        },
      });
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
