// GET /api/lineage — the repo family tree (public). Nodes: every tracked repo
// (tracked: true), every untracked repo the lineage names (lineage_repos, or
// a base that is no repo row: tracked: false; exists: false when GitHub
// answers 404). Edges: one per repo_lineage row, {from: the repo, to: what it
// is based on, relation}. families: label -> number of tracked repos.

import { createFileRoute } from '@tanstack/react-router';
import { queryAll } from '@/lib/db';
import { json } from '@/lib/auth';
import { apiHandlers } from '@/lib/api';

interface Node {
  repo: string;
  base_project: string;
  device_slug: string | null;
  kind: string;
  tracked: boolean;
  exists: boolean;
}

async function handleGet(): Promise<Response> {
  const [forks, extra, edges] = await Promise.all([
    queryAll<{ repo: string; base_project: string; device_slug: string | null; kind: string }>(
      'SELECT repo, base_project, device_slug, kind FROM forks ORDER BY repo COLLATE NOCASE',
    ),
    queryAll<{ repo: string; base_project: string; repo_exists: number }>('SELECT repo, base_project, repo_exists FROM lineage_repos ORDER BY repo COLLATE NOCASE'),
    queryAll<{ repo: string; base: string; base_repo: string | null; relation: string; base_exists: number }>(
      `SELECT l.repo, l.base, b.repo AS base_repo, l.relation, l.base_exists
         FROM repo_lineage l LEFT JOIN forks b ON b.id = l.base_fork_id
        ORDER BY l.repo COLLATE NOCASE, l.base, l.relation`,
    ),
  ]);
  const nodes: Node[] = forks.map((f) => ({ repo: f.repo, base_project: f.base_project ?? '', device_slug: f.device_slug, kind: f.kind, tracked: true, exists: true }));
  const known = new Map(nodes.map((n) => [n.repo.toLowerCase(), n]));
  const add = (n: Node) => {
    if (!known.has(n.repo.toLowerCase())) {
      known.set(n.repo.toLowerCase(), n);
      nodes.push(n);
    }
  };
  for (const x of extra) add({ repo: x.repo, base_project: x.base_project ?? '', device_slug: null, kind: 'external', tracked: false, exists: Number(x.repo_exists) !== 0 });
  for (const e of edges) {
    add({ repo: e.repo, base_project: '', device_slug: null, kind: 'external', tracked: false, exists: true });
    add({ repo: e.base_repo ?? e.base, base_project: '', device_slug: null, kind: 'external', tracked: false, exists: Number(e.base_exists) !== 0 });
  }
  const families: Record<string, number> = {};
  for (const f of forks) if (f.base_project) families[f.base_project] = (families[f.base_project] ?? 0) + 1;
  return json({
    nodes,
    edges: edges.map((e) => ({ from: e.repo, to: e.base_repo ?? e.base, relation: e.relation })),
    families,
  });
}

export const Route = createFileRoute('/api/lineage')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
