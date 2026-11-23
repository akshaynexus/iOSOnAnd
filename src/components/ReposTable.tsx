import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LinkedText } from "@/components/SourceLink";
import { NativeSelect } from "@/components/Field";
import { ForkDialog } from "@/components/ForkDialog";
import { VERIFIED_RANK, VerifiedBadge } from "@/components/StatusBadge";
import { ThisIsMine } from "@/components/RepoClaim";
import { UploadButton } from "@/components/Media";
import { useAuth } from "@/components/auth";
import { familyOfFork, supportPhrase, SUPPORT_LABELS } from "@/components/repoInfo";
import { RELATION_LABELS, forkKind, forkMaintainer, type Area, type BasedOn, type Fork } from "@/lib/client";
import { cn } from "@/lib/utils";

const MAIN_PAGE = 6;

export function forkHref(fork: Pick<Fork, "repo" | "url">): string {
  return fork.url && /^https?:\/\//.test(fork.url) ? fork.url : `https://github.com/${fork.repo}`;
}

export function cloneCommand(fork: Pick<Fork, "repo" | "branch" | "url">): string {
  const url = forkHref(fork);
  return fork.branch ? `git clone --branch ${fork.branch} ${url}` : `git clone ${url}`;
}

function CopyClone({ fork }: { fork: Fork }) {
  const cmd = cloneCommand(fork);
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success("Clone command copied", { description: cmd });
    } catch {
      toast.error("Copy failed", { description: cmd });
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground/70 hover:text-foreground"
      onClick={() => void copy()}
      aria-label={`Copy: ${cmd}`}
      title={`Copy: ${cmd}`}
    >
      <Copy />
    </Button>
  );
}

const CHIP = "inline-flex h-6 max-w-44 items-center gap-1 rounded-full border px-2 text-xs whitespace-nowrap pointer-coarse:h-8 pointer-coarse:px-2.5";

/** One "based on" entry: the base's short name; relation and note on hover. */
function BaseChip({ b }: { b: BasedOn }) {
  const name = b.base.includes("/") ? b.base.split("/")[1] : b.base;
  const title = [`${RELATION_LABELS[b.relation] ?? b.relation} ${b.base}`, b.note].filter(Boolean).join(". ");
  return b.base_repo_url ? (
    <a href={b.base_repo_url} target="_blank" rel="noopener noreferrer" title={title} className={cn(CHIP, "hover:bg-muted")}>
      <span className="truncate">{name}</span>
    </a>
  ) : (
    <span title={title} className={CHIP}>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** "Based on" for a repo: chips from based_on, else its family label. */
const RELATION_RANK: Record<string, number> = { "fork-of": 0, "derived-from": 1, "ported-from": 2, uses: 3 };

/** One entry per base (the closest relation first), fork-of before derived-from, ported-from, uses. */
export function uniqueBases(list: BasedOn[], byShortName = true): BasedOn[] {
  const byBase = new Map<string, BasedOn>();
  for (const b of [...list].sort((x, y) => (RELATION_RANK[x.relation] ?? 9) - (RELATION_RANK[y.relation] ?? 9))) {
    // "akshaynexus/OneiOS" and "OneiOS" read the same on a chip: one entry.
    const key = (byShortName && b.base.includes("/") ? b.base.split("/")[1] : b.base).toLowerCase();
    const had = byBase.get(key);
    if (!had) byBase.set(key, { ...b });
    else if (b.note && !had.note) had.note = b.note;
  }
  return [...byBase.values()];
}

export function BasedOnChips({
  fork,
  empty = true,
  max = 2,
}: {
  fork: Pick<Fork, "based_on" | "base_project" | "kind" | "repo">;
  empty?: boolean;
  /** Chips shown before "+N" (all of them on its hover). */
  max?: number;
}) {
  const list = uniqueBases(Array.isArray(fork.based_on) ? fork.based_on : []);
  if (list.length > 0) {
    const shown = list.slice(0, max);
    const rest = list.slice(max);
    return (
      <span className={cn("flex min-w-0 gap-1", max <= 1 ? "flex-nowrap [&>*:first-child]:max-w-36" : "flex-wrap")}>
        {shown.map((b) => (
          <BaseChip key={b.base} b={b} />
        ))}
        {rest.length > 0 ? (
          <span
            className={cn(CHIP, "text-muted-foreground")}
            title={rest.map((b) => `${RELATION_LABELS[b.relation] ?? b.relation} ${b.base}`).join("\n")}
          >
            +{rest.length}
          </span>
        ) : null}
      </span>
    );
  }
  if (forkKind(fork) === "upstream") return <span className="text-muted-foreground">Original project</span>;
  const family = familyOfFork(fork);
  if (family) return <span className={CHIP}>{family}</span>;
  return empty ? <span className="text-muted-foreground">Not recorded</span> : null;
}

const LEVEL_DOT: Record<string, string> = {
  primary: "bg-works",
  merged: "bg-brand",
  ported: "bg-progress",
  claimed: "bg-muted-foreground/40",
};

/** The phones a repo supports, as chips; how (and via what) on hover. */
export function SupportChips({ fork }: { fork: Fork }) {
  const list = Array.isArray(fork.supports) ? fork.supports : [];
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`Phones ${fork.repo} supports`}>
      {list.map((s) => {
        const how = supportPhrase(s.support, s.via);
        const title = [how, s.note].filter(Boolean).join(". ");
        return (
          <li key={s.device_slug}>
            <Link
              to="/device/$slug"
              params={{ slug: s.device_slug }}
              title={title}
              aria-label={`${s.device_name || s.device_slug}: ${title}`}
              className={cn(CHIP, "max-w-56 gap-1.5 bg-background hover:bg-muted")}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", LEVEL_DOT[s.support] ?? "bg-unknown")} aria-hidden />
              <span className="truncate">{s.device_name || s.device_slug}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SupportLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {Object.entries(SUPPORT_LABELS).map(([k, label]) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", LEVEL_DOT[k])} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Actions a viewer can take on a repo: claim it, upload to it. */
function RepoActions({
  fork,
  devices,
  areas,
  forks,
  compact = false,
}: {
  fork: Fork;
  devices: { slug: string; name: string }[];
  areas: Area[];
  forks: Fork[];
  /** Table rows: plain outline buttons. Main-repo cards: the SpecularButton. */
  compact?: boolean;
}) {
  const { canManageRepo, canEdit } = useAuth();
  const maintained = !!forkMaintainer(fork) || fork.maintainer_user_id != null;
  const mine = canManageRepo(fork.repo);
  const device = fork.device_slug;
  return (
    <>
      {!maintained && !mine ? <ThisIsMine repo={fork.repo} device={device} devices={devices} compact={compact} /> : null}
      {device && (mine || canEdit(device)) ? (
        <UploadButton
          allowed
          compact={compact}
          deviceSlug={device}
          deviceName={devices.find((d) => d.slug === device)?.name ?? device}
          areas={areas}
          forks={forks.filter((f) => f.device_slug === device)}
          forkId={fork.id}
        />
      ) : null}
    </>
  );
}

type SortKey = "device" | "verified";

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={cn("h-9 px-1 text-left text-xs font-medium whitespace-nowrap text-muted-foreground", className)}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className="size-3.5" aria-hidden />
      </button>
    </th>
  );
}

const TH = "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";
/** A filter: label above its select below md, beside it from md up. */
const FILTER = "flex min-w-36 flex-1 flex-col gap-1 md:flex-none md:flex-row md:items-center md:gap-2";
const FILTER_LABEL = "text-xs text-muted-foreground md:text-sm";

/** The family filter value of a repo ("" when unknown). */
function familyKey(f: Fork): string {
  return familyOfFork(f) ?? "";
}

/**
 * Every fork in one table. With `onDeviceFilter` it shows the phone and
 * base filters; `canEdit(slug)` adds an Edit button on the rows the user may change.
 */
export function ReposTable({
  forks,
  deviceNames,
  showDevice = true,
  deviceFilter,
  onDeviceFilter,
  canEdit,
  emptyText = "No forks tracked yet.",
  areas = [],
}: {
  forks: Fork[];
  deviceNames: Record<string, string>;
  showDevice?: boolean;
  deviceFilter?: string;
  onDeviceFilter?: (slug: string | undefined) => void;
  canEdit?: (slug: string) => boolean;
  emptyText?: string;
  areas?: Area[];
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [family, setFamily] = useState("");

  const devices = useMemo(
    () => Object.entries(deviceNames).map(([slug, name]) => ({ slug, name })),
    [deviceNames],
  );
  const deviceName = (f: Fork) => (f.device_slug ? (deviceNames[f.device_slug] ?? f.device_slug) : "");
  const filtered = forks.filter((f) => {
    if (deviceFilter && (deviceFilter === "none" ? f.device_slug : f.device_slug !== deviceFilter)) return false;
    if (family && (family === "unknown" ? familyKey(f) : familyKey(f) !== family)) return false;
    return true;
  });
  function compare(a: Fork, b: Fork, s: { key: SortKey; dir: 1 | -1 }): number {
    if (s.key === "device") {
      const x = deviceName(a);
      const y = deviceName(b);
      if (!x !== !y) return x ? -1 : 1;
      return x.localeCompare(y) * s.dir;
    }
    return ((VERIFIED_RANK[a.verified] ?? 9) - (VERIFIED_RANK[b.verified] ?? 9)) * s.dir;
  }
  const rows = sort ? [...filtered].sort((a, b) => compare(a, b, sort) || a.repo.localeCompare(b.repo)) : filtered;

  function onSort(k: SortKey) {
    setSort((s) => (s?.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : null));
  }
  function toggle(id: number) {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const deviceOptions = useMemo(() => {
    const slugs = [...new Set(forks.map((f) => f.device_slug).filter((s): s is string => !!s))];
    return slugs.map((s) => ({ slug: s, name: deviceNames[s] ?? s })).sort((a, b) => a.name.localeCompare(b.name));
  }, [forks, deviceNames]);
  const families = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of forks) {
      const k = familyKey(f);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [forks]);
  const hasUnassigned = forks.some((f) => !f.device_slug);
  const cols = 5 + (showDevice ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {onDeviceFilter ? (
        <div className="flex flex-wrap items-end gap-x-2 gap-y-2 md:items-center">
          <div className={FILTER}>
          <label htmlFor="repo-device" className={FILTER_LABEL}>
            Phone
          </label>
          <NativeSelect
            id="repo-device"
            value={deviceFilter ?? ""}
            onChange={(e) => onDeviceFilter(e.target.value || undefined)}
            className="h-8 md:w-auto md:min-w-44"
          >
            <option value="">All phones</option>
            {deviceOptions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
            {hasUnassigned ? <option value="none">No phone</option> : null}
          </NativeSelect>
          </div>
          {families.length > 0 ? (
            <div className={cn(FILTER, "md:ml-2")}>
              <label htmlFor="repo-family" className={FILTER_LABEL}>
                Based on
              </label>
              <NativeSelect
                id="repo-family"
                value={family}
                onChange={(e) => setFamily(e.target.value)}
                className="h-8 md:w-auto md:min-w-36"
              >
                <option value="">Any family</option>
                {families.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k} ({n})
                  </option>
                ))}
                <option value="unknown">Not recorded</option>
              </NativeSelect>
            </div>
          ) : null}
          {/* The table's sortable headers are hidden below md: the same sort as a select. */}
          <div className={cn(FILTER, "md:hidden")}>
            <label htmlFor="repo-sort" className={FILTER_LABEL}>
              Sort
            </label>
            <NativeSelect
              id="repo-sort"
              value={sort ? `${sort.key}:${sort.dir}` : ""}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":");
                setSort(key ? { key: key as SortKey, dir: dir === "-1" ? -1 : 1 } : null);
              }}
              className="h-8"
            >
              <option value="">Default</option>
              {showDevice ? <option value="device:1">Phone, A to Z</option> : null}
              <option value="verified:1">Merged first</option>
              <option value="verified:-1">Fork claims first</option>
            </NativeSelect>
          </div>
          <span className="pb-2.5 text-sm text-muted-foreground tabular-nums md:pb-0" aria-live="polite">
            {rows.length} of {forks.length}
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">{emptyText}</p>
      ) : (
        // From md up a table; below md each repo is a stacked row (CSS only):
        // repo and verification, phone, based on, best result, then actions.
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm max-md:block">
            <thead className="border-b bg-muted/40 max-md:hidden">
              <tr>
                <th scope="col" className={TH}>
                  Repo
                </th>
                {showDevice ? (
                  <SortHeader label="Phone" k="device" sort={sort} onSort={onSort} />
                ) : null}
                <th scope="col" className={`${TH} hidden md:table-cell`}>
                  Based on
                </th>
                <SortHeader label="Verification" k="verified" sort={sort} onSort={onSort} />
                <th scope="col" className={`${TH} hidden lg:table-cell`}>
                  Best result
                </th>
                <th scope="col" className="w-0 px-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y max-md:block">
              {rows.map((f) => {
                const expanded = open.has(f.id);
                const maintainer = forkMaintainer(f);
                const details = (
                  [
                    ["Branch", f.branch],
                    ["Best result", f.best_result],
                    ["Ported back", f.ported],
                    ["Fork only", f.fork_only],
                    ["Notes", f.notes],
                  ] as const
                ).filter(([, v]) => v);
                return (
                  <Fragment key={f.id}>
                    <tr
                      className={cn(
                        "transition-colors hover:bg-muted/50 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:pt-3 max-md:pb-2",
                        expanded && "bg-muted/30",
                      )}
                    >
                      <td className="px-3 py-2 align-middle max-md:col-start-1 max-md:row-start-1 max-md:p-0">
                        <a
                          href={forkHref(f)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium break-all hover:underline md:break-normal md:whitespace-nowrap"
                        >
                          {f.repo}
                        </a>
                        <div className="text-xs text-muted-foreground">
                          {maintainer ? `Maintained by ${maintainer}` : "Unclaimed"}
                        </div>
                      </td>
                      {showDevice ? (
                        <td className="px-3 py-2 align-middle whitespace-nowrap max-md:col-span-2 max-md:flex max-md:items-center max-md:gap-2 max-md:p-0">
                          {f.device_slug ? (
                            <Link
                              to="/device/$slug"
                              params={{ slug: f.device_slug }}
                              className="hover:underline max-md:truncate pointer-coarse:inline-flex pointer-coarse:min-h-8 pointer-coarse:items-center max-md:inline-flex max-md:min-h-8 max-md:items-center"
                            >
                              {deviceName(f)}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">No phone</span>
                          )}
                          {Array.isArray(f.supports) && f.supports.length > 1 ? (
                            <div className="text-xs text-muted-foreground tabular-nums">
                              +{f.supports.length - 1} more
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="hidden px-3 py-2 align-middle max-md:col-span-2 max-md:block max-md:p-0 md:table-cell">
                        <BasedOnChips fork={f} max={1} />
                      </td>
                      <td className="px-3 py-2 align-middle max-md:col-start-2 max-md:row-start-1 max-md:p-0 max-md:pt-0.5">
                        <VerifiedBadge verified={f.verified} />
                      </td>
                      <td className="hidden max-w-0 px-3 py-2 align-middle max-md:col-span-2 max-md:block max-md:max-w-none max-md:p-0 lg:table-cell lg:w-[34%]">
                        {f.best_result ? (
                          <p className="line-clamp-2 md:line-clamp-none md:truncate" title={f.best_result}>
                            {f.best_result}
                          </p>
                        ) : (
                          <span className="text-muted-foreground">None reported</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-middle max-md:col-span-2 max-md:p-0">
                        <div className="flex items-center justify-end gap-1 max-md:-mr-2 max-md:justify-start max-md:[&>:last-child]:ml-auto">
                          <RepoActions fork={f} devices={devices} areas={areas} forks={forks} compact />
                          {canEdit && f.device_slug && canEdit(f.device_slug) ? (
                            <ForkDialog deviceSlug={f.device_slug} fork={f} />
                          ) : null}
                          <CopyClone fork={f} />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground/70 hover:text-foreground"
                            onClick={() => toggle(f.id)}
                            aria-expanded={expanded}
                            aria-label={expanded ? `Hide details of ${f.repo}` : `Show details of ${f.repo}`}
                            title={expanded ? "Hide details" : "Details"}
                          >
                            <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-muted/30 max-md:block">
                        <td colSpan={cols} className="px-3 pt-1 pb-3 max-md:block max-md:px-4">
                          <dl className="grid max-w-4xl gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[7rem_1fr]">
                            <dt className="text-muted-foreground">Clone</dt>
                            <dd className="min-w-0">
                              <code className="font-mono text-xs break-all">{cloneCommand(f)}</code>
                            </dd>
                            <dt className="text-muted-foreground">Based on</dt>
                            <dd className="min-w-0">
                              {Array.isArray(f.based_on) && f.based_on.length > 0 ? (
                                <ul className="flex flex-col gap-0.5">
                                  {uniqueBases(f.based_on, false).map((b) => (
                                    <li key={`${b.base}-${b.relation}`}>
                                      {RELATION_LABELS[b.relation] ?? b.relation} {b.base}
                                      {b.note ? <span className="text-muted-foreground">: {b.note}</span> : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <BasedOnChips fork={f} />
                              )}
                            </dd>
                            {Array.isArray(f.supports) && f.supports.length > 0 ? (
                              <>
                                <dt className="text-muted-foreground">Phones</dt>
                                <dd className="min-w-0">
                                  <SupportChips fork={f} />
                                </dd>
                              </>
                            ) : null}
                            {details.map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="text-muted-foreground">{k}</dt>
                                <dd className="min-w-0 break-words">
                                  <LinkedText text={v} />
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Upstream and standalone repos, pinned above the forks with the phones they support. */
export function MainRepos({
  forks,
  deviceNames,
  areas,
}: {
  forks: Fork[];
  deviceNames: Record<string, string>;
  areas: Area[];
}) {
  const devices = useMemo(
    () => Object.entries(deviceNames).map(([slug, name]) => ({ slug, name })),
    [deviceNames],
  );
  const [all, setAll] = useState(false);
  const main = forks
    .filter((f) => forkKind(f) !== "fork")
    .sort((a, b) => (forkKind(a) === "upstream" ? 0 : 1) - (forkKind(b) === "upstream" ? 0 : 1));
  if (main.length === 0) return null;
  const cut = !all && main.length > MAIN_PAGE;
  return (
    <section aria-labelledby="main-repos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="main-repos" className="text-base font-semibold">
          Main repos <span className="font-normal text-muted-foreground tabular-nums">{main.length}</span>
        </h2>
        <SupportLegend />
      </div>
      {/* Below sm the first six cards, then "Show all": the forks table follows. */}
      <ul className={cn("grid gap-3 md:grid-cols-2", cut && "max-sm:[&>li:nth-child(n+7)]:hidden")}>
        {main.map((f) => {
          const maintainer = forkMaintainer(f);
          const kind = forkKind(f);
          return (
            <li key={f.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <a
                    href={forkHref(f)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] font-semibold break-all hover:underline"
                  >
                    {f.repo}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {kind === "upstream" ? "Main repo" : "Standalone port"}, {maintainer ? `maintained by ${maintainer}` : "unclaimed"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 max-sm:-my-1">
                  <RepoActions fork={f} devices={devices} areas={areas} forks={forks} />
                  <CopyClone fork={f} />
                </div>
              </div>
              {f.best_result ? <p className="text-sm">{f.best_result}</p> : null}
              {kind !== "upstream" ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Based on</span>
                  <BasedOnChips fork={f} max={5} />
                </div>
              ) : null}
              <SupportChips fork={f} />
            </li>
          );
        })}
      </ul>
      {cut ? (
        <Button variant="outline" className="self-center sm:hidden" onClick={() => setAll(true)}>
          Show all {main.length}
        </Button>
      ) : null}
    </section>
  );
}
