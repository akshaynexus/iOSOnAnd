-- migrations/0007_post_images.sql — a thumbnail per Reddit post (the port
-- running on the phone, from the post itself: i.redd.it / preview.redd.it).
-- Additive only, D1-safe. image_url '' = none; width/height NULL = unknown.

ALTER TABLE reddit_posts ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE reddit_posts ADD COLUMN image_width INTEGER;
ALTER TABLE reddit_posts ADD COLUMN image_height INTEGER;
