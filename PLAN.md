# iOSOnAnd — Build Plan (v7 scaffold)

> Read-first plan. Nothing gets built until approved.
>
> - v2–v5: email+password, rich API, gh gist-proof agent login, account
>   linking w/ dup-check, 24-area checklist, device search + fork discovery.
>   All kept.
> - v6 (this): **stack switch — TanStack Start + shadcn (preset `b6tOz2I0x`)
>   on Cloudflare Workers + D1 (SQLite)** (owner request). Product requirements
>   unchanged; only how it's built/hosted changes.
> - v7: **repo = `akshaynexus/iOSOnAnd`** (public, `main`), **bun** for
>   everything (1.4.5 latest, `~/.bun/bin`), UI built under the
>   **unslop-ui** skill (`~/.agents/skills/unslop-ui`, installed via
>   `npx skills`). Build runs in waves: scaffold first, then parallel
>   backend / UI / CLI-docs agents on disjoint file scopes, no commits by
>   agents (owner commits).

## 0. Goal

A tiny community/status site for running iOS on Android hardware (OneiOS,
UniXNU/XNU work, iOSPlus10, per-device forks). One singular place tying
**code status → device forks → public updates**. Lives in
`/home/akshay/Documents/GitHub/iOSOnAnd/`, **never** inside the
OneiOS checkout. Hosted on Cloudflare Workers + D1 — free tier to start,
pennies after.

## 1. Stack (v6: TanStack Start + shadcn on Cloudflare)

- **Framework:** TanStack Start (React, file-based routes, SSR + server
  functions in one codebase) — scaffolded via
  `bunx create-cloudflare@latest -- iOSOnAnd --framework=tanstack-start`
  (officially supported path, verified 2026-11-21).
- **UI:** Tailwind + **shadcn, theme preset `b6tOz2I0x`** applied at scaffold.
  Needed components: input, button, card, badge, table, select, dialog,
  command (search), tabs, avatar, sonner/toast. If the preset ID doesn't
  resolve at build time: fall back to default shadcn theme and report it —
  never block on theming.
- **Hosting:** Cloudflare Workers (`@cloudflare/vite-plugin`,
  `wrangler.jsonc`, `bun run deploy` → `*.workers.dev` or custom domain).
- **DB:** Cloudflare **D1** (SQLite semantics, same `schema.sql` applied as a
  wrangler migration). Free tier: 5M rows read/day, 100k written/day, 5 GB
  storage — orders of magnitude above a tracker; paid Workers is $5/mo + D1
  overages in fractions of cents. No egress charges.
- **DB access:** raw D1 prepared statements (`env.DB.prepare(...).bind(...)`)
  behind one tiny `db.ts` helper — no ORM, boring on purpose. Respect D1
  limits: ≤100 bound params/query, batch reads, index `device_slug`/`slug`
  lookups (indexed reads = fewer billed rows).
- **Run locally in one command:** `bun install && bun run dev` (Vite dev in
  the Workers runtime, local D1 via Wrangler — same code path as prod).
- **Workers constraints (design rules):** no filesystem writes (DB only via
  D1 binding); keep the server bundle small (128 MB isolate, 1 s startup —
  no heavy imports at module top level); Node APIs only via `nodejs_compat`;
  **password hashing with WebCrypto PBKDF2** (scrypt unavailable on Workers —
  v5's scrypt choice is superseded).

## 2. Database schema (D1 migration from `schema.sql` → v6)

SQLite semantics carry over to D1 unchanged. Tables: `devices`, `areas` (24
checklist areas, §9), `device_status`, `forks`, `reddit_posts`, `users`
(email unique nullable, password_hash PBKDF2 nullable, github_id unique
nullable, github_login), `api_tokens`, `login_challenges` (single-use nonces),
`sessions` (v6: cookie session tokens server-side, since stateless JWT adds a
dependency — tiny table, same shape as api_tokens), `claims`, `changelog`.
Migrations live in `migrations/0001_init.sql`; seed in `seed/seed.json`
applied by a script (`bun run seed:local`, `bun run seed:remote`).

## 3. Auth (unchanged product, Workers-native mechanics)

**Humans:** email + password (PBKDF2-SHA256 via SubtleCrypto, per-user salt),
cookie session backed by `sessions` table. Bootstrap admin via
`ADMIN_EMAIL`/`ADMIN_PASSWORD` env (wrangler secret / `.dev.vars` locally).
Profile page: link-status prominent, **Link GitHub** = paste-a-secret-gist-URL
flow with nonce; **409 if the github_id is already linked elsewhere**; unlink
first to change. Linked `@login` shown on profile, claims, maintained forks.

**Agents:** `cli` (small zero-dep Node script using `fetch`, pointed at
`TRACKER_URL`) does gist-proof login: `gh api user` → `gh-challenge` →
`gh gist create --secret` → `gh-verify` → tracker token stored locally, gist
deleted. First login auto-creates the user bound to `github_id`. Fallbacks:
`--token` check (warned), maintainer `token-issue`.

## 4. Rich API (same surface, TanStack server functions + API routes)

Same v5 endpoint list (`/api/docs` live list; filters `?q= ?device= ?area=
?state=`; 409 on dup link; `{error, hint}` errors; changelog on every write).
Implemented as TanStack Start server functions/API routes hitting the D1
binding — not a separate Express server. The `cli` talks to these over HTTPS,
identically against local dev and production.

## 5. Agent-friendly update flow (unchanged)

```sh
bun install
node ./cli.mjs login            # one-time: gh-based, ~10s
node ./cli.mjs status-set s24-ultra wifi in-progress --detail "…" --source "docs/hardware.md"
node ./cli.mjs fork-sync --repo YMGPwcca/OneiOS --device s26-ultra --best-result "…"
node ./cli.mjs post-add --title "…" --url "https://www.reddit.com/r/hackios/…"
```

`cli.mjs areas` lists valid area slugs. Honesty rules unchanged.

## 6. SKILL.md

Drop-in skill for any fork's agents: tracker URL default (workers.dev URL or
custom domain once set), `login` one-timer, update commands, area checklist,
check-before-write, offline `TRACKER_QUEUE.md` fallback. Auto-distribution:
stubbed.

## 7. Reddit integration (r/hackios)

Same as v5: updates list + `reddit-fetch hackios` (server-side scheduled? no —
CLI-triggered; a Cloudflare Cron Trigger calling it is a natural v2, stubbed).
Candidates need confirming. Seed empty unless real URLs provided.

## 8. Dashboard v1 (shadcn components)

- **Search-first header** (`command` palette style): one box over
  name/model/SoC/repo text → device cards.
- **Device cards** (`card` + `badge` states): headline status, 24-area
  checklist with colours, fork repos with copyable `git clone` + fork links,
  maintainer/claim status, related posts.
- **Matrix view** (`table`): areas × devices, compare-everything.
- **Inline editing for editors:** per-area `select` + detail `input` on the
  card; one small `dialog` form to add a fork. Reads stay public, writes need
  login.
- Forks table, Reddit updates, **changelog feed**, auth pages, profile.
- SSR by default (SEO for device/fork discovery); static prerender for the
  landing page if trivial, else stubbed.

## 9. Seed data (unchanged from v5)

24 areas; S24U states from README (works/in-progress/broken/never-goals,
`unknown` where README is silent); devices + forks from `docs/forks.md`
(`fork-claim` except ported = `merged`); dated 2026-11-21. Committed
`seed/seed.json`.

## 10. File layout (v6)

```
iOSOnAnd/
  PLAN.md  README.md  AGENTS.md  SKILL.md
  wrangler.jsonc         ← workers app + d1 binding (DB)
  vite.config.ts         ← tanstackStart + cloudflare plugin + tailwind
  migrations/0001_init.sql  ← schema.sql content, D1-compatible
  seed/seed.json         ← committed seed
  cli.mjs                ← zero-dep agent CLI (login/link/writes/fetch/check)
  src/routes/            ← index (dashboard), device.$slug, login, signup,
                           profile, api.* (docs, devices, status, forks, posts,
                           claims, changelog, search, auth/*)
  src/components/ui/     ← shadcn (preset b6tOz2I0x)
  src/lib/db.ts auth.ts github.ts reddit.ts changelog.ts
  public/  .dev.vars.example  .gitignore
```

## 11. Explicitly stubbed / dropped in v1

- Dropped long ago: GitHub OAuth, SSH-signature login. D1/Workers make nothing
  else change product-wise.
- Password-reset email (CLI/admin reset). Reddit embeds; candidates confirmed
  manually (cron auto-fetch = v2). Device photos/attribution. Skill
  auto-distribution. Prerender beyond landing (if fiddly).
- Tests beyond `cli.mjs check` (DB reachable, seed loads, gist-proof round-trip
  on a throwaway GitHub account at build time against local dev).

## 12. Build order (after approval)

1. Scaffold (`create cloudflare --framework=tanstack-start`), shadcn +
   preset `b6tOz2I0x` (report if it doesn't resolve), `wrangler.jsonc` + D1
   create + migration + `seed/seed.json` transcription.
2. `db.ts` + email/password auth + sessions/api-tokens → `cli.mjs check`.
3. Gist-proof login + gh-link w/ dup-check.
4. Read routes + dashboard (search, cards, matrix, forks, posts, feed,
   login, profile).
5. Write APIs + inline forms + `fork-sync`/`reddit-fetch`.
6. `SKILL.md` + `README.md` + `AGENTS.md`; clean-room run (fresh clone →
   `bun install && bun run dev`, live gist-proof, dup-link 409, search, edit);
   first `wrangler deploy` to `*.workers.dev`; report.

**Waiting on you:** reply "approved" (or edit sections). Needed at build time:
Cloudflare account access (`wrangler login` — yours or a token), D1 database
name (default `oneios-tracker`), tracker URL (default `oneios-tracker.<you>.
workers.dev` until a custom domain), bootstrap `ADMIN_EMAIL`. The shadcn
preset ID is taken on trust — build step 1 confirms it resolves.
