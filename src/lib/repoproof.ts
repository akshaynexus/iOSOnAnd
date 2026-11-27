// src/lib/repoproof.ts — the proof-file check of a repo claim.
//
// The claimant writes the claim's nonce, alone, to `.iosonand-verify` on the
// repo's default branch. The server reads
//   https://raw.githubusercontent.com/OWNER/REPO/HEAD/.iosonand-verify
// and, when that is missing or different (raw.githubusercontent.com caches
// for up to 5 minutes, so a file pushed a moment ago can still read as the
// old answer), the GitHub contents API for the same path (not cached that
// way; 60 requests an hour without GITHUB_TOKEN). The same file on a branch
// named `iosonand-verify` counts too (checked after the default branch), so a
// claimant can prove write access without committing to their main branch:
// push a throwaway branch holding only the file, verify, delete the branch.
// The claim is proven when the trimmed content equals the nonce. At most 4 KB
// of any answer is read.
//
// Dependency-free: tests/api/repo-proof.test.ts runs it under bun with a
// stubbed fetch.

export const PROOF_PATH = '.iosonand-verify';
/** A throwaway branch that may hold the proof file instead of the default branch. */
export const PROOF_BRANCH = 'iosonand-verify';
const MAX_BYTES = 4096;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ProofResult {
  ok: boolean;
  /** Where the matching (or last) answer came from. */
  checked: string[];
  /** What the file held (trimmed, cut to 100 characters) when it was found but wrong. */
  found: string | null;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const all = new Uint8Array(Math.min(n, MAX_BYTES));
  let o = 0;
  for (const c of chunks) {
    const piece = c.subarray(0, all.length - o);
    all.set(piece, o);
    o += piece.length;
    if (o >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

/**
 * Check the proof file of `repo` (OWNER/REPO) against `nonce`. Throws only
 * when GitHub cannot be reached at all (the caller answers 502).
 */
export async function checkProofFile(
  repo: string,
  nonce: string,
  opts: { fetch?: FetchLike; apiHeaders?: Record<string, string> } = {},
): Promise<ProofResult> {
  const f: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const [owner, name] = repo.split('/');
  const path = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const tries: Array<[string, RequestInit]> = [
    [`https://raw.githubusercontent.com/${path}/HEAD/${PROOF_PATH}`, { headers: { 'cache-control': 'no-cache', 'user-agent': 'iOSOnAnd-tracker/1.0' } }],
    [
      `https://api.github.com/repos/${path}/contents/${PROOF_PATH}`,
      { headers: { accept: 'application/vnd.github.raw', 'user-agent': 'iOSOnAnd-tracker/1.0', ...(opts.apiHeaders ?? {}) } },
    ],
    [`https://raw.githubusercontent.com/${path}/${PROOF_BRANCH}/${PROOF_PATH}`, { headers: { 'cache-control': 'no-cache', 'user-agent': 'iOSOnAnd-tracker/1.0' } }],
    [
      `https://api.github.com/repos/${path}/contents/${PROOF_PATH}?ref=${PROOF_BRANCH}`,
      { headers: { accept: 'application/vnd.github.raw', 'user-agent': 'iOSOnAnd-tracker/1.0', ...(opts.apiHeaders ?? {}) } },
    ],
  ];
  const checked: string[] = [];
  let found: string | null = null;
  let reached = false;
  let lastError: unknown = null;
  for (const [url, init] of tries) {
    checked.push(url);
    let res: Response;
    try {
      res = await f(url, { ...init, redirect: 'follow' });
    } catch (e) {
      lastError = e;
      continue;
    }
    reached = true;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      continue;
    }
    const text = (await readCapped(res)).trim();
    if (text === nonce) return { ok: true, checked, found: null };
    found = text.slice(0, 100);
  }
  if (!reached) throw lastError ?? new Error('github unreachable');
  return { ok: false, checked, found };
}
