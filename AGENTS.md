# iOSOnAnd — Agent Brief

> Read this before touching the repo. PLAN.md is the plan of record.

## Repo layout

| Path | What |
|---|---|
| `PLAN.md` | Build plan (read first) |
| `README.md` | Human + agent operator manual |
| `SKILL.md` | Drop-in skill for fork agents |
| `cli.mjs` | Zero-dep agent CLI (node builtins only) |
| `wrangler.jsonc` | Workers app + D1 binding |
| `migrations/` | D1 schema migrations (`0001_init.sql` first) |
| `seed/seed.json` | Committed seed (24 areas, devices, forks) |
| `src/routes/` | Pages + `api.*` routes |
| `src/lib/` | `db.ts auth.ts github.ts reddit.ts changelog.ts` |
| `src/components/ui/` | shadcn (preset `b6tOz2I0x`) |
| `.dev.vars.example` | Empty placeholder keys (never real values) |

## Allowed / forbidden

- NEVER commit secrets: no tokens, passwords, emails, `.dev.vars`, token files.
- Respect `.gitignore`. Do not invent new secret-carrying files.
- Never touch `/home/akshay/Documents/GitHub/OneiOS` (separate checkout).
- Never run `bun install` / `bun add` (owner manages deps).
- Agents do not `git commit` / `git push` (owner commits).

## Exact commands

```sh
bun install && bun run dev          # local run (Workers runtime + local D1)
node --check cli.mjs                # only CLI verification agents may run
node ./cli.mjs check                # DB reachable, seed loads, routes respond
node ./cli.mjs areas                # canonical area slugs
node ./cli.mjs status-get --device <slug>
node ./cli.mjs status-set <d> <a> <state> --detail "..." --source "..."
```

## State vocabulary

`works | broken | in-progress | unknown` — the only status words.
Fork verification: `fork-claim | reproduced | merged`.

## Honesty rules

- Fork claims stay `fork-claim` until reproduced on hardware.
- `merged` only for code actually in `main`.
- Every write cites evidence: `--detail` + `--source`.
- `unknown` where nothing is proven. Silence is not success.

## Check-before-write

1. `status-get` the device first.
2. `areas` for the exact slug.
3. Write, then read back what you wrote.

## UI copy rules (distilled)

- No eyebrow labels, no subtitle reflex, no botsplaining.
- No decorative badges, dots, or emojis.
- Headings carry the point, 5 words max.
