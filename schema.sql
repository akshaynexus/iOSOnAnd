-- schema.sql — REFERENCE ONLY: the schema a fresh D1 database ends up with
-- after migrations/0001..0007 (dumped with sqlite3 from a fresh local D1 after
-- `wrangler d1 migrations apply --local`). Do not apply this file.
-- migrations/ is the source of truth:
--   bunx wrangler d1 migrations apply oneios-tracker --local   (or --remote)
-- A schema change is a new migrations/NNNN_name.sql; regenerate this dump.
--
-- States: works | broken | in-progress | unknown. Claims: pending | approved
-- | rejected (approved = the user maintains that device). Forks.verified:
-- fork-claim | reproduced | merged. forks.kind: upstream | fork | standalone.
-- devices.base: oneios | other; areas.scope: all | oneios (an oneios area is
-- not applicable to a device whose base is not oneios). repo_devices.support:
-- primary | merged | ported | claimed. repo_lineage.relation: fork-of |
-- derived-from | ported-from | uses. repo_claims: method owner | proof-file |
-- admin, status pending | approved | rejected | expired. api_tokens.scopes:
-- all | read | status:write | fork:write | post:write | media:write (comma
-- separated). users.token_hash and api_tokens.label are unused leftovers of
-- the pre-auth schema (kept; dropping needs a table rebuild).

CREATE TABLE devices (
  slug        TEXT PRIMARY KEY,          -- e.g. s24-ultra
  name        TEXT NOT NULL,             -- Galaxy S24 Ultra
  model       TEXT DEFAULT '',           -- SM-S928
  soc         TEXT DEFAULT '',           -- SM8650
  repo_kind   TEXT DEFAULT 'home',       -- home | fork | snapshot | mirror | none
  status      TEXT DEFAULT 'unknown',    -- works | broken | in-progress | unknown
  best_result TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now'))
, base TEXT NOT NULL DEFAULT 'other', ios_version TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', image_credit TEXT NOT NULL DEFAULT '', image_license TEXT NOT NULL DEFAULT '', image_source_url TEXT NOT NULL DEFAULT '');
CREATE TABLE areas (
  slug TEXT PRIMARY KEY,                 -- boot, gpu, touch ...
  name TEXT NOT NULL,                    -- Boot to Home Screen
  notes TEXT DEFAULT ''
, scope TEXT NOT NULL DEFAULT 'all');
CREATE TABLE device_status (
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  area_slug   TEXT NOT NULL REFERENCES areas(slug),
  state       TEXT NOT NULL DEFAULT 'unknown',  -- works | broken | in-progress | unknown
  detail      TEXT DEFAULT '',
  source      TEXT DEFAULT '',           -- docs link, profile, session log ref
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now')),
  PRIMARY KEY (device_slug, area_slug)
);
CREATE TABLE forks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_slug TEXT REFERENCES devices(slug),  -- NULL for pure mirrors
  repo        TEXT NOT NULL,             -- YMGPwcca/OneiOS
  branch      TEXT DEFAULT '',
  url         TEXT DEFAULT '',
  best_result TEXT DEFAULT '',           -- fork's own claim (unverified unless noted)
  ported      TEXT DEFAULT '',           -- what already flowed back to main
  fork_only   TEXT DEFAULT '',           -- what is still fork-only
  verified    TEXT DEFAULT 'fork-claim', -- fork-claim | reproduced | merged
  notes       TEXT DEFAULT '',
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now'))
, maintainer_user_id INTEGER REFERENCES users(id), maintainer_since TEXT, kind TEXT NOT NULL DEFAULT 'fork', base_project TEXT NOT NULL DEFAULT '');
CREATE TABLE reddit_posts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT NOT NULL,
  url       TEXT NOT NULL UNIQUE,
  published TEXT DEFAULT '',
  note      TEXT DEFAULT ''
, image_url TEXT NOT NULL DEFAULT '', image_width INTEGER, image_height INTEGER);
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  contact      TEXT DEFAULT '',
  token_hash   TEXT NOT NULL UNIQUE,     -- sha256 of the bearer token
  is_admin     INTEGER NOT NULL DEFAULT 0,
  created      TEXT DEFAULT (strftime('%Y-%m-%d','now'))
, email TEXT, password_hash TEXT, github_id INTEGER, github_login TEXT, github_linked_at TEXT);
CREATE TABLE api_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,       -- sha256 of the bearer token
  label      TEXT DEFAULT '',
  created    TEXT DEFAULT (strftime('%Y-%m-%d','now')),
  expires    TEXT DEFAULT ''
, name TEXT NOT NULL DEFAULT '', prefix TEXT NOT NULL DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0, scopes TEXT NOT NULL DEFAULT 'all', last_used TEXT);
CREATE TABLE login_challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce        TEXT NOT NULL UNIQUE,     -- single-use gist-proof nonce
  github_login TEXT DEFAULT '',
  created      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  used         INTEGER NOT NULL DEFAULT 0
, github_id INTEGER, gist_id TEXT DEFAULT '', expires TEXT);
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,       -- sha256 of the cookie session token
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  expires    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  note        TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now'))
);
CREATE TABLE changelog (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  who     TEXT DEFAULT '',
  summary TEXT NOT NULL,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE TABLE repo_devices (
  fork_id     INTEGER NOT NULL REFERENCES forks(id),
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  support     TEXT NOT NULL DEFAULT 'claimed',
  via_fork_id INTEGER REFERENCES forks(id),
  note        TEXT NOT NULL DEFAULT '',
  updated     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (fork_id, device_slug)
);
CREATE TABLE repo_claims (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  repo            TEXT NOT NULL,                 -- OWNER/REPO
  fork_id         INTEGER REFERENCES forks(id),
  device_slug     TEXT REFERENCES devices(slug),
  method          TEXT NOT NULL DEFAULT 'proof-file', -- owner | proof-file | admin
  nonce           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | expired
  note            TEXT NOT NULL DEFAULT '',
  fork_created    INTEGER NOT NULL DEFAULT 0,
  device_claim_id INTEGER,
  created         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires         TEXT,
  decided         TEXT
);
CREATE TABLE media (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_slug  TEXT NOT NULL REFERENCES devices(slug),
  fork_id      INTEGER REFERENCES forks(id),
  area_slug    TEXT REFERENCES areas(slug),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  r2_key       TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  caption      TEXT NOT NULL DEFAULT '',
  created      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE repo_lineage (
  repo         TEXT NOT NULL,
  fork_id      INTEGER REFERENCES forks(id),
  base         TEXT NOT NULL,
  base_fork_id INTEGER REFERENCES forks(id),
  relation     TEXT NOT NULL DEFAULT 'derived-from', -- fork-of | derived-from | ported-from | uses
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',
  base_exists  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (repo, base, relation)
);
CREATE TABLE lineage_repos (
  repo         TEXT PRIMARY KEY,
  base_project TEXT NOT NULL DEFAULT '',
  repo_exists  INTEGER NOT NULL DEFAULT 1,
  description  TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_github_id ON users(github_id);
CREATE UNIQUE INDEX idx_claims_active
  ON claims(user_id, device_slug) WHERE status IN ('pending', 'approved');
CREATE INDEX idx_claims_device ON claims(device_slug, status);
CREATE INDEX idx_claims_user ON claims(user_id, status);
CREATE INDEX idx_forks_device ON forks(device_slug);
CREATE INDEX idx_forks_repo ON forks(repo);
CREATE INDEX idx_device_status_area ON device_status(area_slug);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_login_challenges_github ON login_challenges(github_id, used);
CREATE INDEX idx_login_challenges_expires ON login_challenges(expires);
CREATE INDEX idx_devices_base ON devices(base);
CREATE INDEX idx_forks_maintainer ON forks(maintainer_user_id);
CREATE UNIQUE INDEX idx_forks_repo_unique ON forks(repo COLLATE NOCASE);
CREATE INDEX idx_forks_kind ON forks(kind);
CREATE INDEX idx_repo_devices_device ON repo_devices(device_slug);
CREATE INDEX idx_repo_devices_via ON repo_devices(via_fork_id);
CREATE UNIQUE INDEX idx_repo_claims_pending
  ON repo_claims(user_id, repo COLLATE NOCASE) WHERE status = 'pending';
CREATE INDEX idx_repo_claims_status ON repo_claims(status, expires);
CREATE INDEX idx_repo_claims_user ON repo_claims(user_id, status);
CREATE INDEX idx_repo_claims_fork ON repo_claims(fork_id);
CREATE INDEX idx_media_device ON media(device_slug, deleted, id);
CREATE INDEX idx_media_fork ON media(fork_id, deleted, id);
CREATE INDEX idx_media_area ON media(area_slug, deleted, id);
CREATE INDEX idx_media_user ON media(user_id);
CREATE INDEX idx_changelog_created ON changelog(created);
CREATE INDEX idx_forks_base_project ON forks(base_project);
CREATE INDEX idx_repo_lineage_fork ON repo_lineage(fork_id);
CREATE INDEX idx_repo_lineage_base_fork ON repo_lineage(base_fork_id);
CREATE INDEX idx_repo_lineage_base ON repo_lineage(base COLLATE NOCASE);
