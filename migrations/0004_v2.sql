-- migrations/0004_v2.sql — v2: port base, iOS version and photo per device;
-- area scope (the not-applicable rule); repo ownership; scoped API keys;
-- media on R2. Additive only (ADD COLUMN, new tables, indexes), D1-safe.
--
-- devices.base      'oneios' | 'other'. A status write on an area with
--                   scope 'oneios' for a device whose base is not 'oneios'
--                   is 400 "area not applicable" (src/lib/status.ts).
-- devices.image_*   a freely licensed photo (Wikimedia Commons): the 640 px
--                   thumb URL, the author, the license and the file page.
-- areas.scope       'all' | 'oneios'.
-- forks.maintainer_user_id / maintainer_since
--                   the user who owns the repo on the tracker (an approved
--                   repo claim).
-- repo_claims       a claim on a repo: method 'owner' (github_login equals
--                   the repo owner), 'proof-file' (.iosonand-verify holds the
--                   nonce) or 'admin' (an admin approved it). fork_created:
--                   the claim created the fork row (removed again when the
--                   claim is rejected or expires before anyone maintains it).
--                   device_claim_id: the device claim the approval granted.
-- api_tokens.scopes comma-separated: all | read | status:write | fork:write
--                   | post:write | media:write. api_tokens.expires already
--                   exists (0001, '' or NULL = never). last_used is written
--                   at most once a minute.
-- forks.kind, repo_devices: upstream repos and the devices each repo supports.
-- media             uploads in the R2 bucket bound as MEDIA; deleted = 1 is a
--                   soft delete (the R2 object is removed too).

ALTER TABLE devices ADD COLUMN base TEXT NOT NULL DEFAULT 'other';
ALTER TABLE devices ADD COLUMN ios_version TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN image_credit TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN image_license TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN image_source_url TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_devices_base ON devices(base);

ALTER TABLE areas ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
UPDATE areas SET scope = 'oneios' WHERE slug IN ('return-to-oneui', 'ipc', 'kernel-mem');

ALTER TABLE forks ADD COLUMN maintainer_user_id INTEGER REFERENCES users(id);
ALTER TABLE forks ADD COLUMN maintainer_since TEXT;
CREATE INDEX IF NOT EXISTS idx_forks_maintainer ON forks(maintainer_user_id);

-- forks.kind: 'upstream' (a project's main repo, e.g. akshaynexus/OneiOS),
-- 'fork' (a device fork) or 'standalone' (an own port that is no fork).
-- The repo name is unique (case-insensitive); forks.device_slug stays the
-- primary device, repo_devices lists every device a repo supports.
ALTER TABLE forks ADD COLUMN kind TEXT NOT NULL DEFAULT 'fork';
CREATE UNIQUE INDEX IF NOT EXISTS idx_forks_repo_unique ON forks(repo COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_forks_kind ON forks(kind);

-- support: primary (the repo's own device) | merged (fork work merged into
-- the repo) | ported (fork work ported into it) | claimed (the repo says so).
-- via_fork_id: the fork the merged or ported work came from.
CREATE TABLE IF NOT EXISTS repo_devices (
  fork_id     INTEGER NOT NULL REFERENCES forks(id),
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  support     TEXT NOT NULL DEFAULT 'claimed',
  via_fork_id INTEGER REFERENCES forks(id),
  note        TEXT NOT NULL DEFAULT '',
  updated     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (fork_id, device_slug)
);
CREATE INDEX IF NOT EXISTS idx_repo_devices_device ON repo_devices(device_slug);
CREATE INDEX IF NOT EXISTS idx_repo_devices_via ON repo_devices(via_fork_id);
-- Every fork with a device supports it: 'merged' when the fork is merged,
-- else 'claimed'.
INSERT OR IGNORE INTO repo_devices (fork_id, device_slug, support, note)
  SELECT id, device_slug, CASE WHEN verified = 'merged' THEN 'merged' ELSE 'claimed' END, ''
    FROM forks WHERE device_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS repo_claims (
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
-- One pending claim per user and repo (a second POST returns the first).
CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_claims_pending
  ON repo_claims(user_id, repo COLLATE NOCASE) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_repo_claims_status ON repo_claims(status, expires);
CREATE INDEX IF NOT EXISTS idx_repo_claims_user ON repo_claims(user_id, status);
CREATE INDEX IF NOT EXISTS idx_repo_claims_fork ON repo_claims(fork_id);

ALTER TABLE api_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT 'all';
ALTER TABLE api_tokens ADD COLUMN last_used TEXT;

CREATE TABLE IF NOT EXISTS media (
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
CREATE INDEX IF NOT EXISTS idx_media_device ON media(device_slug, deleted, id);
CREATE INDEX IF NOT EXISTS idx_media_fork ON media(fork_id, deleted, id);
CREATE INDEX IF NOT EXISTS idx_media_area ON media(area_slug, deleted, id);
CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);

-- Pagination reads (ORDER BY id DESC LIMIT/OFFSET) and the changelog feed.
CREATE INDEX IF NOT EXISTS idx_changelog_created ON changelog(created);
