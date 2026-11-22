import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ApiRequestError, RELATION_LABELS, getLineage, type Lineage } from "@/lib/client";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  relation: string | null;
  tracked: boolean;
  children: TreeNode[];
}

/**
 * Turn /api/lineage into one tree per family. An edge reads "from is based on
 * to" (from = the repo, to = its base). A base that is not a tracked repo (a
 * project name such as "HackiOS") becomes a root of its own.
 */
export function buildForest(data: Lineage): { family: string; roots: TreeNode[]; size: number }[] {
  const tracked = new Map(data.nodes.map((n) => [n.repo, n]));
  const parentOf = new Map<string, { to: string; relation: string }>();
  for (const e of data.edges) if (!parentOf.has(e.from) && e.from !== e.to) parentOf.set(e.from, { to: e.to, relation: e.relation });

  const nodes = new Map<string, TreeNode>();
  const get = (name: string): TreeNode => {
    let n = nodes.get(name);
    if (!n) {
      n = { name, relation: parentOf.get(name)?.relation ?? null, tracked: tracked.has(name), children: [] };
      nodes.set(name, n);
    }
    return n;
  };
  for (const n of data.nodes) get(n.repo);
  for (const [child, { to }] of parentOf) get(to).children.push(get(child));

  // A node whose chain of parents loops is cut at the loop.
  const rootOf = (name: string): string => {
    const seen = new Set<string>();
    let cur = name;
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!.to;
    }
    return cur;
  };
  const roots = new Set<string>();
  for (const name of nodes.keys()) roots.add(rootOf(name));

  const familyOf = (root: string): string => {
    const own = tracked.get(root)?.base_project;
    if (own) return own;
    const walk = (n: TreeNode): string | null => {
      for (const c of n.children) {
        const f = tracked.get(c.name)?.base_project || walk(c);
        if (f) return f;
      }
      return null;
    };
    return walk(nodes.get(root)!) || root;
  };
  const count = (n: TreeNode): number => (n.tracked ? 1 : 0) + n.children.reduce((s, c) => s + count(c), 0);
  const sortTree = (n: TreeNode) => {
    n.children.sort((a, b) => count(b) - count(a) || a.name.localeCompare(b.name));
    n.children.forEach(sortTree);
  };

  const families = new Map<string, TreeNode[]>();
  for (const r of roots) {
    const node = nodes.get(r)!;
    sortTree(node);
    const fam = familyOf(r);
    families.set(fam, [...(families.get(fam) ?? []), node]);
  }
  return [...families.entries()]
    .map(([family, rs]) => ({ family, roots: rs, size: rs.reduce((s, n) => s + count(n), 0) }))
    .filter((f) => f.size > 0)
    .sort((a, b) => b.size - a.size || a.family.localeCompare(b.family));
}

function Branch({ node, depth }: { node: TreeNode; depth: number }) {
  const short = node.name;
  return (
    <li className={cn(depth > 0 && "lineage-item")}>
      <span className="inline-flex max-w-full items-baseline gap-1.5">
        {node.tracked && node.name.includes("/") ? (
          <a
            href={`https://github.com/${node.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-mono text-xs hover:underline"
          >
            {short}
          </a>
        ) : (
          <span className="truncate text-xs font-medium">{short}</span>
        )}
        {depth > 0 && node.relation ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {(RELATION_LABELS[node.relation] ?? node.relation).toLowerCase()}
          </span>
        ) : null}
      </span>
      {node.children.length > 0 ? (
        <ul className="lineage-list">
          {node.children.map((c) => (
            <Branch key={c.name} node={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The family tree of all repos (from GET /api/lineage), folded by default. Hidden while the API lacks it. */
export function LineageTree() {
  const [data, setData] = useState<Lineage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getLineage()
      .then((d) => {
        if (alive && d && Array.isArray(d.nodes) && Array.isArray(d.edges)) setData(d);
        else if (alive) setFailed(true);
      })
      .catch((err) => {
        if (alive) setFailed(true);
        if (!(err instanceof ApiRequestError)) console.warn(err);
      });
    return () => {
      alive = false;
    };
  }, []);

  const forest = useMemo(() => (data ? buildForest(data) : []), [data]);
  if (failed || !data || forest.length === 0) return null;

  return (
    <section aria-labelledby="lineage-heading" className="rounded-xl border">
      <h2 id="lineage-heading" className="text-base font-semibold">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Family tree
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{forest.length} bases</span>
          <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h2>
      {open ? (
        <div className="grid gap-x-6 gap-y-5 border-t px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {forest.map((f) => (
            <div key={f.family} className="min-w-0">
              <p className="mb-1.5 text-sm font-medium">
                {f.family} <span className="font-normal text-muted-foreground tabular-nums">{f.size}</span>
              </p>
              <ul className="flex flex-col gap-1">
                {f.roots.map((r) => (
                  <Branch key={r.name} node={r} depth={0} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
