// GET /api/repos/claims (login): your repo claims; an admin sees everyone's.
// ?status=pending|approved|rejected|expired, ?repo=OWNER/REPO, ?limit=
// (default 100, max 500), ?offset=. Newest first.
// -> {claims, total, limit, offset, next}. CLI: repo-claims.

import { createFileRoute } from '@tanstack/react-router';
import { REPO_CLAIM_STATUSES, isAdmin, json, oneOf, paged, pageParams, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { REPO_CLAIM_SELECT, expireStaleClaims, mapRepoClaim, type RepoClaimRow } from '@/lib/repos';

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  const sp = new URL(request.url).searchParams;
  const status = sp.get('status')?.trim() || null;
  if (status) oneOf(REPO_CLAIM_STATUSES, status, 'status');
  const repo = sp.get('repo')?.trim() || null;
  const page = pageParams(sp, 100, 500);
  await expireStaleClaims();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (!isAdmin(user)) {
    where.push('rc.user_id = ?');
    vals.push(user.id);
  }
  if (status) {
    where.push('rc.status = ?');
    vals.push(status);
  }
  if (repo) {
    where.push('rc.repo = ? COLLATE NOCASE');
    vals.push(repo);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows, page: info } = await paged<RepoClaimRow>(
    `${REPO_CLAIM_SELECT} ${w} ORDER BY rc.id DESC`,
    `SELECT COUNT(*) AS n FROM repo_claims rc ${w}`,
    vals,
    page,
  );
  return json({ claims: rows.map((r) => mapRepoClaim(r, user)), ...info });
}

export const Route = createFileRoute('/api/repos/claims')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
