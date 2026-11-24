-- 0010: a repo can have several maintainers (people collaborating on one
-- port, e.g. OneiOS). Additive only.
--
-- repo_maintainers   one row per repo (forks.id) and user. Every check of
--                    "maintains this repo" reads it. forks.maintainer_user_id
--                    stays filled with the first maintainer (older API
--                    clients read it) and is kept in step by src/lib/repos.ts.

CREATE TABLE IF NOT EXISTS repo_maintainers (
  fork_id  INTEGER NOT NULL REFERENCES forks(id),
  user_id  INTEGER NOT NULL REFERENCES users(id),
  since    TEXT NOT NULL,
  added_by INTEGER REFERENCES users(id),
  PRIMARY KEY (fork_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_repo_maintainers_user ON repo_maintainers(user_id);

INSERT OR IGNORE INTO repo_maintainers (fork_id, user_id, since)
  SELECT id, maintainer_user_id, COALESCE(NULLIF(maintainer_since, ''), updated, '')
  FROM forks WHERE maintainer_user_id IS NOT NULL;
