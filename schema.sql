-- OneiOS-website schema: SQLite is the single source of truth.
-- States: works | broken | in-progress | unknown
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS devices (
  slug        TEXT PRIMARY KEY,          -- e.g. s24-ultra
  name        TEXT NOT NULL,             -- Galaxy S24 Ultra
  model       TEXT DEFAULT '',           -- SM-S928
  soc         TEXT DEFAULT '',           -- SM8650
  repo_kind   TEXT DEFAULT 'home',       -- home | fork | snapshot | mirror | none
  status      TEXT DEFAULT 'unknown',    -- works | broken | in-progress | unknown
  best_result TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now'))
);

CREATE TABLE IF NOT EXISTS areas (
  slug TEXT PRIMARY KEY,                 -- boot, gpu, touch ...
  name TEXT NOT NULL,                    -- Boot to Home Screen
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS device_status (
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  area_slug   TEXT NOT NULL REFERENCES areas(slug),
  state       TEXT NOT NULL DEFAULT 'unknown',  -- works | broken | in-progress | unknown
  detail      TEXT DEFAULT '',
  source      TEXT DEFAULT '',           -- docs link, profile, session log ref
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now')),
  PRIMARY KEY (device_slug, area_slug)
);

CREATE TABLE IF NOT EXISTS forks (
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
);

CREATE TABLE IF NOT EXISTS reddit_posts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT NOT NULL,
  url       TEXT NOT NULL UNIQUE,
  published TEXT DEFAULT '',
  note      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  contact      TEXT DEFAULT '',
  token_hash   TEXT NOT NULL UNIQUE,     -- sha256 of the bearer token
  is_admin     INTEGER NOT NULL DEFAULT 0,
  created      TEXT DEFAULT (strftime('%Y-%m-%d','now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  note        TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now'))
);

CREATE TABLE IF NOT EXISTS changelog (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  who     TEXT DEFAULT '',
  summary TEXT NOT NULL,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
