# iOSOnAnd

Community status tracker for running iOS on Android hardware: code status →
device forks → public updates, in one place. TanStack Start + shadcn on
Cloudflare Workers + D1. See [PLAN.md](PLAN.md) for the build plan,
[AGENTS.md](AGENTS.md) for the agent brief, [SKILL.md](SKILL.md) for the
fork-agent skill.

## Local run (one command)

```sh
bun install && bun run dev
```

Serves the app + API at `http://localhost:3000` on local D1 (same code path
as production). Tracker URL for the CLI defaults to that:

```sh
node ./cli.mjs check
```

## Cloudflare deploy

```sh
wrangler login
wrangler d1 create oneios-tracker
# put the returned database_id into wrangler.jsonc
bun run seed:local        # verify seed against local D1
wrangler d1 migrate apply oneios-tracker --remote
bun run seed:remote
bun run deploy            # -> https://<name>.<you>.workers.dev
```

Secrets (never in git; see [.dev.vars.example](.dev.vars.example)):

```sh
cp .dev.vars.example .dev.vars   # fill in .dev.vars locally (git-ignored)
wrangler secret put ADMIN_EMAIL
wrangler secret put ADMIN_PASSWORD
wrangler secret put GITHUB_TOKEN  # optional
```

## Auth flows

### Humans: email + password

Sign up / log in on `/signup` and `/login`. Bootstrap admin comes from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. Cookie session, server-side table.

Link GitHub on `/profile` with **Link GitHub** (paste-a-secret-gist-URL flow
with nonce). A `github_id` already linked elsewhere returns **409** — unlink
first to change. Linked `@login` shows on profile, claims, maintained forks.

### Agents: gh gist-proof login (one time, ~10s)

```sh
export TRACKER_URL=https://<name>.<you>.workers.dev
node ./cli.mjs login
```

1. `gh api user` → login. 2. `POST /api/auth/gh-challenge` → nonce.
3. `gh gist create --secret` with the nonce. 4. `POST /api/auth/gh-verify`
→ tracker token saved to `~/.config/iosonand/token` (mode 0600), gist
deleted. First login auto-creates the user bound to `github_id`.

Fallbacks: `node ./cli.mjs login --token` sends `gh auth token` output to
`/api/auth/token-check` (WARNED: shared secret, prefer gist-proof).
Maintainer `token-issue` for machines without `gh`.

### Linking an agent identity to a human account

```sh
node ./cli.mjs link --email you@example.com   # prompts password (hidden), then gist-proof
```

Binds the `gh` identity to the email/password account. Dup `github_id`
returns 409 with a hint.

## Agent update flow

```sh
node ./cli.mjs areas
node ./cli.mjs status-get --device s24-ultra
node ./cli.mjs status-set s24-ultra wifi in-progress --detail "..." --source "docs/hardware.md"
node ./cli.mjs fork-sync --repo OWNER/REPO --device s24-ultra --best-result "..."
node ./cli.mjs post-add --title "..." --url "https://www.reddit.com/r/hackios/..."
```

## Area checklist

24 areas (boot → sensors). Canonical slugs live in `seed/seed.json` and on
the server — never guess:

```sh
node ./cli.mjs areas
```

## Honesty rules

- Fork claims stay `fork-claim` until reproduced; `merged` only in `main`.
- `unknown` where nothing is proven. Every write cites `--detail` + `--source`.

## API

Base: `$TRACKER_URL`. Writes need `Authorization: Bearer <token>`.
Errors: `{error, hint}`. Every write appends to the changelog.
Filters: `?q= ?device= ?area= ?state=`. Live list at `GET /api/docs`.

| Method | Path | CLI | Notes |
|---|---|---|---|
| GET | `/api/docs` | `check` | route list |
| GET | `/api/areas` | `areas` | 24 checklist areas |
| GET | `/api/devices?q=&limit=` | `status-get` reads | search devices |
| POST | `/api/devices` | `device-add` | `{slug,name,model,soc,repo_kind,status,best_result,notes}` |
| GET | `/api/status?device=&area=&state=` | `status-get` | |
| PUT | `/api/status` | `status-set` | `{device,area,state,detail,source}` |
| GET | `/api/forks?device=` | `fork-list` | |
| POST | `/api/forks` | `fork-add` | `{repo,device_slug,branch,url,best_result,ported,fork_only,notes}` |
| POST | `/api/forks/sync` | `fork-sync` | upsert `best_result` by repo |
| GET | `/api/posts?limit=` | `post-list` | |
| POST | `/api/posts` | `post-add` | `{title,url,published,note}` |
| POST | `/api/reddit/fetch` | `reddit-fetch` | `{subreddit}` default `hackios` |
| GET | `/api/claims?status=` | `claim-list` | |
| POST | `/api/claims` | `claim-add` | `{device_slug,note}` |
| POST | `/api/claims/:id/approve` | `claim-approve` | approver only |
| POST | `/api/users` | `user-add` | admin token; `{email,password,is_admin}` |
| GET | `/api/changelog?limit=` | — | write feed |
| GET | `/api/search?q=` | — | devices + forks |
| POST | `/api/auth/gh-challenge` | `login` | `{github_login}` → `{nonce}` |
| POST | `/api/auth/gh-verify` | `login` | `{github_login,gist_url,nonce}` → `{token}` |
| POST | `/api/auth/token-check` | `login --token`, `tokens` | `{token}` → validity |
| POST | `/api/auth/link` | `link` | `{email,password,github_login,gist_url,nonce}` |

### curl examples

```sh
BASE=http://localhost:3000
curl $BASE/api/areas
curl "$BASE/api/status?device=s24-ultra"
curl -X POST $BASE/api/auth/gh-challenge \
  -H 'content-type: application/json' -d '{"github_login":"octocat"}'
TOKEN=YOUR_TRACKER_TOKEN   # from `node ./cli.mjs login` (~/.config/iosonand/token)
curl -X PUT $BASE/api/status -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"device":"s24-ultra","area":"wifi","state":"in-progress","detail":"associates, no IP yet","source":"docs/hardware.md"}'
curl -X POST $BASE/api/forks/sync -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"repo":"OWNER/REPO","device_slug":"s24-ultra","best_result":"boots to recovery"}'
curl "$BASE/api/changelog?limit=20"
```

## CLI reference

`export TRACKER_URL=...` (default `http://localhost:3000`);
`TRACKER_TOKEN` env overrides `~/.config/iosonand/token`. All commands print
JSON and exit non-zero on error. `login`, `link`, `user-add` prompt with
hidden input where a password is needed.

`logout` · `tokens` · `areas` · `status-get/set` · `device-add` ·
`fork-add/sync/list` · `post-add/list` · `reddit-fetch [hackios]` ·
`claim-add/list/approve` · `user-add` · `check`. Full flags:
`node ./cli.mjs --help`.
