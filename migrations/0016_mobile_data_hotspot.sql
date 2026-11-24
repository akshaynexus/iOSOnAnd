-- 0016: cellular data and tethering as their own areas. Additive only, D1-safe.
--
-- areas 'mobile-data'  Mobile data: apps reach the internet over the cellular
--                      network (LTE / 5G), with Wi-Fi off.
-- areas 'hotspot'      Personal Hotspot: other devices get internet through the
--                      phone's cellular connection (Wi-Fi, Bluetooth or USB).
-- 'modem' (the baseband comes up, SIM and signal) and 'calls' / 'sms' stay.

INSERT OR IGNORE INTO areas (slug, name, notes, scope)
VALUES ('mobile-data', 'Mobile data', 'apps reach the internet over the cellular network (LTE / 5G) with Wi-Fi off', 'all');

INSERT OR IGNORE INTO areas (slug, name, notes, scope)
VALUES ('hotspot', 'Personal Hotspot', 'other devices get internet through the phone''s cellular connection (Wi-Fi, Bluetooth or USB)', 'all');
