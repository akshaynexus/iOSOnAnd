-- 0018: how a phone's GPU acceleration works, and how fast. Additive only, D1-safe.
--
-- gpu_accel  one row per phone (written by its maintainers or an admin):
--   method    native-metal  a native Metal driver on the phone's GPU
--             metal-vulkan  Metal translated to Vulkan (metal2vulkan on Turnip, PanVK ...)
--             metal-gl      Metal translated to OpenGL / OpenGL ES
--             gles          OpenGL ES only (e.g. an EAGL bridge over Panfrost), no Metal
--             virtio-gpu    forwarded to Android's GPU driver (a hosted guest, e.g. OneiOS)
--             cpu           software rendering, no GPU acceleration
--             other, unknown
--   stack     the chain, e.g. "AdrenoMetal -> metal2vulkan -> Turnip -> Adreno740 kernel driver"
--   fps_low, fps_high  measured frames per second (a range; either may be null)
--   fps_note  what was measured, e.g. "idle lock screen", "home-screen swipes"
--   repos     OWNER/REPO list of the code that does it
--   detail, source, os_version, who, user_id, updated: as on a status row

CREATE TABLE IF NOT EXISTS gpu_accel (
  device_slug TEXT PRIMARY KEY REFERENCES devices(slug),
  method      TEXT NOT NULL DEFAULT 'unknown',
  stack       TEXT NOT NULL DEFAULT '',
  fps_low     INTEGER,
  fps_high    INTEGER,
  fps_note    TEXT NOT NULL DEFAULT '',
  repos       TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  os_version  TEXT NOT NULL DEFAULT '',
  who         TEXT NOT NULL DEFAULT '',
  user_id     INTEGER,
  updated     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gpu_accel_method ON gpu_accel(method);
