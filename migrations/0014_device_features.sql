-- 0014: other notable features of a phone. Additive only, D1-safe.
--
-- device_features  what a port has that the checklist does not list, or
--                  uncommon hardware that works (an IR blaster, a stylus,
--                  a second screen, a hinge sensor, satellite messaging ...):
--                  a name, the system it is on, a state, what was seen and
--                  the source, like a status row; written by the phone's
--                  maintainers (or an admin).

CREATE TABLE IF NOT EXISTS device_features (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  name        TEXT NOT NULL,
  os          TEXT NOT NULL DEFAULT 'ios',
  state       TEXT NOT NULL DEFAULT 'unknown',
  detail      TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  who         TEXT NOT NULL DEFAULT '',
  user_id     INTEGER,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_features_device ON device_features(device_slug, id);
