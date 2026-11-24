-- 0020: known GPU issues per phone, so porters with the same symptom find the
-- cause and fix others found. Additive only, D1-safe.
--
-- gpu_issues  kind   white-widgets (HEIC snapshots fail without a hardware
--                    HEVC encoder), black-ui (black widgets, blurs, materials
--                    or lock screen: a failing Metal path), gpu-fault,
--                    out-of-memory, artifacts (tearing, corruption), slow,
--                    crash, other
--             state  open | workaround | fixed
--             title (the symptom), cause, fix, detail, source, os_version,
--             who, user_id, created, updated; written by the phone's
--             maintainers or an admin.

CREATE TABLE IF NOT EXISTS gpu_issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  kind        TEXT NOT NULL DEFAULT 'other',
  state       TEXT NOT NULL DEFAULT 'open',
  title       TEXT NOT NULL,
  cause       TEXT NOT NULL DEFAULT '',
  fix         TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  os_version  TEXT NOT NULL DEFAULT '',
  who         TEXT NOT NULL DEFAULT '',
  user_id     INTEGER,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gpu_issues_device ON gpu_issues(device_slug, id);
CREATE INDEX IF NOT EXISTS idx_gpu_issues_kind ON gpu_issues(kind, state);
