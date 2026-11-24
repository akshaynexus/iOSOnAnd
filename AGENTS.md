# iOSOnAnd agent brief

Read this before you change the repo. PLAN.md is the plan of record;
README.md describes what exists now.

## Repo layout

| Path | What |
|---|---|
| `PLAN.md` | build plan |
| `README.md` | how to run, use and deploy it |
| `SKILL.md` | skill for fork agents that update the tracker |
| `cli.mjs` | tracker CLI, Node builtins only |
| `scripts/setup-local.mjs` | local setup run by `bun run dev`: `.dev.vars`, migrations, seed |
| `scripts/seed-export.mjs` | writes the local DB's seeded tables back into `seed/seed.json` |
| `wrangler.jsonc` | Workers app, D1 binding `DB`, `migrations_dir`, R2 binding `MEDIA` (uploads) |
| `migrations/` | D1 migrations `NNNN_name.sql`, applied in order |
| `seed/seed.json`, `seed/apply.mjs` | seed data and its loader |
| `tests/api/` | API tests, `bun run test` (`unit.test.ts`, `docs.test.ts` need no server) |
| `src/routes/` | pages, and `api/` routes |
| `src/lib/` | DB, auth (`scopes.ts`: key scopes; `password.ts`: change and reset; `ratelimit.ts`, `ratebuckets.ts`: rate limits; `mail.ts`: Email Service), repos and repo claims, forks, media (R2, `multipart.ts`, `sniff.ts`), GitHub, Reddit and changelog helpers |
| `src/components/` | UI, `ui/` is shadcn |
| `content/docs/*.mdx` | the public `/docs` pages (Fumadocs, compiled at build by `fumadocs-mdx`; order in `meta.json`) |
| `docs-internal/` | setup, deploy, admin and sync runbooks; not published |
| `src/lib/openapi.ts` | the API description: `/api/openapi.json`, `/api/docs` and `/api-reference` come from it |
| `.dev.vars.example` | empty placeholder keys, never real values |

## Allowed and forbidden

- Never commit secrets: tokens, passwords, emails, `.dev.vars`, token files.
- Respect `.gitignore`. Do not add new files that hold secrets.
- Never touch `/home/akshay/Documents/GitHub/OneiOS` (a separate checkout).
- Never run `bun install` or `bun add` (the owner manages dependencies).
- Agents do not `git commit` or `git push` (the owner commits).
- A schema change is a new `migrations/NNNN_name.sql`. Do not edit a
  migration that has been applied.

## Docs and the API description

- A change to who may write, the data or the CLI flow updates the matching
  `content/docs/*.mdx` page in the same change. Setup, deploy, admin and sync
  details (secrets and their names, `.dev.vars`, wrangler commands, how admins
  are made, bucket names, `login --admin`) go in `docs-internal/`, never in the
  public `content/docs`.
- A new or changed handler under `src/routes/api/` updates `OPERATIONS` (and
  `TITLES`) in `src/lib/openapi.ts`. `tests/api/openapi.test.ts` fails when
  a route or method is missing there.
- `SKILL.md` stays the drop-in file for forks; `/docs/agents` explains it.

## Commands

```sh
bun run dev                          # setup (idempotent) + Vite on PORT (default 3000)
PORT=3103 bun run dev                # another port
bun run test                         # API tests
node cli.mjs check                   # API reachable, areas seeded, devices, login
node cli.mjs login --admin           # local dev only: admin from .dev.vars
node cli.mjs whoami                  # login, admin flag, maintains
node cli.mjs areas                   # area slugs
node cli.mjs status-get --device <slug>
node cli.mjs status-set <device> <area> <state> --detail "..." --source "..."
node cli.mjs repo-claim OWNER/REPO --device <slug>   # then repo-verify <id> if it prints a code
node cli.mjs keys-create --name N --scopes status:write   # TRACKER_TOKEN=ion_... to use it
node cli.mjs media-upload <file> --device <slug> --area <area>
node scripts/seed-export.mjs         # local DB -> seed/seed.json
```

Docs frontmatter: quote every `title` and `description` (an unquoted ": "
breaks YAML and every route answers 500); `tests/api/docs.test.ts` checks it.

The CLI uses `--url URL`, then `TRACKER_URL`, then `http://localhost:3000`.
If the dev server runs on another port, pass that URL.

## States

`works | broken | in-progress | unknown` are the only status words. The CLI
rejects others before it sends anything. Fork verification: `fork-claim |
reproduced | merged`.

## Honesty rules

- A fork's claim stays `fork-claim` until it is reproduced on hardware.
- `merged` only for code in OneiOS `main`.
- Every write cites evidence with `--detail` and `--source`.
- `unknown` where nothing is proven.

## Check before you write

1. `status-get --device <slug>` to read the current state.
2. `areas` for the exact slug. `status-set` also checks it against the server.
3. Write, then read back what you wrote.

## UI copy rules

- No eyebrow labels, no reflex subtitles, no explaining the obvious.
- No decorative badges, dots or emojis.
- Headings state the point in 5 words or fewer.
