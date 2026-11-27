-- 0021: public usage statistics, as daily counts only. Additive only, D1-safe.
--
-- stats_daily  (day, kind, key) -> n
--   kind device_view   key = device slug     a phone page opened
--        profile_view  key = user id         a profile opened
--        search        key = normalized term a search that matched a phone
--        search_device key = device slug     the phone a search matched best
-- No IP address, user id or anything per person is stored: only how many
-- times a day. Counted from a beacon the browser sends once per page and
-- day (POST /api/stats/hit), so link preloading and most bots do not count.

CREATE TABLE IF NOT EXISTS stats_daily (
  day  TEXT NOT NULL,
  kind TEXT NOT NULL,
  key  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);
CREATE INDEX IF NOT EXISTS idx_stats_kind_day ON stats_daily(kind, day);
