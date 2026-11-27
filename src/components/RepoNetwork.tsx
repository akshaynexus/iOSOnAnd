/**
 * "Repos" on a phone's page: the phone's repos as a network, each one under
 * the repo it forked from (or was derived or ported from), up to the project
 * it started from. The phone's own repos are full rows (how they support the
 * phone, the maintainer, the best result, the repos they use); their
 * ancestors are slim rows. The tree draws at once from each repo's own
 * `based_on`, and fills in grandparents from GET /api/lineage.
 */
import { useEffect, useMemo, useState } from "react";
import { GitBranch, GitFork, Package } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ForkDialog } from "@/components/ForkDialog";
import { RepoPorting } from "@/components/PortingRecords";
import { AddRepoToPhone, ContinuePortButton, ThisIsMine } from "@/components/RepoClaim";
import { isDependency, isUnclaimed } from "@/components/ClaimCallout";
import { VerifiedBadge } from "@/components/StatusBadge";
import { forkBranches, branchHref, forkHref } from "@/components/ReposTable";
import { familyName, supportPhrase, supportersOf } from "@/components/repoInfo";
import { RELATION_LABELS, getLineage, type Device, type Fork, type Lineage, type SupportedBy } from "@/lib/client";
import { cn } from "@/lib/utils";

/** The relations that place a repo under another; "uses" is shown as a chip instead. */
const TREE_RANK: Record<string, number> = { "fork-of": 0, "ported-from": 1, "derived-from": 2 };
const isRepo = (s: string) => /^[\w.-]+\/[\w.-]+$/.test(s);
const key = (s: string) => s.toLowerCase();

interface Edge {
  to: string;
  relation: string;
}

interface Node {
  repo: string;
  /** How it hangs under its parent, and the parent. */
  relation: string;
  parent?: string;
  children: Node[];
  /** On this phone: its support row and fork. */
  here?: SupportedBy;
  fork?: Fork;
  /** How many of this phone's repos are at or under it (roots with more go first). */
  weight: number;
}

const SUPPORT_TONE: Record<string, string> = {
  primary: "border-works/40 bg-works-soft text-works-fg",
  merged: "border-brand/40 bg-brand/10 text-brand",
  ported: "border-progress/40 bg-progress-soft text-progress-fg",
  claimed: "border-border bg-muted text-muted-foreground",
};

function RepoLinkText({ repo, href, strong }: { repo: string; href?: string; strong?: boolean }) {
  if (!isRepo(repo)) return <span className={cn("font-mono text-sm", strong && "font-semibold")}>{repo}</span>;
  const [owner, name] = repo.split("/");
  return (
    <a href={href ?? `https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" className="min-w-0 font-mono text-sm break-all hover:underline">
      <span className="text-muted-foreground">{owner}/</span>
      <span className={cn(strong && "font-semibold")}>{name}</span>
    </a>
  );
}

function maintainerOf(f: Fork | undefined) {
  if (!f) return null;
  const list = f.maintainers?.length ? f.maintainers : f.maintainer && typeof f.maintainer === "object" ? [f.maintainer] : [];
  return list.length ? list : null;
}

function PhoneRepoRow({ node, device, editable }: { node: Node; device: Device; editable: boolean }) {
  const record = (device.porting ?? []).find((p) => p.repo && key(p.repo) === key(node.repo));
  const s = node.here!;
  const f = node.fork;
  const people = maintainerOf(f);
  const branches = f ? forkBranches(f) : [];
  const uses = (f?.based_on ?? []).filter((b) => b.relation === "uses");
  const kind = s.kind === "upstream" ? "Main repo" : s.kind === "standalone" ? "Standalone" : "Fork";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-card-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {s.kind === "upstream" ? <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <GitFork className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <RepoLinkText repo={s.repo} href={f ? forkHref(f) : undefined} strong />
        <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium", SUPPORT_TONE[s.support] ?? SUPPORT_TONE.claimed)}>
          {s.support === "claimed" && f?.device_slug === device.slug ? (people ? "This phone's port" : "Port for this phone") : supportPhrase(s.support, s.via)}
        </span>
        {f ? <VerifiedBadge verified={f.verified} /> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {f && isUnclaimed(f) && !isDependency(f) ? (
            <ThisIsMine repo={s.repo} device={device.slug} devices={[{ slug: device.slug, name: device.name }]} label="Claim" />
          ) : null}
          {editable && f && f.device_slug === device.slug ? <ForkDialog deviceSlug={device.slug} fork={f} /> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {node.parent ? (
            <>
              {RELATION_LABELS[node.relation] ?? node.relation} <span className="font-mono text-foreground">{node.parent}</span>
            </>
          ) : (
            kind
          )}
        </span>
        {f?.base_project ? <span>{familyName(f.base_project)}</span> : null}
        {people ? (
          <span>
            by{" "}
            {people.map((p, i) => (
              <span key={p.id}>
                {i ? ", " : ""}
                <Link to="/u/$id" params={{ id: p.github_login || String(p.id) }} className="text-foreground underline-offset-4 hover:underline">
                  {p.github_login ? `@${p.github_login}` : p.display_name}
                </Link>
              </span>
            ))}
          </span>
        ) : f ? (
          <span>unclaimed</span>
        ) : null}
        {branches.length ? (
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" aria-hidden />
            {branches.slice(0, 3).map((b, i) => (
              <a key={b} href={branchHref(f!, b)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-foreground hover:underline">
                {i ? ", " : ""}
                {b}
              </a>
            ))}
          </span>
        ) : null}
      </div>
      {f?.best_result ? <p className="line-clamp-2 text-sm break-words">{f.best_result}</p> : s.note ? <p className="text-sm break-words text-muted-foreground">{s.note}</p> : null}
      {record ? <RepoPorting r={record} editable={editable} /> : null}
      {uses.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Uses</span>
          {uses.map((u) => (
            <a
              key={u.base}
              href={u.base_repo_url ?? (isRepo(u.base) ? `https://github.com/${u.base}` : undefined)}
              target="_blank"
              rel="noopener noreferrer"
              title={u.note || undefined}
              className="inline-flex h-5 items-center rounded-full border px-2 font-mono hover:bg-muted"
            >
              {u.base}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Branch({ nodes, device, editable, depth }: { nodes: Node[]; device: Device; editable: boolean; depth: number }) {
  return (
    <ul className={cn("flex flex-col gap-2", depth > 0 && "ml-3 border-l pl-5")}>
      {nodes.map((n) => (
        <li
          key={n.repo}
          className={cn(
            "relative flex flex-col gap-2",
            depth > 0 && "before:absolute before:top-[1.1rem] before:-left-5 before:w-4 before:border-t before:border-border",
          )}
        >
          {n.here ? (
            <PhoneRepoRow node={n} device={device} editable={editable} />
          ) : (
            <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
              <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <RepoLinkText repo={n.repo} />
              <span className="text-xs text-muted-foreground">
                {depth === 0 ? "upstream" : (RELATION_LABELS[n.relation] ?? n.relation).toLowerCase()}
              </span>
            </div>
          )}
          {n.children.length ? <Branch nodes={n.children} device={device} editable={editable} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function RepoNetwork({ device, editable }: { device: Device; editable: boolean }) {
  const supporters = useMemo(() => supportersOf(device), [device]);
  const forks = useMemo(() => new Map(device.forks.map((f) => [key(f.repo), f])), [device.forks]);
  const [lineage, setLineage] = useState<Lineage | null>(null);
  useEffect(() => {
    let live = true;
    getLineage().then((l) => live && setLineage(l), () => {});
    return () => {
      live = false;
    };
  }, []);

  const roots = useMemo(() => {
    // Parent edges: the repo's own based_on first, then the full lineage graph.
    const parents = new Map<string, Edge[]>();
    const add = (from: string, to: string, relation: string) => {
      if (!(relation in TREE_RANK) || key(from) === key(to)) return;
      const list = parents.get(key(from)) ?? [];
      if (!list.some((e) => key(e.to) === key(to))) list.push({ to, relation });
      parents.set(key(from), list);
    };
    for (const f of device.forks) for (const b of f.based_on ?? []) add(f.repo, b.base, b.relation);
    for (const e of lineage?.edges ?? []) add(e.from, e.to, e.relation);
    const parentOf = (repo: string) =>
      [...(parents.get(key(repo)) ?? [])].sort((a, b) => (TREE_RANK[a.relation] ?? 9) - (TREE_RANK[b.relation] ?? 9))[0];

    const nodes = new Map<string, Node>();
    const node = (repo: string) => {
      let n = nodes.get(key(repo));
      if (!n) nodes.set(key(repo), (n = { repo, relation: "", children: [], weight: 0 }));
      return n;
    };
    const parentKey = new Map<string, string>();
    for (const s of supporters) {
      const n = node(s.repo);
      n.here = s;
      n.fork = forks.get(key(s.repo));
      // Walk up to the project it started from (at most 6 steps, no loops).
      let cur = s.repo;
      const seen = new Set([key(cur)]);
      for (let i = 0; i < 6; i++) {
        const p = parentOf(cur);
        if (!p || seen.has(key(p.to))) break;
        seen.add(key(p.to));
        const child = node(cur);
        if (!parentKey.has(key(cur))) {
          child.relation = p.relation;
          child.parent = p.to;
          parentKey.set(key(cur), key(p.to));
        }
        node(p.to);
        cur = p.to;
      }
    }
    for (const [c, p] of parentKey) {
      const parent = nodes.get(p)!;
      const child = nodes.get(c)!;
      if (!parent.children.includes(child)) parent.children.push(child);
    }
    const weigh = (n: Node): number => (n.weight = (n.here ? 1 : 0) + n.children.reduce((s, c) => s + weigh(c), 0));
    // The family with the phone's own repo (main, then its own fork) comes first; repos ported in from elsewhere after.
    const RANK: Record<string, number> = { primary: 0, claimed: 1, merged: 2, ported: 3 };
    const best = (n: Node): number => Math.min(n.here ? (RANK[n.here.support] ?? 4) : 9, ...n.children.map(best));
    const order = (list: Node[]) => {
      list.sort((a, b) => best(a) - best(b) || b.weight - a.weight || a.repo.localeCompare(b.repo));
      for (const n of list) order(n.children);
      return list;
    };
    const top = [...nodes.values()].filter((n) => !parentKey.has(key(n.repo)));
    top.forEach(weigh);
    return order(top);
  }, [supporters, forks, device.forks, lineage]);

  // Porting records of repos that are not in the tree (e.g. a framework's in-tree board).
  const loose = (device.porting ?? []).filter((p) => !p.repo || !supporters.some((s) => key(s.repo) === key(p.repo)));
  const count = supporters.length;
  const upstream = supporters.filter((s) => s.kind === "upstream").length;
  return (
    <section aria-labelledby="repos-heading" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id="repos-heading" className="text-base font-semibold">
            Repos <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
          </h2>
          {count ? (
            <span className="truncate text-xs text-muted-foreground">
              {roots.length === 1 ? "one family" : `${roots.length} families`}
              {upstream ? `, ${upstream} main repo${upstream === 1 ? "" : "s"}` : ""}
            </span>
          ) : null}
        </div>
        <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {count ? (
            <ContinuePortButton device={device.slug} deviceName={device.name} repo={(supporters.find((s) => s.support === "primary") ?? supporters[0])?.repo} soc={device.soc} gpu={device.gpu} />
          ) : null}
          <AddRepoToPhone device={{ slug: device.slug, name: device.name }} />
          {editable ? <ForkDialog deviceSlug={device.slug} /> : null}
        </span>
      </div>
      {count === 0 ? (
        <p className="rounded-[14px] border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No repo for this phone yet.</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] border bg-muted/20 p-3 sm:p-4">
          <Branch nodes={roots} device={device} editable={editable} depth={0} />
          {loose.length ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              {loose.map((r) => (
                <div key={r.key} className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">{r.repo || r.record}</span>
                  <RepoPorting r={r} editable={editable} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

