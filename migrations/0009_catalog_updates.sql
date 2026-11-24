-- 0009: the Android device catalog and maintainer updates. Additive only.
--
-- device_catalog   every Android phone and tablet Google Play lists
--                  (play_public/supported_devices.csv), one row per brand and
--                  marketing name, loaded by scripts/sync-catalog.mjs. Not
--                  tracked devices: the list a new device is picked from.
-- device_updates   a maintainer's post on a phone: text, with uploads
--                  attached through media.update_id (photos and clips).
--                  deleted = 1 hides it.

CREATE TABLE IF NOT EXISTS device_catalog (
  id        INTEGER PRIMARY KEY,
  brand     TEXT NOT NULL,
  name      TEXT NOT NULL,               -- marketing name, e.g. Redmi Note 7
  codenames TEXT NOT NULL DEFAULT '',    -- comma-separated, e.g. lavender
  models    TEXT NOT NULL DEFAULT '',    -- comma-separated model numbers
  search    TEXT NOT NULL                -- lowercased brand, name, codenames, models
);
CREATE INDEX IF NOT EXISTS idx_catalog_name ON device_catalog(name);

CREATE TABLE IF NOT EXISTS device_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL DEFAULT '',
  created     TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_updates_device ON device_updates(device_slug, deleted, id);

ALTER TABLE media ADD COLUMN update_id INTEGER REFERENCES device_updates(id);
CREATE INDEX IF NOT EXISTS idx_media_update ON media(update_id);
