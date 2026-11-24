-- 0015: link a photo or clip to what it proves. Additive only, D1-safe.
--
-- media.history_id  the status change (status_history row) the upload is
--                   evidence for; its area is the change's area
-- media.feature_id  the notable feature (device_features row) it shows
--
-- Both are optional and on the same device as the upload. Deleting a
-- feature clears the link; the upload stays on the device.

ALTER TABLE media ADD COLUMN history_id INTEGER REFERENCES status_history(id);
ALTER TABLE media ADD COLUMN feature_id INTEGER REFERENCES device_features(id);
CREATE INDEX IF NOT EXISTS idx_media_history ON media(history_id);
CREATE INDEX IF NOT EXISTS idx_media_feature ON media(feature_id);
