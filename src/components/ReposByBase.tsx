/**
 * The repos grouped by what they are built on: each main (or standalone) repo
 * heads a group with its forks and ports under it, forks of forks indented
 * below their parent. Repos built on something the tracker does not list are
 * grouped under that base's name; repos that record no base come last, then
 * the main repos nothing here is built on yet.
 */
import { useMemo, useState } from "react";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/Field";
import { Reveal } from "@/components/motion";
import { familyOfFork } from "@/components/repoInfo";
import {
  CopyClone,
  FILTER,
  FILTER_LABEL,
  MainRepos,
  RepoActions,
  SupportChips,
  SupportLegend,
  branchHref,
  cloneCommand,
  forkBranches,
  forkHref,
  type ForkRowItem,
} from "@/components/ReposTable";
import { ForkDialog } from "@/components/ForkDialog";
import { LinkedText } from "@/components/SourceLink";
import { CodeLine } from "@/components/ProfileParts";
import { Thumb } from "@/components/ProjectsSection";
import { SegmentBar } from "@/components/DeviceCard";
import { applicableAreas, stateCounts } from "@/lib/areas";
import { VerifiedBadge } from "@/components/StatusBadge";
import { RELATION_LABELS, forkKind, forkMaintainer, type Area, type BasedOn, type Device, type Fork } from "@/lib/client";
import { cn, formatDate, relativeTime } from "@/lib/utils";

/** Rows a group shows before "Show all". */
const GROUP_PAGE = 5;
const PARENT_RANK: Record<string, number> = { "fork-of": 0, "derived-from": 1, "ported-from": 2 };
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** What a repo is built on: its closest fork-of, derived-from or ported-from base ("uses" is not a parent). */
function parentOf(f: Fork): BasedOn | null {
  const list = (Array.isArray(f.based_on) ? f.based_on : []).filter((b) => b.relation in PARENT_RANK);
  list.sort((a, b) => PARENT_RANK[a.relation] - PARENT_RANK[b.relation]);
  return list[0] ?? null;
}

export interface BaseGroup {
  key: string;
  /** The tracked main or standalone repo at the root. */
  head?: Fork;
  /** The root's name when it is not tracked here ("" for "no base recorded"). */
  base: string;
  baseUrl?: string | null;
  rows: ForkRowItem[];
}

/**
 * Group the forks in `shown` under the repo at the root of their lineage,
 * looking bases up in `all`. Within a group: depth-first, forks of a fork
 * right under it; siblings by `score` (how far along), then by name.
 */
export function groupByBase(shown: Fork[], all: Fork[], score: (f: Fork) => number = () => 0): BaseGroup[] {
  const byRepo = new Map(all.map((f) => [lc(f.repo), f]));
  const plain = all.filter((f) => forkKind(f) === "fork");
  const visible = new Set(shown.map((f) => f.id));

  // The tracked fork a fork was made from, if any: the tree inside a group.
  const treeParent = new Map<number, Fork>();
  for (const f of plain) {
    const p = parentOf(f);
    const t = p ? byRepo.get(lc(p.base)) : undefined;
    if (t && t.id !== f.id && forkKind(t) === "fork") treeParent.set(f.id, t);
  }

  // The group of a fork: walk up the tracked forks to the root.
  function rootOf(f: Fork): Omit<BaseGroup, "rows"> {
    const seen = new Set<number>([f.id]);
    let cur = f;
    for (;;) {
      const p = parentOf(cur);
      if (!p) return { key: "none", base: "" };
      const t = byRepo.get(lc(p.base));
      if (!t) return { key: `base:${lc(p.base)}`, base: p.base, baseUrl: p.base_repo_url };
      if (forkKind(t) !== "fork") return { key: `repo:${lc(t.repo)}`, head: t, base: t.repo };
      if (seen.has(t.id)) return { key: "none", base: "" };
      seen.add(t.id);
      cur = t;
    }
  }

  const children = new Map<number, Fork[]>();
  const tops = new Map<string, { root: Omit<BaseGroup, "rows">; forks: Fork[] }>();
  for (const f of plain) {
    const parent = treeParent.get(f.id);
    if (parent) {
      children.set(parent.id, [...(children.get(parent.id) ?? []), f]);
      continue;
    }
    const root = rootOf(f);
    const g = tops.get(root.key) ?? { root, forks: [] };
    g.forks.push(f);
    tops.set(root.key, g);
  }
  // A cycle of forks has no top: start it from its first member.
  const placed = new Set<number>();
  // Furthest along first: then the ones that report a result, then the newest.
  const order = (list: Fork[]) =>
    [...list].sort(
      (a, b) =>
        score(b) - score(a) ||
        Number(!!b.best_result) - Number(!!a.best_result) ||
        (b.updated || "").localeCompare(a.updated || "") ||
        a.repo.localeCompare(b.repo),
    );

  function lineage(f: Fork, depth: number, root: Omit<BaseGroup, "rows">): string | undefined {
    const p = parentOf(f);
    if (!p) return undefined;
    const label = RELATION_LABELS[p.relation] ?? p.relation;
    if (depth > 0) return `${label} ${p.base}`;
    return p.relation === "fork-of" ? undefined : `${label} ${root.base}`;
  }

  const groups: BaseGroup[] = [];
  for (const { root, forks } of tops.values()) {
    const rows: ForkRowItem[] = [];
    const visit = (f: Fork, depth: number) => {
      if (placed.has(f.id)) return;
      placed.add(f.id);
      if (visible.has(f.id)) rows.push({ fork: f, depth, lineage: lineage(f, depth, root) });
      for (const c of order(children.get(f.id) ?? [])) visit(c, depth + 1);
    };
    for (const f of order(forks)) visit(f, 0);
    if (rows.length) groups.push({ ...root, rows });
  }
  const leftover = shown.filter((f) => forkKind(f) === "fork" && !placed.has(f.id));
  if (leftover.length) {
    const none = groups.find((g) => g.key === "none");
    const rows = order(leftover).map((fork) => ({ fork }));
    if (none) none.rows.push(...rows);
    else groups.push({ key: "none", base: "", rows });
  }

  // Bases off the tracker with one repo each: one "Other bases" group, each row naming its base.
  const single = groups.filter((g) => !g.head && g.key !== "none" && g.rows.length < 2);
  if (single.length > 1) {
    const rows = single.flatMap((g) =>
      g.rows.map((r) => {
        const p = parentOf(r.fork);
        return { ...r, lineage: r.lineage ?? `${RELATION_LABELS[p?.relation ?? "fork-of"] ?? "Fork of"} ${g.base}` };
      }),
    );
    for (const g of single) groups.splice(groups.indexOf(g), 1);
    groups.push({ key: "other", base: "Other bases", rows });
  }

  const rank = (g: BaseGroup) => (g.head ? 0 : g.key === "none" ? 3 : g.key === "other" ? 2 : 1);
  return groups.sort((a, b) => rank(a) - rank(b) || b.rows.length - a.rows.length || a.base.localeCompare(b.base));
}

/** A GitHub account's avatar; nothing when it does not load. */
function Avatar({ owner, className }: { owner: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!owner || failed) return <span aria-hidden className={cn("shrink-0 rounded-full bg-muted", className)} />;
  return (
    <img
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=64`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-muted object-cover", className)}
    />
  );
}

const ownerOf = (repo: string) => (repo.includes("/") ? repo.split("/")[0] : "");
const nameOf = (repo: string) => (repo.includes("/") ? repo.split("/").slice(1).join("/") : repo);

/** How far a repo's phone has got: areas that work, of those that apply. */
function progressOf(f: Fork, devices: Map<string, Device>, areas: Area[]) {
  const d = f.device_slug ? devices.get(f.device_slug) : undefined;
  if (!d) return null;
  return { device: d, counts: stateCounts(d, areas), total: applicableAreas(d, areas).length };
}

/** One fork: its phone first (what people look for), then the repo, the result and how far the phone has got. */
function RepoRow({
  item,
  devices,
  areas,
  all,
  deviceList,
  canEdit,
}: {
  item: ForkRowItem;
  devices: Map<string, Device>;
  areas: Area[];
  all: Fork[];
  deviceList: { slug: string; name: string }[];
  canEdit?: (slug: string) => boolean;
}) {
  const { fork: f, depth = 0, lineage } = item;
  const [open, setOpen] = useState(false);
  const p = progressOf(f, devices, areas);
  const maintainer = forkMaintainer(f);
  const branches = forkBranches(f);
  const more = Array.isArray(f.supports) && f.supports.length > 1 ? f.supports.length - 1 : 0;
  const detailsId = `repo-${f.id}-details`;
  return (
    <li className={cn("min-w-0", open && "bg-muted/30")}>
      <div className="flex items-start gap-3 px-3 py-2.5 sm:items-center sm:px-4" style={depth ? { paddingLeft: `calc(${depth} * 1.25rem + 1rem)` } : undefined}>
        {depth > 0 ? <CornerDownRight className="-ml-1 size-3.5 shrink-0 text-muted-foreground" aria-label="Built on the repo above" /> : null}
        {p ? <Thumb device={p.device} className="size-10 shrink-0 bg-card" /> : <span aria-hidden className="size-10 shrink-0 rounded-lg border border-dashed" />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {p ? (
              <Link to="/device/$slug" params={{ slug: p.device.slug }} className="truncate font-medium hover:underline">
                {p.device.name}
              </Link>
            ) : (
              <span className="truncate font-medium text-muted-foreground">No phone yet</span>
            )}
            {more ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">+{more}</span> : null}
            {f.verified !== "fork-claim" ? <VerifiedBadge verified={f.verified} /> : null}
            {p ? (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums sm:hidden">
                {p.counts.works}/{p.total}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar owner={ownerOf(f.repo)} className="size-4" />
            <a href={forkHref(f)} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-mono hover:text-foreground hover:underline">
              {ownerOf(f.repo) ? `${ownerOf(f.repo)}/` : ""}
              <span className="text-foreground/80">{nameOf(f.repo)}</span>
            </a>
            {branches[0] ? <span className="hidden shrink-0 font-mono sm:inline">@{branches[0]}</span> : null}
            {lineage ? <span className="hidden min-w-0 truncate md:inline">· {lineage}</span> : null}
          </div>
          {f.best_result ? (
            <p className="line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1" title={f.best_result}>
              {f.best_result}
            </p>
          ) : null}
        </div>
        {p ? (
          <div className="hidden w-32 shrink-0 flex-col gap-1 sm:flex" title={`Areas that work on the ${p.device.name}, from every repo`}>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {p.counts.works} of {p.total} work
            </span>
            <SegmentBar counts={p.counts} className="h-1.5 bg-foreground/10" />
          </div>
        ) : (
          <div className="hidden w-32 shrink-0 sm:block" />
        )}
        <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground lg:block" suppressHydrationWarning>
          {f.updated ? relativeTime(f.updated) : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={open ? `Hide ${f.repo}` : `More on ${f.repo}`}
        >
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {open ? (
        <div id={detailsId} className="flex flex-col gap-3 px-4 pb-4 sm:pl-[4.25rem]">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
            {lineage ? (
              <>
                <dt className="text-muted-foreground">Built on</dt>
                <dd className="min-w-0 break-words">{lineage}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Maintainer</dt>
            <dd className="min-w-0">{maintainer ?? "Nobody has claimed it yet"}</dd>
            {branches.length ? (
              <>
                <dt className="text-muted-foreground">Branches</dt>
                <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                  {branches.map((b) => (
                    <a key={b} href={branchHref(f, b)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs underline-offset-4 hover:underline">
                      {b}
                    </a>
                  ))}
                </dd>
              </>
            ) : null}
            {more ? (
              <>
                <dt className="text-muted-foreground">Phones</dt>
                <dd className="min-w-0">
                  <SupportChips fork={f} />
                </dd>
              </>
            ) : null}
            {(
              [
                ["Ported back", f.ported],
                ["Fork only", f.fork_only],
                ["Notes", f.notes],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">
                    <LinkedText text={v} />
                  </dd>
                </div>
              ))}
            <dt className="text-muted-foreground">Updated</dt>
            <dd suppressHydrationWarning>{f.updated ? formatDate(f.updated) : "Unknown"}</dd>
          </dl>
          <CodeLine text={cloneCommand(f)} label="Copy" />
          <div className="flex flex-wrap items-center gap-2">
            <RepoActions fork={f} devices={deviceList} areas={areas} forks={all} compact />
            {canEdit && f.device_slug && canEdit(f.device_slug) ? <ForkDialog deviceSlug={f.device_slug} fork={f} /> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export const groupAnchor = (g: BaseGroup) => `base-${g.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

function GroupCard({
  g,
  all,
  devices,
  deviceList,
  areas,
  canEdit,
}: {
  g: BaseGroup;
  all: Fork[];
  devices: Map<string, Device>;
  deviceList: { slug: string; name: string }[];
  areas: Area[];
  canEdit?: (slug: string) => boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const n = g.rows.length;
  const rows = showAll ? g.rows : g.rows.slice(0, GROUP_PAGE);
  const boots = g.rows.filter((r) => {
    const d = r.fork.device_slug ? devices.get(r.fork.device_slug) : undefined;
    return d?.statuses?.some((s) => s.area_slug === "boot" && s.state === "works");
  }).length;
  const h = g.head;
  const kind = h ? (forkKind(h) === "upstream" ? "Main repo" : "Standalone port") : g.key === "none" || g.key === "other" ? "" : "Not on the tracker";
  const family = h ? familyOfFork(h) : null;
  const maintainer = h ? forkMaintainer(h) : null;
  const title = h?.repo ?? (g.key === "none" ? "Base not recorded" : g.base);
  const href = h ? forkHref(h) : g.key !== "other" && g.base.includes("/") ? g.baseUrl || `https://github.com/${g.base}` : null;
  const bodyId = `${groupAnchor(g)}-rows`;
  return (
    <article id={groupAnchor(g)} aria-label={title} className="flex min-w-0 scroll-mt-20 flex-col overflow-hidden rounded-[14px] border bg-card text-card-foreground">
      <header className="flex items-start gap-3 p-4">
        {g.key === "none" || g.key === "other" ? (
          <span aria-hidden className="size-10 shrink-0 rounded-lg border border-dashed" />
        ) : (
          <Avatar owner={ownerOf(title)} className="size-10 rounded-lg" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h3 className="min-w-0 text-[15px] font-semibold break-all">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {title}
                </a>
              ) : (
                title
              )}
            </h3>
            {kind || family ? <span className="text-xs text-muted-foreground">{[kind, family].filter(Boolean).join(" · ")}</span> : null}
          </div>
          {h?.best_result ? <p className="line-clamp-2 text-sm text-muted-foreground">{h.best_result}</p> : null}
          {g.key === "none" ? <p className="text-sm text-muted-foreground">These repos don&apos;t say what they are built on yet.</p> : null}
          {g.key === "other" ? <p className="text-sm text-muted-foreground">Each built on a repo the tracker doesn&apos;t list; the row names it.</p> : null}
          <p className="text-xs text-muted-foreground tabular-nums">
            {[
              `${n} ${n === 1 ? "fork or port" : "forks and ports"}`,
              boots ? `${boots} on phones that boot to Home` : null,
              h ? (maintainer ? `maintained by ${maintainer}` : "unclaimed") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {h && Array.isArray(h.supports) && h.supports.length ? (
            <div className="pt-1">
              <SupportChips fork={h} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {h ? (
            <span className="hidden items-center gap-1 sm:flex">
              <RepoActions fork={h} devices={deviceList} areas={areas} forks={all} compact />
              <CopyClone fork={h} />
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? `Show the repos built on ${title}` : `Hide the repos built on ${title}`}
          >
            <ChevronDown className={cn("transition-transform", !collapsed && "rotate-180")} />
          </Button>
        </div>
      </header>
      {collapsed ? null : (
        <div id={bodyId} className="border-t">
          <ul className="divide-y">
            {rows.map((item) => (
              <RepoRow key={item.fork.id} item={item} devices={devices} areas={areas} all={all} deviceList={deviceList} canEdit={canEdit} />
            ))}
          </ul>
          {n > GROUP_PAGE ? (
            <div className="flex justify-center border-t p-1.5">
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show fewer" : `Show all ${n}`}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function ReposByBase({
  forks,
  all,
  devices: deviceRows,
  deviceNames,
  areas,
  canEdit,
  family,
  onFamily,
  device,
  onDevice,
}: {
  /** The repos to show (the search applied). */
  forks: Fork[];
  /** Every repo, to look bases up. */
  all: Fork[];
  /** Every phone, for photos and how far each has got. */
  devices: Device[];
  deviceNames: Record<string, string>;
  areas: Area[];
  canEdit?: (slug: string) => boolean;
  family: string;
  onFamily: (family: string) => void;
  device?: string;
  onDevice: (slug: string | undefined) => void;
}) {
  const devices = useMemo(() => Object.entries(deviceNames).map(([slug, name]) => ({ slug, name })), [deviceNames]);
  const familyOk = (f: Fork) =>
    !family || (family === "unknown" ? !familyOfFork(f) : lc(familyOfFork(f)) === lc(family));
  const deviceOk = (f: Fork) =>
    !device ||
    (device === "none"
      ? !f.device_slug
      : f.device_slug === device || (Array.isArray(f.supports) && f.supports.some((s) => s.device_slug === device)));

  const shown = useMemo(() => forks.filter((f) => familyOk(f) && deviceOk(f)), [forks, family, device]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDevice = useMemo(() => new Map(deviceRows.map((d) => [d.slug, d])), [deviceRows]);
  const groups = useMemo(() => {
    const works = (f: Fork) => {
      const d = f.device_slug ? byDevice.get(f.device_slug) : undefined;
      return d ? stateCounts(d, areas).works : -1;
    };
    return groupByBase(shown, all, works);
  }, [shown, all, byDevice, areas]);
  const headed = new Set(groups.map((g) => g.head?.id).filter((x): x is number => x != null));
  const lone = shown.filter((f) => forkKind(f) !== "fork" && !headed.has(f.id));

  const deviceOptions = useMemo(() => {
    const slugs = [...new Set(forks.map((f) => f.device_slug).filter((s): s is string => !!s))];
    return slugs.map((s) => ({ slug: s, name: deviceNames[s] ?? s })).sort((a, b) => a.name.localeCompare(b.name));
  }, [forks, deviceNames]);
  const families = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of forks) {
      const k = familyOfFork(f);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [forks]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2 md:items-center">
        <div className={FILTER}>
          <label htmlFor="base-device" className={FILTER_LABEL}>
            Phone
          </label>
          <NativeSelect
            id="base-device"
            value={device ?? ""}
            onChange={(e) => onDevice(e.target.value || undefined)}
            className="h-8 md:w-auto md:min-w-44"
          >
            <option value="">All phones</option>
            {deviceOptions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
            <option value="none">No phone</option>
          </NativeSelect>
        </div>
        <div className={cn(FILTER, "md:ml-2")}>
          <label htmlFor="base-family" className={FILTER_LABEL}>
            Project
          </label>
          <NativeSelect
            id="base-family"
            value={families.find(([k]) => lc(k) === lc(family))?.[0] ?? family}
            onChange={(e) => onFamily(e.target.value)}
            className="h-8 md:w-auto md:min-w-36"
          >
            <option value="">Any project</option>
            {families.map(([k, n]) => (
              <option key={k} value={k}>
                {k} ({n})
              </option>
            ))}
            <option value="unknown">Not recorded</option>
          </NativeSelect>
        </div>
        <span className="pb-2.5 text-sm text-muted-foreground tabular-nums md:ml-auto md:pb-0" aria-live="polite">
          {groups.length} {groups.length === 1 ? "base" : "bases"}, {shown.filter((f) => forkKind(f) === "fork").length} forks and ports
        </span>
      </div>

      {groups.length === 0 && lone.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">No repos match.</p>
      ) : null}

      {groups.length > 2 ? (
        <nav aria-label="Bases" className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <a
              key={g.key}
              href={`#${groupAnchor(g)}`}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs hover:bg-muted pointer-coarse:h-9"
            >
              <span className="truncate">{g.head ? nameOf(g.head.repo) : g.key === "none" ? "Base not recorded" : g.key === "other" ? "Other bases" : nameOf(g.base)}</span>
              <span className="text-muted-foreground tabular-nums">{g.rows.length}</span>
            </a>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <Reveal key={g.key}>
            <GroupCard g={g} all={all} devices={byDevice} deviceList={devices} areas={areas} canEdit={canEdit} />
          </Reveal>
        ))}
      </div>

      {lone.length ? (
        <div className="flex flex-col gap-3 pt-4">
          <MainRepos forks={lone} deviceNames={deviceNames} areas={areas} title="Main repos with no forks here yet" />
        </div>
      ) : (
        <div className="flex justify-end">
          <SupportLegend />
        </div>
      )}
    </div>
  );
}
