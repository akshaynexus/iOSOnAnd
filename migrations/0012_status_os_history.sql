-- 0012: a status per system, and the history of status changes. D1-safe.
--
-- device_status.os          the system the row is about: 'ios' (iOS and
--                           iPadOS, the checklist's default), 'macos' or
--                           'tvos'. Part of the key: a phone can have Wi-Fi
--                           working on iOS and broken on macOS.
-- device_status.os_version  the version the evidence was seen on, as the
--                           writer states it ('iOS 27.2', 'macOS 27.2'); ''
--                           when not stated.
-- areas 'macos' (0011)      folded in: its rows become boot rows with os
--                           'macos', and the area is removed.
-- devices.tvos_version      the tvOS version a port runs; '' when none.
-- status_history            one row per status write: the state before and
--                           after, the detail and source, who, when.
--                           Backfilled from the changelog's "status
--                           <device>/<area> -> <state>: <detail>" lines (no
--                           state before, no source).

CREATE TABLE device_status_v2 (
  device_slug TEXT NOT NULL REFERENCES devices(slug),
  area_slug   TEXT NOT NULL REFERENCES areas(slug),
  os          TEXT NOT NULL DEFAULT 'ios',
  os_version  TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT 'unknown',
  detail      TEXT DEFAULT '',
  source      TEXT DEFAULT '',
  updated     TEXT DEFAULT (strftime('%Y-%m-%d','now')),
  PRIMARY KEY (device_slug, area_slug, os)
);

INSERT INTO device_status_v2 (device_slug, area_slug, os, state, detail, source, updated)
SELECT device_slug,
       CASE WHEN area_slug = 'macos' THEN 'boot' ELSE area_slug END,
       CASE WHEN area_slug = 'macos' THEN 'macos' ELSE 'ios' END,
       state, detail, source, updated
  FROM device_status;

DROP TABLE device_status;
ALTER TABLE device_status_v2 RENAME TO device_status;
CREATE INDEX IF NOT EXISTS idx_device_status_area ON device_status(area_slug);
CREATE INDEX IF NOT EXISTS idx_device_status_os ON device_status(os);

DELETE FROM areas WHERE slug = 'macos';

ALTER TABLE devices ADD COLUMN tvos_version TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_slug TEXT NOT NULL,
  area_slug   TEXT NOT NULL,
  os          TEXT NOT NULL DEFAULT 'ios',
  os_version  TEXT NOT NULL DEFAULT '',
  old_state   TEXT,
  state       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  who         TEXT NOT NULL DEFAULT '',
  user_id     INTEGER,
  created     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_history_device ON status_history(device_slug, id);

-- Backfill from the changelog: "status <device>/<area> -> <state>[: <detail>]".
INSERT INTO status_history (device_slug, area_slug, os, state, detail, who, created)
WITH a AS (
  SELECT id, who, created, substr(summary, 8) AS rest FROM changelog WHERE summary LIKE 'status %/% -> %'
), b AS (
  SELECT id, who, created, substr(rest, 1, instr(rest, '/') - 1) AS dev, substr(rest, instr(rest, '/') + 1) AS r2 FROM a
), c AS (
  SELECT id, who, created, dev, substr(r2, 1, instr(r2, ' -> ') - 1) AS area, substr(r2, instr(r2, ' -> ') + 4) AS r3 FROM b WHERE instr(r2, ' -> ') > 0
), d AS (
  SELECT id, who, created, dev, area,
         CASE WHEN instr(r3, ':') > 0 THEN substr(r3, 1, instr(r3, ':') - 1) ELSE r3 END AS st,
         CASE WHEN instr(r3, ': ') > 0 THEN substr(r3, instr(r3, ': ') + 2) ELSE '' END AS detail
    FROM c
)
SELECT d.dev,
       CASE WHEN d.area = 'macos' THEN 'boot' ELSE d.area END,
       CASE WHEN d.area = 'macos' THEN 'macos' ELSE 'ios' END,
       d.st, d.detail, COALESCE(d.who, ''), COALESCE(d.created, '')
  FROM d
  JOIN devices dv ON dv.slug = d.dev
 WHERE d.st IN ('works', 'broken', 'in-progress', 'unknown')
 ORDER BY d.id;
