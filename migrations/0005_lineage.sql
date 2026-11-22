-- migrations/0005_lineage.sql — repo lineage: what each tracked repo is based on.
-- Additive only, D1-safe.
--
-- forks.base_project  the family label for filters and chips: OneiOS |
--                     ios-sweet | HackiOS | UniXNU | Scion | Open Mapple |
--                     Jesvi-iOS | custom | ... ('' = not known yet).
-- repo_lineage        one row per (repo, base). base: OWNER/REPO when the base
--                     is a repo, else a project name. base_fork_id: set when
--                     the base is a tracked repo. relation: fork-of (the GitHub
--                     fork parent) | derived-from (copied or based on, per the
--                     README) | ported-from (parts ported in) | uses (a kernel,
--                     loader or tool it builds on). source: a README URL or
--                     "github:parent".

ALTER TABLE forks ADD COLUMN base_project TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_forks_base_project ON forks(base_project);

CREATE TABLE IF NOT EXISTS repo_lineage (
  fork_id      INTEGER NOT NULL REFERENCES forks(id),
  base         TEXT NOT NULL,
  base_fork_id INTEGER REFERENCES forks(id),
  relation     TEXT NOT NULL DEFAULT 'derived-from',
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fork_id, base)
);
CREATE INDEX IF NOT EXISTS idx_repo_lineage_base_fork ON repo_lineage(base_fork_id);
CREATE INDEX IF NOT EXISTS idx_repo_lineage_base ON repo_lineage(base COLLATE NOCASE);
