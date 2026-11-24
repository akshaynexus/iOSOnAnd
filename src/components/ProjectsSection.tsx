/**
 * The projects on the Repos tab: one card per project (how it boots, its
 * phones and repos from the live data). Picking one opens its details and
 * filters the repos below to it; picking it again shows every repo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ExternalLink, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneOutline } from "@/components/common";
import { SegmentBar, devicePhoto } from "@/components/DeviceCard";
import { CountUp, Reveal, reducedMotion } from "@/components/motion";
import { PortPromptBox } from "@/components/RepoClaim";
import { familyOfFork } from "@/components/repoInfo";
import { applicableAreas, stateCounts } from "@/lib/areas";
import type { Area, Device, Fork } from "@/lib/client";
import { PROJECTS, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

const lc = (s: string | undefined | null) => (s ?? "").toLowerCase();

/** The project whose repos carry this family label, if any. */
export function projectOfFamily(family: string | undefined): Project | undefined {
  return family ? PROJECTS.find((p) => lc(p.family) === lc(family)) : undefined;
}

interface Stats {
  phones: Device[];
  boots: number;
  repos: number;
  /** Phones with the most working areas, for "Phones to learn from". */
  top: Device[];
}

function statsFor(p: Project, devices: Device[], forks: Fork[], areas: Area[]): Stats {
  const key = lc(p.family);
  const phones = devices.filter((d) => (d.families ?? []).some((f) => lc(f) === key));
  const boots = phones.filter((d) => d.statuses?.some((s) => s.area_slug === "boot" && s.state === "works")).length;
  const repos = forks.filter((f) => lc(familyOfFork(f)) === key).length;
  const works = (d: Device) => stateCounts(d, areas).works;
  const top = [...phones].sort((a, b) => works(b) - works(a) || a.name.localeCompare(b.name)).slice(0, 6);
  return { phones, boots, repos, top };
}

export function Thumb({ device, className }: { device: Device; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = devicePhoto(device);
  return (
    <span className={cn("flex items-center justify-center overflow-hidden rounded-lg border bg-muted/50", className)}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain p-0.5" />
      ) : (
        <PhoneOutline className="h-3/5 w-auto text-muted-foreground opacity-60" />
      )}
    </span>
  );
}

/** One project as a selectable card. */
function ProjectTile({ p, s, selected, onSelect }: { p: Project; s: Stats; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex h-full w-full min-w-0 flex-col gap-3 rounded-[14px] border bg-card p-4 text-left text-card-foreground outline-none transition-[border-color,box-shadow,background-color] duration-200",
        "hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-foreground shadow-[0_0_0_1px_var(--foreground)]",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-semibold tracking-tight">{p.name}</span>
          <span className="text-sm text-muted-foreground">{p.kind}</span>
        </span>
        <span aria-hidden className="flex shrink-0 -space-x-2">
          {s.top.slice(0, 3).map((d) => (
            <Thumb key={d.slug} device={d} className="size-9 bg-card shadow-sm" />
          ))}
        </span>
      </span>
      <span className="line-clamp-2 text-sm text-muted-foreground">{p.summary}</span>
      <span className="mt-auto grid grid-cols-3 gap-2 border-t pt-3">
        {(
          [
            ["Phones", s.phones.length],
            ["Boot to Home", s.boots],
            ["Repos", s.repos],
          ] as const
        ).map(([k, v]) => (
          <span key={k} className="flex min-w-0 flex-col">
            <CountUp value={v} className="text-lg leading-6 font-semibold tabular-nums" />
            <span className="truncate text-xs text-muted-foreground">{k}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm hover:bg-muted pointer-coarse:h-10"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

function FactList({ label, items, icon: Icon, tone }: { label: string; items: string[]; icon: typeof Check; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-medium">{label}</h4>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((t) => (
          <li key={t} className="flex gap-2">
            <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden />
            <span className="min-w-0 text-muted-foreground">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A phone of the project: photo, name, how many areas work. */
function PhoneCard({ d, areas }: { d: Device; areas: Area[] }) {
  const counts = stateCounts(d, areas);
  const total = applicableAreas(d, areas).length;
  return (
    <Link
      to="/device/$slug"
      params={{ slug: d.slug }}
      className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-2.5 outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Thumb device={d} className="size-12 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{d.name}</span>
        <span className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {counts.works}/{total}
          </span>
          <SegmentBar counts={counts} className="h-1 flex-1 bg-foreground/10" />
        </span>
      </span>
    </Link>
  );
}

/** The open project: what runs, how it boots, what works, how to start from it. */
function ProjectDetail({ p, s, areas, onClose, reveal }: { p: Project; s: Stats; areas: Area[]; onClose: () => void; reveal: boolean }) {
  const ref = useRef<HTMLElement>(null);
  // Opened by a click: bring it into view (on a phone it sits below all six cards).
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }, [reveal]);
  return (
    <article ref={ref} aria-labelledby={`project-${p.id}`} className="tab-fade flex min-w-0 scroll-mt-20 flex-col gap-6 rounded-[14px] border bg-card p-4 text-card-foreground sm:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`project-${p.id}`} className="text-lg font-semibold tracking-tight">
              {p.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {p.kind}. {p.install}.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Show every project's repos">
            <X />
          </Button>
        </div>
        <p>{p.summary}</p>
        <div className="flex flex-wrap gap-2">
          {p.repos.map((r) => (
            <ExtLink key={r} href={`https://github.com/${r}`}>
              {r}
            </ExtLink>
          ))}
          {p.docs ? <ExtLink href={p.docs}>Docs</ExtLink> : null}
        </div>
      </header>

      <dl className="flex flex-col divide-y rounded-xl border text-sm">
        {(
          [
            ["Reference phone", p.reference],
            ["Runs", p.runs],
            ["Boot and install", p.boot],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 px-4 py-3 lg:flex-row lg:gap-4">
            <dt className="shrink-0 font-medium lg:w-36">{k}</dt>
            <dd className="min-w-0 text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 md:grid-cols-2">
        <FactList label="Works" items={p.works} icon={Check} tone="text-works-fg" />
        <FactList label="Missing" items={p.missing} icon={Minus} tone="text-muted-foreground" />
      </div>

      {s.top.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Phones to learn from</h3>
            <Link to="/" search={{ family: p.family }} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              All {s.phones.length} phones
            </Link>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.top.map((d) => (
              <li key={d.slug} className="min-w-0">
                <PhoneCard d={d} areas={areas} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Start a port from it</h3>
        <p className="text-sm text-muted-foreground">{p.startAPort}</p>
      </div>

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        Sources:
        {p.sources.map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="break-all underline-offset-4 hover:underline">
            {u.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ))}
      </p>
    </article>
  );
}

/** Project cards, and the open project's details under them. */
export function ProjectsSection({
  devices,
  forks,
  areas,
  selected,
  onSelect,
}: {
  devices: Device[];
  forks: Fork[];
  areas: Area[];
  /** The open project's id. */
  selected?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const stats = useMemo(() => new Map(PROJECTS.map((p) => [p.id, statsFor(p, devices, forks, areas)])), [devices, forks, areas]);
  const open = PROJECTS.find((p) => p.id === selected);
  // Only a click scrolls; a link that opens the page with a project does not.
  const [clicked, setClicked] = useState(false);
  return (
    <section aria-labelledby="projects-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="projects-heading" className="text-base font-semibold">
          Projects <span className="font-normal text-muted-foreground tabular-nums">{PROJECTS.length}</span>
        </h2>
        <p className="text-sm text-muted-foreground">Pick one to see how it works and only its repos.</p>
      </div>
      {/* Phones: one row to swipe through; wider screens: a grid. */}
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
        {PROJECTS.map((p) => (
          <Reveal as="li" key={p.id} className="w-[82%] min-w-0 shrink-0 snap-start sm:w-auto">
            <ProjectTile p={p} s={stats.get(p.id)!} selected={p.id === selected} onSelect={() => {
                setClicked(true);
                onSelect(p.id === selected ? undefined : p.id);
              }}
            />
          </Reveal>
        ))}
      </ul>
      {open ? <ProjectDetail key={open.id} p={open} s={stats.get(open.id)!} areas={areas} reveal={clicked} onClose={() => onSelect(undefined)} /> : null}
    </section>
  );
}

/** Start a port (the prompt) and claim a repo, side by side. */
export function StartCards({ maintain }: { maintain: React.ReactNode }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section aria-labelledby="port-heading" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card px-4 py-4 sm:px-5">
        <div>
          <h2 id="port-heading" className="text-base font-semibold">
            Port iOS to your phone
          </h2>
          <p className="mt-1 text-muted-foreground">Your coding agent picks the project and the closest ports to start from, using this tracker.</p>
        </div>
        <PortPromptBox summary="Show the prompt" />
      </section>
      {maintain}
    </div>
  );
}

const REFERENCE_STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Find the closest phone",
    body: (
      <>
        Same chip is best, then the same chip family. Search by chip (
        <Link to="/" search={{ q: "SM7325" }} className="underline underline-offset-4">
          SM7325
        </Link>
        ,{" "}
        <Link to="/" search={{ q: "Exynos" }} className="underline underline-offset-4">
          Exynos
        </Link>
        ) or open{" "}
        <Link to="/" search={{ tab: "compatibility" }} className="underline underline-offset-4">
          Compatibility
        </Link>{" "}
        to see which areas work where.
      </>
    ),
  },
  {
    title: "Read its page",
    body: "Every area links to its evidence: a commit, a log, a Reddit thread. Its repos link straight to their branches.",
  },
  {
    title: "Follow the lineage",
    body: '"Based on" in the table and the tree below show where a kernel, driver or GPU change came from, so you take it from the source.',
  },
  {
    title: "Fork the right repo",
    body: "Fork the project or the port on the closest chip. Change the board first (memory map, screen, touch, buttons), then storage, GPU and Wi-Fi.",
  },
  {
    title: "Put your port on the tracker",
    body: (
      <>
        &quot;Add your repo&quot; claims it, and can add a phone we don&apos;t list yet.{" "}
        <Link to="/docs/$" params={{ _splat: "maintain-a-repo" }} className="underline underline-offset-4">
          Maintain a repo
        </Link>{" "}
        has the details.
      </>
    ),
  },
];

/** How to use the directory to start or fix a port, as numbered steps. */
export function FindReferences() {
  return (
    <section id="find-references" aria-labelledby="refs-heading" className="flex scroll-mt-20 flex-col gap-4 rounded-[14px] border bg-card p-4 sm:p-6">
      <h2 id="refs-heading" className="text-base font-semibold">
        Use the directory to start a port
      </h2>
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {REFERENCE_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1 pt-0.5">
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
