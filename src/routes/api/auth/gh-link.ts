// /api/auth/gh-link — link (or unlink) a GitHub account to your logged-in user.
// POST {gist_id, nonce?}: prove control via a secret gist holding a fresh nonce
//   (get one from POST /api/auth/gh-challenge first). 409 when that github_id
//   is already linked to another user — unlink it there first.
// DELETE: unlink your own GitHub account.

import { createFileRoute } from '@tanstack/react-router';
import { exec } from '@/lib/db';
import {
  HttpError,
  actorName,
  findUserByGithubId,
  getChallenge,
  handleError,
  isExpired,
  json,
  latestChallengeFor,
  markChallengeUsed,
  nowIso,
  readJson,
  requireUser,
  toSelfUser,
} from '@/lib/auth';
import { fetchGist, verifyGistProof } from '@/lib/github';
import { appendChangelog } from '@/lib/changelog';

async function handlePost(req: Request): Promise<Response> {
  const user = await requireUser(req);
  const body = await readJson(req);
  const gistId = String(body.gist_id || body.gist_url || '').trim();
  if (!gistId) {
    throw new HttpError(
      400,
      'gist_id required',
      'POST /api/auth/gh-challenge with your github_id, put the nonce in a secret gist, then send its URL here',
    );
  }
  const gist = await fetchGist(gistId);
  const ownerId = Number(gist?.owner?.id);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new HttpError(422, 'gist has no owner', 'use a gist owned by your GitHub account, not an anonymous one');
  }
  if (user.github_id === ownerId) return json({ user: toSelfUser(user), already: true });

  const nonce = body.nonce ? String(body.nonce) : null;
  const ch = nonce ? await getChallenge(nonce) : await latestChallengeFor(ownerId);
  if (!ch || ch.used || isExpired(ch.expires) || Number(ch.github_id) !== ownerId) {
    throw new HttpError(
      410,
      'challenge expired or unknown',
      'POST /api/auth/gh-challenge with {"github_id": <your id>} first, then retry',
    );
  }
  const proof = await verifyGistProof({ gistIdInput: gistId, githubId: ownerId, nonce: ch.nonce });

  const taken = await findUserByGithubId(ownerId);
  if (taken && taken.id !== user.id) {
    throw new HttpError(
      409,
      'github already linked',
      `that github account (@${proof.ownerLogin || ownerId}) is linked to another user; unlink it there first`,
    );
  }
  await exec('UPDATE users SET github_id = ?, github_login = ?, github_linked_at = ? WHERE id = ?', [
    ownerId,
    proof.ownerLogin || null,
    nowIso(),
    user.id,
  ]);
  await markChallengeUsed(ch.nonce, proof.gistId);
  const updated = { ...user, github_id: ownerId, github_login: proof.ownerLogin || null };
  await appendChangelog(actorName(updated), `linked github @${proof.ownerLogin || ownerId}`);
  return json({ user: toSelfUser(updated) });
}

async function handleDelete(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (!user.github_id) throw new HttpError(404, 'no github linked', 'nothing to unlink');
  await exec('UPDATE users SET github_id = NULL, github_login = NULL, github_linked_at = NULL WHERE id = ?', [user.id]);
  const updated = { ...user, github_id: null, github_login: null };
  await appendChangelog(actorName(user), 'unlinked github account');
  return json({ user: toSelfUser(updated) });
}

export const Route = createFileRoute('/api/auth/gh-link')({
  server: {
    handlers: {
  POST: async ({ request }: { request: Request }) => {
    try {
      return await handlePost(request);
    } catch (e) {
      return handleError(e);
    }
  },
  DELETE: async ({ request }: { request: Request }) => {
    try {
      return await handleDelete(request);
    } catch (e) {
      return handleError(e);
    }
  },
    },
  },
});
