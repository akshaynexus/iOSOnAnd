-- 0019: porting records and the driver components they use, imported from a
-- porting framework's own records (UniXNU's device-records/*.toml and
-- components.toml, the source of unixnu.com/devices). Additive only, D1-safe.
--
-- porting_records     one row per port repo's record: the codename, SoC, OS
--                     profile, a summary, and per area (cpu, display, input,
--                     gpu, network, audio ...) its status (device-verified,
--                     host-verified, implemented, planned, not-applicable),
--                     the components used, what it achieved, its limits, the
--                     next step, the build/boot procedure and the first
--                     evidence. `components` is ",A,B," for exact matching.
-- porting_components  the framework's driver and tool components: what each
--                     does, the hardware it drives, its repository, build
--                     stage, dependencies, OS ABIs and verified devices.
-- Written only by an admin import (POST /api/porting, POST /api/porting/components).

CREATE TABLE IF NOT EXISTS porting_records (
  key         TEXT PRIMARY KEY,
  framework   TEXT NOT NULL,
  record      TEXT NOT NULL,
  codename    TEXT NOT NULL DEFAULT '',
  repo        TEXT NOT NULL DEFAULT '',
  device_slug TEXT,
  title       TEXT NOT NULL DEFAULT '',
  soc         TEXT NOT NULL DEFAULT '',
  os_profile  TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  areas       TEXT NOT NULL DEFAULT '[]',
  components  TEXT NOT NULL DEFAULT '',
  n_device    INTEGER NOT NULL DEFAULT 0,
  n_host      INTEGER NOT NULL DEFAULT 0,
  n_impl      INTEGER NOT NULL DEFAULT 0,
  n_planned   INTEGER NOT NULL DEFAULT 0,
  page_url    TEXT NOT NULL DEFAULT '',
  source_url  TEXT NOT NULL DEFAULT '',
  imported    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_porting_device ON porting_records(device_slug);
CREATE INDEX IF NOT EXISTS idx_porting_repo ON porting_records(repo);
CREATE INDEX IF NOT EXISTS idx_porting_codename ON porting_records(codename);

CREATE TABLE IF NOT EXISTS porting_components (
  framework        TEXT NOT NULL,
  id               TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT '',
  function         TEXT NOT NULL DEFAULT '',
  hardware         TEXT NOT NULL DEFAULT '[]',
  repository       TEXT NOT NULL DEFAULT '',
  scope            TEXT NOT NULL DEFAULT '',
  build_stage      TEXT NOT NULL DEFAULT '',
  dependencies     TEXT NOT NULL DEFAULT '[]',
  os_abi           TEXT NOT NULL DEFAULT '[]',
  verified_devices TEXT NOT NULL DEFAULT '[]',
  source_url       TEXT NOT NULL DEFAULT '',
  imported         TEXT NOT NULL,
  PRIMARY KEY (framework, id)
);
