# iOSOnAnd

A status tracker for running iOS on Android phones (OneiOS and every other
port it knows of). It lists devices, the state of 24 checklist areas per
device, the repos that support each phone and what they are based on, proof
uploads (on R2), posts and a changelog of every write. Most writes come from AI
coding agents through `cli.mjs`. Built with TanStack Start and shadcn on
Cloudflare Workers with a D1 (SQLite) database.

The documentation is part of the app: run it and open `/docs`. The API
reference, with requests you can send, is at `/api-reference`. The pages'
sources are in [`content/docs/`](content/docs).

| Page | Source | What |
|---|---|---|
| `/docs` | [index.mdx](content/docs/index.mdx) | how it works: the data, the trust model, the sources |
| `/docs/agents` | [agents.mdx](content/docs/agents.mdx) | the agent system: the prompt, the CLI, auth, rules, errors, a real session |
| `/docs/maintain-a-repo` | [maintain-a-repo.mdx](content/docs/maintain-a-repo.mdx) | claiming a repo (owner check, proof file) and what maintainers can do |
| `/docs/api-keys` | [api-keys.mdx](content/docs/api-keys.mdx) | scoped, expiring keys; rotate, revoke |
| `/docs/api` | [api.mdx](content/docs/api.mdx) | auth, conventions, errors, pagination, every resource with curl |
| `/docs/permissions` | [permissions.mdx](content/docs/permissions.mdx) | trust levels, claims, scopes, 401/403/409 |
| `/docs/data-model` | [data-model.mdx](content/docs/data-model.mdx) | tables, areas and their scope, repos, support rows, lineage, media, data sources |
| `/docs/uploads` | [uploads.mdx](content/docs/uploads.mdx) | images and clips on R2: types, limits, Range |
| `/docs/getting-started` | [getting-started.mdx](content/docs/getting-started.mdx) | local run, scripts, tests, deploy |
| `/docs/reddit` | [reddit.mdx](content/docs/reddit.mdx) | Reddit posts and claims |
| `/api-reference` | [src/lib/openapi.ts](src/lib/openapi.ts) | every endpoint (OpenAPI 3.1 at `/api/openapi.json`) |

[PLAN.md](PLAN.md) is the build plan. [AGENTS.md](AGENTS.md) is the brief for
agents working on this repo. [SKILL.md](SKILL.md) is the drop-in skill for
agents that update the tracker from a fork (`/docs/agents` explains it).

## Local run

Needs [bun](https://bun.sh) and Node 20 or newer.

```sh
bun install && bun run dev
```

`bun run dev` runs `scripts/setup-local.mjs`, then Vite. The setup step is
safe to run on every start:

1. Creates `.dev.vars` from `.dev.vars.example` if it is missing, with
   `ADMIN_EMAIL=admin@iosonand.local` and a random `ADMIN_PASSWORD`. It prints
   the password once. The file is git-ignored.
2. Applies the D1 migrations to the local database
   (`wrangler d1 migrations apply oneios-tracker --local`).
3. Loads `seed/seed.json` when the local database has no devices. It never
   seeds over existing rows. `node scripts/seed-export.mjs` writes the local
   DB's seeded tables back into `seed/seed.json`.

Uploads use the emulated R2 under `.wrangler/state`, so they need no setup.

The app and API listen on port 3000 on every address, IPv4 and IPv6, so
`http://localhost:3000` and `http://127.0.0.1:3000` both work. Set `PORT` to
use another port: `PORT=3103 bun run dev`. The port is strict: if it is taken,
Vite exits instead of picking another one.

Log in at `/login` with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` from
`.dev.vars`, or from the CLI with `node cli.mjs login --admin`.

Tests run against a running tracker: `bun test tests/api` (`TRACKER_URL`
defaults to `http://127.0.0.1:3001`; `unit.test.ts` and `docs.test.ts` need
no tracker). The other scripts, the tests and the
deploy steps (untested: no Cloudflare account has been used yet) are on
`/docs/getting-started`.

## Use the CLI

`cli.mjs` uses only Node builtins (Node 18 or newer); a tracker serves it at
`GET /cli.mjs`. It talks to the tracker at, in order: `--url URL`, the
`TRACKER_URL` environment variable, or `http://localhost:3000`. The token is
`--token`, then `TRACKER_TOKEN`, then the one saved at login.

```sh
node cli.mjs check                 # API reachable, 24 areas, devices, login state
node cli.mjs login --admin         # local dev: log in as the admin from .dev.vars
node cli.mjs whoami
node cli.mjs status-set s24-ultra wifi in-progress --detail "joins, no IP yet" --source "docs/hardware.md"
node cli.mjs repo-claim OWNER/REPO --device s25   # owner: approved at once; else a proof file
node cli.mjs keys-create --name ci --scopes status:write --expires-days 90
node cli.mjs media-upload shot.png --device s25 --area touch --caption "..."
```

`node cli.mjs --help` lists every command. Login variants, claims, forks,
posts, the offline queue, exit codes and the honesty rules are on
`/docs/agents`. Who may write what is on `/docs/permissions`.

## API

Writes need `Authorization: Bearer <token>` (a login token or a scoped API
key) or a session cookie. Errors are `{error, hint}`. Lists take `?limit=` and
`?offset=` and return `total` and `next`. Every write adds a changelog row.
`/docs/api` explains the conventions.

- `/api-reference`: the interactive reference (Scalar).
- `GET /api/openapi.json`: the OpenAPI 3.1 document, from
  [src/lib/openapi.ts](src/lib/openapi.ts).
- `GET /api/docs`: the endpoint list with the auth level of each, derived
  from the same file.

`tests/api/openapi.test.ts` fails when a route under `src/routes/api/` or one
of its methods is missing from `src/lib/openapi.ts`.

```sh
BASE=http://localhost:3000
curl "$BASE/api/status?device=s24-ultra"
curl -X PUT "$BASE/api/status/s24-ultra/wifi" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"state":"in-progress","detail":"associates, no IP yet","source":"docs/hardware.md"}'
```

## Not built yet

- Cloudflare deploy (steps on `/docs/getting-started`, not run yet; it also
  needs `wrangler r2 bucket create iosonand-media`).
- Password reset by email. An admin can create accounts with `user-add`;
  there is no reset flow.
- Reddit embeds. Posts are links. `reddit-fetch` (admin) pulls r/hackios
  candidates on request; there is no scheduled (cron) fetch.
- Skill distribution to forks. Copy `SKILL.md` and `cli.mjs` by hand.
