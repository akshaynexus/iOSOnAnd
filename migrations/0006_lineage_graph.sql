-- migrations/0006_lineage_graph.sql — repo lineage as a graph that also holds
-- repos the tracker does not list (the bases and parents of tracked repos).
--
-- 0005 keyed repo_lineage by (fork_id, base): one relation per base, tracked
-- repos only. The lineage data (scratchpad lineage.json) has repos with two
-- relations to the same base (a GitHub fork that the README also calls a
-- port) and untracked intermediate repos whose own bases keep a family tree
-- connected. 0005's table was never filled (it shipped with no data, in this
-- same change set), so it is rebuilt here rather than patched.
--
-- repo_lineage   one row per (repo, base, relation). repo: OWNER/REPO; fork_id
--                set when the repo is tracked; base_fork_id when the base is.
--                base_exists 0: GitHub answers 404 for that base (no link).
-- lineage_repos  repos that appear in the lineage but are not tracked (no
--                forks row): their family label and whether they exist.

DROP TABLE IF EXISTS repo_lineage;
CREATE TABLE repo_lineage (
  repo         TEXT NOT NULL,
  fork_id      INTEGER REFERENCES forks(id),
  base         TEXT NOT NULL,
  base_fork_id INTEGER REFERENCES forks(id),
  relation     TEXT NOT NULL DEFAULT 'derived-from', -- fork-of | derived-from | ported-from | uses
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',
  base_exists  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (repo, base, relation)
);
CREATE INDEX IF NOT EXISTS idx_repo_lineage_fork ON repo_lineage(fork_id);
CREATE INDEX IF NOT EXISTS idx_repo_lineage_base_fork ON repo_lineage(base_fork_id);
CREATE INDEX IF NOT EXISTS idx_repo_lineage_base ON repo_lineage(base COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS lineage_repos (
  repo         TEXT PRIMARY KEY,
  base_project TEXT NOT NULL DEFAULT '',
  repo_exists  INTEGER NOT NULL DEFAULT 1,
  description  TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT ''
);
