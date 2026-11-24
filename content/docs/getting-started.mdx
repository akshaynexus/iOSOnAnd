---
title: "Getting started"
description: "Run the tracker locally, run its tests, and deploy it to Cloudflare."
---

The tracker is a TanStack Start app on Cloudflare Workers with a D1 (SQLite) database. Locally,
Vite runs it in the Workers runtime with a local D1, the same code path as production.

## Run it locally

Needs [bun](https://bun.sh) and Node 20 or newer.

```sh
bun install && bun run dev
```

`bun run dev` runs `scripts/setup-local.mjs`, then Vite. The setup step is safe to run on every start:

1. Creates `.dev.vars` from `.dev.vars.example` if it is missing, with
   `ADMIN_EMAIL=admin@iosonand.local` and a random `ADMIN_PASSWORD`. It prints the password once.
   The file is git-ignored.
2. Applies the D1 migrations to the local database
   (`wrangler d1 migrations apply oneios-tracker --local`).
3. Loads `seed/seed.json` when the local database has no devices. It never seeds over existing rows.

The app and the API listen on port 3000 on every address, IPv4 and IPv6. Set `PORT` for another
port:

```sh
PORT=3103 bun run dev
```

The port is strict: if it is taken, Vite exits instead of picking another one.

### The admin account

Log in at `/login` with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.dev.vars`. That pair always
logs in as the admin; the account is created on first use. From the CLI:

```sh
node cli.mjs login --admin      # reads ADMIN_EMAIL / ADMIN_PASSWORD from .dev.vars
node cli.mjs whoami
```

### Other scripts

| Command | What it does |
|---|---|
| `bun run setup` | the setup step alone |
| `bun run dev:only` | Vite without the setup step |
| `bun run db:migrate:local` | apply migrations to the local DB |
| `bun run seed:local` | seed the local DB (refuses when it has devices; `node seed/apply.mjs --local --force` replaces the seeded tables) |
| `node scripts/seed-export.mjs` | write the local DB's seeded tables (devices, areas, statuses, repos, support rows, lineage, posts) back into `seed/seed.json`; `--dry-run` prints the counts |
| `bun run check` | `node cli.mjs check` against the tracker URL |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run build` | `vite build` into `dist/` |

The local database lives in `.wrangler/state/`. Delete that folder to start over; the next
`bun run dev` recreates and seeds it.

## Tests

The API tests run against a running tracker:

```sh
bun test tests/api                                   # TRACKER_URL defaults to http://127.0.0.1:3001
TRACKER_URL=http://127.0.0.1:3000 bun test tests/api
```

They read the admin pair from the environment or `.dev.vars`. Each run uses fresh random accounts
and throwaway devices `t-<random>`, and deletes what it made afterwards (devices, repos, uploads,
accounts, and its changelog rows in the local D1). Seed data is only read.

| File | What it covers |
|---|---|
| `tests/api/api.test.ts` | auth, the trust model, forks, posts, CSRF, routing |
| `tests/api/v2.test.ts` | the not-applicable rule, pagination, API keys (scopes, expiry, last_used, rotate, revoke), repo claims (owner, proof file, admin approve and reject, stepping down), support rows, lineage and device families, uploads (types, limits, Range, cookie uploads and CSRF, delete), post thumbnails, `/cli.mjs` |
| `tests/api/password.test.ts` | password change, password reset (a planted reset row, local only) and the per-email sign-in limit |
| `tests/api/unit.test.ts` | no tracker needed: the multipart parser, the file-type check, the proof-file check with a stubbed fetch, and the rate-limit buckets against `wrangler.jsonc` |
| `tests/api/openapi.test.ts` | every route under `src/routes/api/` is in the OpenAPI document (`src/lib/openapi.ts`), each operation's `x-scope` is the enforced one, and the served documents match |

A few v2 cases write to the local D1 directly (a test GitHub login for the owner check, a past key
expiry), so they run only against a local tracker. The proof-file success path needs a real push;
the unit test covers it with a stubbed fetch.

Locally each test call sends a random `CF-Connecting-IP`, so a run does not use up the per-IP rate
limits (Cloudflare overwrites that header in production). `RATE_LIMITS=off` in `.dev.vars` turns
every limit off.

## Deploy to Cloudflare

Production runs at `https://hackios.appaiproxy.com`, a custom domain (`routes` in
`wrangler.jsonc`) on the `appaiproxy.com` zone. Cloudflare creates its DNS record and certificate
on deploy. `database_id` in `wrangler.jsonc` is the production D1. `preview_database_id:
"local-only-for-now"` is the key the local SQLite file under `.wrangler/state` is stored by, so
`vite dev` and `--local` keep using the local DB.

A deploy after a change:

```sh
bunx wrangler login                 # once per machine
bun run db:migrate:remote           # only when there is a new migrations/NNNN_*.sql
bun run deploy                      # vite build (production, minified), then wrangler deploy
node scripts/sync-catalog.mjs --remote   # now and then: the Android device catalog from Google Play
```

First-time setup, already done for production:

```sh
bunx wrangler d1 create oneios-tracker          # its database_id goes into wrangler.jsonc
bunx wrangler r2 bucket create iosonand-media   # uploads (binding MEDIA); R2 is enabled in the dashboard first
bun run db:migrate:remote
bun run seed:remote                             # or copy a local DB's content tables, see below
node scripts/sync-catalog.mjs --remote          # the device catalog (`--local` for vite dev)
bunx wrangler secret put ADMIN_EMAIL
bunx wrangler secret put ADMIN_PASSWORD
bunx wrangler secret put PASSWORD_PEPPER        # openssl rand -base64 32; never change or lose it
bunx wrangler secret put PUBLIC_URL             # https://hackios.appaiproxy.com (links in mail)
bunx wrangler secret put MAIL_FROM              # an address on a domain onboarded for Email Sending
bunx wrangler secret put GITHUB_TOKEN           # optional
bunx wrangler secret put GITHUB_CLIENT_ID       # optional: "Continue with GitHub" (an OAuth App,
bunx wrangler secret put GITHUB_CLIENT_SECRET   #   callback <site>/api/auth/github/callback)
```

Production was loaded from a local DB rather than `seed.json`: the content tables (areas,
devices, device_status, forks, reddit_posts, lineage_repos, repo_devices, repo_lineage and the
changelog) without the rows test runs leave behind (`t-*` devices, `api-test/*` repos). Users,
sessions, API tokens, claims and media are never copied: local logins would work in production,
and media files live in the local R2 only.

Notes:

- The account is on **Workers Paid**. Password hashing can go over the Free plan's 10 ms CPU limit,
  and Email Service only mails any address on Paid (3,000 mails a month included).
- DDoS protection is automatic. The dashboard's WAF and rate-limit rules stop traffic before the
  Worker runs (and are billed). A good first rule: `/api/auth/*`, 10 requests per 10 seconds per
  IP, block.
- Password-reset mail: Email Service > Email Sending > Onboard Domain, and pick the domain (it
  adds the MX, SPF, DKIM and DMARC records). `MAIL_FROM` must be an address on it.
- The rate limits (`ratelimits` in `wrangler.jsonc`) need no setup. Their `namespace_id`s only
  have to be unique in the account.

## Search engines

`src/lib/seo.ts` builds each page's head: title, description, canonical URL on `SITE_URL`
(`https://hackios.appaiproxy.com`, or `VITE_SITE_URL` at build time), Open Graph and Twitter card
tags, and robots. Device pages use the device photo as the preview image and carry a breadcrumb
in JSON-LD; the home page carries a `WebSite` entry with its search URL. Login, signup, password
and profile pages send `noindex`. `GET /robots.txt` keeps `/api/` and the account pages out of
crawls and points at `GET /sitemap.xml`, which lists the home page, every device (lastmod from its
newest update), the docs and the API reference. `public/_headers` caches the hashed files under
`/assets/` for a year.

The docs at `/docs` are compiled into the Worker at build time; they read no files at runtime.
`GET /cli.mjs` serves the repo's `cli.mjs`, imported as text at build time (in `vite dev` a small
dev-only middleware in `vite.config.ts` serves the file, because Vite would otherwise answer that
URL itself). Locally, uploads use the emulated R2 under `.wrangler/state`, and mail is not sent:
the dev server console shows each message, and its text is saved under `.wrangler/tmp/email/`.
The API reference at `/api-reference` loads Scalar from jsDelivr in the browser.
