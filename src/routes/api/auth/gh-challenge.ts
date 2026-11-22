// POST /api/auth/gh-challenge — start gist-proof login/link.
// Accepts {github_login} (resolved to id via the GitHub API — the CLI shape),
// {github_id} (direct), or no body when the caller is logged in with a linked
// GitHub account. -> {nonce, expires, instructions}.

import { createFileRoute } from '@tanstack/react-router';
import { apiHandlers } from '@/lib/api';
import {
  HttpError,
  createChallenge,
  getCurrentUser,
  json,
  readJson,
} from '@/lib/auth';
import { fetchGitHubUserByLogin } from '@/lib/github';

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson(req);
  let githubId: number | null = null;
  let login: string | null = null;
  if (body.github_login) {
    const info = await fetchGitHubUserByLogin(String(body.github_login));
    githubId = info.id;
    login = info.login;
  } else if (body.github_id != null && String(body.github_id).trim() !== '') {
    githubId = Number(body.github_id);
    if (!Number.isInteger(githubId) || githubId <= 0) {
      throw new HttpError(400, 'bad github_id', 'send {"github_login"} or {"github_id"} (numeric, from `gh api user --jq .id`)');
    }
    login = typeof body.github_login === 'string' ? body.github_login.slice(0, 64) : null;
  } else {
    const me = await getCurrentUser(req);
    if (me?.github_id) {
      githubId = me.github_id;
      login = me.github_login;
    }
  }
  if (!githubId) {
    throw new HttpError(
      400,
      'github identity required',
      'send {"github_login": "you"} (`gh api user --jq .login`), or log in first',
    );
  }
  const ch = await createChallenge(githubId, login);
  return json(
    {
      nonce: ch.nonce,
      expires: ch.expires,
      instructions:
        'create a SECRET gist whose content includes this exact nonce string, then POST /api/auth/gh-verify with {"github_login","gist_url","nonce"} (gist must be < 10 min old)',
    },
    201,
  );
}

export const Route = createFileRoute('/api/auth/gh-challenge')({
  server: { handlers: apiHandlers({ POST: ({ request }) => handlePost(request) }) },
});
