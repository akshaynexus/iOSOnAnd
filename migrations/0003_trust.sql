-- migrations/0003_trust.sql — trust model + read-path indexes.
--
-- Trust model (enforced in src/lib/auth.ts): a maintainer of device X is a
-- user with an APPROVED claim on X. One active (pending or approved) claim
-- per user+device is enforced here by a partial unique index, so a racing
-- duplicate POST /api/claims fails at the DB too (the route returns 409).
--
-- Replaces the runtime ALTER TABLE safety net that used to live in
-- src/lib/auth.ts: every schema change now ships as a numbered migration,
-- applied with `wrangler d1 migrations apply oneios-tracker --local|--remote`.
-- Additive only, safe on a DB that already has data.

-- Collapse duplicate active claims before the unique index (keep the
-- approved one, else the oldest pending one).
DELETE FROM claims
 WHERE status = 'pending'
   AND EXISTS (SELECT 1 FROM claims c2
                WHERE c2.user_id = claims.user_id
                  AND c2.device_slug = claims.device_slug
                  AND c2.status = 'approved');
DELETE FROM claims
 WHERE status IN ('pending', 'approved')
   AND id NOT IN (SELECT MIN(id) FROM claims
                   WHERE status IN ('pending', 'approved')
                   GROUP BY user_id, device_slug, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_active
  ON claims(user_id, device_slug) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_claims_device ON claims(device_slug, status);
CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id, status);

-- Dashboard / detail reads filter by these.
CREATE INDEX IF NOT EXISTS idx_forks_device ON forks(device_slug);
CREATE INDEX IF NOT EXISTS idx_forks_repo ON forks(repo);
CREATE INDEX IF NOT EXISTS idx_device_status_area ON device_status(area_slug);

-- Auth lookups and expiry sweeps.
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_login_challenges_github ON login_challenges(github_id, used);
CREATE INDEX IF NOT EXISTS idx_login_challenges_expires ON login_challenges(expires);
