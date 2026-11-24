-- 0011: macOS on Android phones. Additive only, D1-safe.
--
-- areas 'macos'          one area for macOS running on the phone (natively or
--                        in a VM), with a state, detail and source like the
--                        others. Its scope 'extra' means: writable on every
--                        phone, shown on its page and in the grid, but not
--                        counted in the phone's iOS progress ("N of M areas").
-- devices.macos_version  the macOS version a port runs, as stated by its
--                        source; '' when none.

INSERT OR IGNORE INTO areas (slug, name, notes, scope)
VALUES ('macos', 'macOS', 'macOS running on the phone (natively or in a VM); works = reaches the desktop', 'extra');

ALTER TABLE devices ADD COLUMN macos_version TEXT NOT NULL DEFAULT '';
