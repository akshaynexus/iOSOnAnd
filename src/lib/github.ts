// src/lib/github.ts — GitHub helpers for the gist-proof login/link flow.
//
// Flow: server issues a single-use nonce (login_challenges) -> user creates a
// SECRET gist containing the nonce -> server fetches the gist and checks:
//   1. gist owner id == claimed github_id   (proves account control)
//   2. a gist file contains the unused nonce (proves freshness / binds challenge)
//   3. gist created within 10 min           (narrows replay window)
// Plus a token-check helper (GET /user with a provided token -> {id, login}).

import { HttpError, env } from '@/lib/auth';

export interface GistProof {
  gistId: string;
  ownerId: number;
  ownerLogin: string;
  createdAt: string;
  matchedFile: string;
}

/** Accept a raw gist id or any gist URL form; null when unparseable. */
export function parseGistId(input: string): string | null {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[0-9a-f]+$/i.test(s) && s.length >= 8) return s.toLowerCase();
  const m = /(?:gist\.github\.com\/(?:[A-Za-z0-9-]+\/)?|api\.github\.com\/gists\/)([0-9a-f]+)/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'iOSOnAnd-tracker/1.0',
  };
  const tok = env('GITHUB_TOKEN'); // optional: raises rate limits
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

/** Raw gist fetch with clear, mappable errors. Throws HttpError. */
export async function fetchGist(gistIdInput: string): Promise<any> {
  const id = parseGistId(gistIdInput);
  if (!id) {
    throw new HttpError(
      400,
      'bad gist id',
      'paste the secret gist URL or id, e.g. https://gist.github.com/you/<id>',
    );
  }
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/gists/${id}`, { headers: githubHeaders() });
  } catch (e) {
    throw new HttpError(502, 'github unreachable', `could not reach api.github.com (${errMsg(e)})`);
  }
  if (res.status === 404) {
    throw new HttpError(
      404,
      'gist not found',
      'check the gist URL; it must still exist (secret gists work, deleted ones do not)',
    );
  }
  if (res.status === 403) {
    throw new HttpError(
      503,
      'github rate limited',
      'set GITHUB_TOKEN on the server to raise limits, then wait a minute and retry',
    );
  }
  if (res.status === 401) {
    throw new HttpError(502, 'github auth misconfigured', 'the server GITHUB_TOKEN (if set) was rejected');
  }
  if (!res.ok) throw new HttpError(502, `github error ${res.status}`, 'retry in a bit');
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, 'github returned bad JSON', 'retry in a bit');
  }
}

/**
 * Verify a gist proves control of `githubId` and carries `nonce`.
 * Throws HttpError: 404 gist gone, 422 owner/content mismatch, 410 stale.
 */
export async function verifyGistProof(opts: {
  gistIdInput: string;
  githubId: number;
  nonce: string;
  maxAgeMinutes?: number;
}): Promise<GistProof> {
  const maxAge = opts.maxAgeMinutes ?? 10;
  const gist = await fetchGist(opts.gistIdInput);
  const owner = gist.owner;
  if (!owner || Number(owner.id) !== Number(opts.githubId)) {
    throw new HttpError(
      422,
      'gist owner mismatch',
      `gist belongs to github user ${owner?.id ?? 'unknown'}, expected ${opts.githubId}; create the gist while logged in as the right account, then retry`,
    );
  }
  const files = Object.values((gist.files || {}) as Record<string, any>);
  const hit = files.find((f) => typeof f?.content === 'string' && (f.content as string).includes(opts.nonce));
  if (!hit) {
    const truncated = files.some((f) => f?.truncated);
    throw new HttpError(
      422,
      'nonce not found in gist',
      truncated
        ? 'the gist file was truncated by the GitHub API; use a smaller gist containing only the nonce'
        : 'the gist must contain the exact nonce string from your challenge; re-copy it and retry',
    );
  }
  const createdAt = gist.created_at ? Date.parse(gist.created_at) : NaN;
  const ageMin = (Date.now() - createdAt) / 60000;
  if (!Number.isFinite(createdAt) || ageMin > maxAge || ageMin < -5) {
    throw new HttpError(
      410,
      'gist too old',
      `create a fresh secret gist (must be under ${maxAge} minutes old) and retry`,
    );
  }
  return {
    gistId: String(gist.id || ''),
    ownerId: Number(owner.id),
    ownerLogin: String(owner.login || ''),
    createdAt: String(gist.created_at || ''),
    matchedFile: String((hit as { filename?: string }).filename || ''),
  };
}

/** Validate a user-supplied GitHub token (`gh auth token` style). */
export async function fetchGitHubUser(ghToken: string): Promise<{ id: number; login: string }> {
  let res: Response;
  try {
    res = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'iOSOnAnd-tracker/1.0', Authorization: `Bearer ${ghToken}` },
    });
  } catch (e) {
    throw new HttpError(502, 'github unreachable', `could not reach api.github.com (${errMsg(e)})`);
  }
  if (res.status === 401) throw new HttpError(401, 'invalid github token', 'check `gh auth status`; re-login with gh and retry');
  if (res.status === 403) {
    throw new HttpError(
      503,
      'github rate limited',
      'set GITHUB_TOKEN on the server to raise limits, then wait a minute and retry',
    );
  }
  if (!res.ok) throw new HttpError(502, `github error ${res.status}`, 'retry in a bit');
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new HttpError(502, 'github returned bad JSON', 'retry in a bit');
  }
  if (typeof body?.id !== 'number' || typeof body?.login !== 'string') {
    throw new HttpError(502, 'unexpected github response', 'retry in a bit');
  }
  return { id: body.id, login: body.login };
}

/** Resolve a GitHub login to {id, login} via the public users API (no token needed). */
export async function fetchGitHubUserByLogin(login: string): Promise<{ id: number; login: string }> {
  const clean = String(login || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(clean)) {
    throw new HttpError(400, 'bad github_login', 'send your GitHub username, e.g. {"github_login":"octocat"}');
  }
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/users/${encodeURIComponent(clean)}`, {
      headers: githubHeaders(),
    });
  } catch (e) {
    throw new HttpError(502, 'github unreachable', `could not reach api.github.com (${errMsg(e)})`);
  }
  if (res.status === 404) {
    throw new HttpError(404, 'github user not found', `no GitHub user named @${clean}; check ` + '`gh api user --jq .login`');
  }
  if (res.status === 403) {
    throw new HttpError(
      503,
      'github rate limited',
      'set GITHUB_TOKEN on the server to raise limits, then wait a minute and retry',
    );
  }
  if (!res.ok) throw new HttpError(502, `github error ${res.status}`, 'retry in a bit');
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new HttpError(502, 'github returned bad JSON', 'retry in a bit');
  }
  if (typeof body?.id !== 'number') throw new HttpError(502, 'unexpected github response', 'retry in a bit');
  return { id: body.id, login: String(body.login || clean) };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
