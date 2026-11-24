-- migrations/0008_password_resets.sql — single-use password-reset links.
-- POST /api/auth/password-reset mails a link holding a random secret; only
-- sha256(secret) is stored. 30-minute expiry; `used` is set when it is spent
-- (POST /api/auth/password-reset/confirm). Additive only, D1-safe.

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created TEXT NOT NULL,
  expires TEXT NOT NULL,
  used TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires);
