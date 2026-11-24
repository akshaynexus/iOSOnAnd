# Admin and operations

Kept out of the public docs.

## Admins

An admin is `users.is_admin = 1`. The bootstrap admin: logging in with exactly `ADMIN_EMAIL`
and `ADMIN_PASSWORD` (`.dev.vars` locally, Worker secrets in production) creates that account if
needed and makes it an admin. Another account is made an admin in the database:

```sh
wrangler d1 execute oneios-tracker --remote --command "UPDATE users SET is_admin = 1 WHERE github_login = 'LOGIN'"
```

Locally, `node cli.mjs login --admin` logs the CLI in as `ADMIN_EMAIL` / `ADMIN_PASSWORD` from
`.dev.vars`. The sync scripts (`scripts/sync-*.mjs --apply`) need an admin token: `TRACKER_TOKEN`
or that saved login.

## Secrets and settings

| Name | What |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the bootstrap admin |
| `PASSWORD_PEPPER` | HMAC key run over passwords before PBKDF2; never in the database |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | the GitHub OAuth App for "Continue with GitHub" (callback `<PUBLIC_URL>/api/auth/github/callback`) |
| `MAIL_FROM`, `PUBLIC_URL` | password-reset mail sender and the site's origin |
| `RATE_LIMITS` | `off` turns the rate limits off (tests) |

`.dev.vars.example` lists them with empty values; `.dev.vars` (git-ignored) holds the local ones,
`wrangler secret put NAME` the production ones.

## Rate limits

The limits on `/docs/permissions` are Workers rate-limit bindings (`ratelimits` in
`wrangler.jsonc`, mirrored in `src/lib/ratebuckets.ts`). They count per Cloudflare location, so
they are approximate. A logged-in admin is not counted for writes, uploads or calls out to GitHub
and Reddit.

## Media bucket

Uploads go to the R2 bucket `iosonand-media` (binding `MEDIA`). `vite dev` uses the emulated R2
under `.wrangler/state`, so uploads work locally with no setup. For a new deploy, create the
bucket once: `wrangler r2 bucket create iosonand-media`.

## Data

`seed/seed.json` holds the starting data, loaded into an empty database by `bun run dev`
(`scripts/setup-local.mjs`); `node scripts/seed-export.mjs` writes the local database back into
it. `scripts/sync-catalog.mjs [--local|--remote]` reloads the device catalog.
