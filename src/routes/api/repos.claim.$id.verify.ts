// POST /api/repos/claim/$id/verify (login: the claimant, or an admin).
// Reads .iosonand-verify from the repo's default branch (src/lib/repoproof.ts)
// and approves the claim when its trimmed content equals the nonce:
// 200 {claim, fork}. 422 when the file is missing or wrong, 410 when the
// claim expired (24 h), 409 when it is not pending, 502 when GitHub cannot be
// reached. CLI: repo-verify <id>.

import { createFileRoute } from '@tanstack/react-router';
import { HttpError, isAdmin, json, requireUser } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { forkView } from '@/lib/forks';
import { approveRepoClaim, expireStaleClaims, githubApiHeaders, loadRepoClaim, mapRepoClaim } from '@/lib/repos';
import { PROOF_PATH, checkProofFile } from '@/lib/repoproof';

async function handlePost({ request, params }: ApiCtx): Promise<Response> {
  const user = await requireUser(request);
  await expireStaleClaims();
  const claim = await loadRepoClaim(params.id);
  if (claim.user_id !== user.id && !isAdmin(user)) {
    throw new HttpError(403, 'not your claim', 'only the claimant (or an admin) verifies a claim');
  }
  if (claim.status === 'expired') {
    throw new HttpError(410, 'claim expired', `claims last 24 h: POST /api/repos/claim {"repo":"${claim.repo}"} for a new code`);
  }
  if (claim.status !== 'pending') throw new HttpError(409, `claim already ${claim.status}`, 'only a pending claim is verified');
  let proof;
  try {
    proof = await checkProofFile(claim.repo, claim.nonce, { apiHeaders: githubApiHeaders() });
  } catch (e) {
    throw new HttpError(502, 'github unreachable', `could not read ${PROOF_PATH} (${e instanceof Error ? e.message : String(e)}); retry`);
  }
  if (!proof.ok) {
    throw new HttpError(
      422,
      'verification file not found or wrong',
      proof.found !== null
        ? `${PROOF_PATH} on the default branch of ${claim.repo} holds "${proof.found}", not this claim's code; write the code alone, push, retry (raw.githubusercontent.com may cache up to 5 min)`
        : `no ${PROOF_PATH} on the default branch of ${claim.repo}: write the claim's code alone to it, push, then retry`,
    );
  }
  const done = await approveRepoClaim(claim, user, 'proof-file');
  return json({ claim: mapRepoClaim(done.claim, user), fork: await forkView(done.fork) });
}

export const Route = createFileRoute('/api/repos/claim/$id/verify')({
  server: { handlers: apiHandlers({ POST: handlePost }) },
});
