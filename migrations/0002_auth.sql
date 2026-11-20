-- migrations/0002_auth.sql — auth-wave columns on top of 0001_init.sql.
--
-- users gains the email/password + github-link columns. The pre-auth
-- `token_hash TEXT NOT NULL UNIQUE` column is KEPT (backward compat; new code
-- authenticates via sessions/api_tokens and fills a random placeholder).
-- api_tokens gains name/prefix/revoked; login_challenges gains
-- github_id/gist_id/expires. All ADD COLUMNs (D1-safe, additive only).
-- Unique indexes allow multiple NULLs in SQLite, so email/github_id stay
-- nullable-unique as the contract requires.

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN github_id INTEGER;
ALTER TABLE users ADD COLUMN github_login TEXT;
ALTER TABLE users ADD COLUMN github_linked_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

ALTER TABLE api_tokens ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE api_tokens ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE api_tokens ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;

ALTER TABLE login_challenges ADD COLUMN github_id INTEGER;
ALTER TABLE login_challenges ADD COLUMN gist_id TEXT DEFAULT '';
ALTER TABLE login_challenges ADD COLUMN expires TEXT;
