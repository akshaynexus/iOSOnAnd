import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { PhoneOutline } from "@/components/common";
import { SegmentBar, devicePhoto } from "@/components/DeviceCard";
import { CountUp, Reveal, reducedMotion, useSeenOnce } from "@/components/motion";
import { ONEIOS_REPO, familiesOfDevice, familyName, forksByRepo, mainRepoOf } from "@/components/repoInfo";
import { applicableAreas, boots, stateCounts } from "@/lib/areas";
import { forkKind, type Dashboard, type Device, type Media, type Post } from "@/lib/client";
import { cn, formatDate, parseDate, relativeTime } from "@/lib/utils";

/** OneiOS's primary phone: featured first when it is in the data. */
const MAIN_DEVICE = "s24-ultra";
/** Named family segments before the rest is grouped as "Other". */
const TOP_FAMILIES = 6;
/**
 * Neutral tones for the family segments, darkest (largest family) first; the
 * last is "Other". Mixed from the theme's foreground into the card, so they
 * read in light and dark.
 */
const TONES = [86, 68, 54, 42, 32, 23, 14];
const tone = (i: number) => `color-mix(in oklch, var(--foreground) ${TONES[Math.min(i, TONES.length - 1)]}%, var(--card))`;

const CARD = "rounded-[14px] border bg-card text-card-foreground";
/** The label column of the slim rows, the same width so the rows line up. */
const ROW_LABEL = "shrink-0 text-sm font-medium lg:w-36";

interface FamilySlice {
  /** The family key the grid filters on; null for "Other". */
  key: string | null;
  name: string;
  /** Phones with this family first (each phone counted once). */
  main: number;
  /** Phones with this family anywhere in their repos. */
  all: number;
  /** "Other": the families it groups. */
  members?: string[];
}

/** The phone to feature: the main device, else the OneiOS phone with the most working areas. */
function featuredDevice(devices: Device[], areas: Dashboard["areas"]): Device | null {
  const main = devices.find((d) => d.slug === MAIN_DEVICE);
  if (main) return main;
  let best: Device | null = null;
  let works = -1;
  for (const d of devices) {
    if (d.base !== "oneios") continue;
    const n = stateCounts(d, areas).works;
    if (n > works) {
      best = d;
      works = n;
    }
  }
  return best;
}

function Photo({ device }: { device: Device }) {
  const [failed, setFailed] = useState(false);
  const src = devicePhoto(device);
  if (!src || failed) return <PhoneOutline className="h-20 w-auto text-muted-foreground opacity-60" />;
  return (
    <img
      src={src}
      alt={device.name}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full object-contain"
    />
  );
}

function Featured({ device, areas }: { device: Device; areas: Dashboard["areas"] }) {
  const counts = stateCounts(device, areas);
  const total = applicableAreas(device, areas).length;
  const repo = mainRepoOf(device) ?? (device.base === "oneios" ? ONEIOS_REPO : null);
  // Phones: a small photo beside the name, then the count and best result at
  // full width. From sm up the photo spans the card's height on the left.
  return (
    <article
      className={cn(
        CARD,
        "relative grid h-full grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-y-2",
      )}
    >
      <div aria-hidden className="flex h-20 w-[4.5rem] items-center justify-center sm:row-span-3 sm:h-24 sm:w-32">
        <Photo device={device} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
        <h2 className="text-base font-semibold tracking-tight">
          {/* The name's link covers the card, so the whole card opens the phone. */}
          <Link
            to="/device/$slug"
            params={{ slug: device.slug }}
            className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-[14px] after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {device.name}
          </Link>
        </h2>
        {device.ios_version ? <span className="text-sm text-muted-foreground">{device.ios_version}</span> : null}
        {repo ? (
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 -my-1.5 inline-flex min-h-8 w-fit max-w-full items-center rounded-sm font-mono text-xs break-all text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:ml-auto sm:pointer-fine:my-0 sm:pointer-fine:min-h-0"
          >
            {repo}
          </a>
        ) : null}
      </div>
      <div className="col-span-2 flex items-center gap-3 sm:col-span-1 sm:col-start-2">
        <p className="shrink-0 text-sm tabular-nums">
          <CountUp value={counts.works} className="font-semibold" />
          <span className="text-muted-foreground"> of {total} areas work</span>
        </p>
        <SegmentBar counts={counts} className="h-1.5 flex-1 bg-foreground/10" />
      </div>
      {device.best_result ? (
        <p
          className="col-span-2 line-clamp-3 text-sm text-muted-foreground sm:col-span-1 sm:col-start-2 sm:line-clamp-2"
          title={device.best_result}
        >
          {device.best_result}
        </p>
      ) : null}
    </article>
  );
}

function Stat({ label, value, sub, to }: { label: string; value: number; sub?: string; to?: "repos" }) {
  const body = (
    <>
      <dt className="w-[6.5rem] shrink-0 text-sm whitespace-nowrap text-muted-foreground sm:w-28">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-2">
        <CountUp value={value} className="text-xl leading-7 font-semibold tracking-tight tabular-nums" />
        {sub ? <span className="min-w-0 text-xs text-muted-foreground tabular-nums">{sub}</span> : null}
      </dd>
    </>
  );
  return to ? (
    <Link
      to="/"
      search={{ tab: to }}
      className="flex min-h-11 items-baseline gap-2 py-2 outline-none hover:[&_dt]:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    <div className="flex items-baseline gap-2 py-1.5">{body}</div>
  );
}

/** One stacked bar of the families, with a legend whose entries set the grid's family filter. */
function Families({
  slices,
  active,
  onPick,
}: {
  slices: FamilySlice[];
  active: string;
  onPick: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const sum = slices.reduce((n, s) => n + s.main, 0);
  const title = (s: FamilySlice) => {
    if (!s.key) return `Other: ${s.main} phones in ${s.members?.length ?? 0} families (${(s.members ?? []).join(", ")})`;
    const more = s.all - s.main;
    return `${s.name}: ${s.main} phones${more > 0 ? `; ${more} more use it as a second base` : ""}`;
  };
  return (
    <div role="group" aria-labelledby="ov-families" className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
      <span id="ov-families" className={ROW_LABEL}>
        Ports by family
      </span>
      <div
        ref={ref}
        aria-hidden
        data-seen={seen === null ? undefined : ""}
        className="flex h-2 w-full min-w-24 gap-0.5 overflow-hidden rounded-full lg:w-auto lg:flex-1"
      >
        {slices.map((s, i) => (
          <span
            key={s.key ?? "other"}
            title={title(s)}
            onClick={s.key ? () => onPick(s.key === active ? "" : (s.key as string)) : undefined}
            className={cn(
              "grow-seg h-full first:rounded-l-full last:rounded-r-full",
              s.key && "cursor-pointer",
              active && s.key !== active && "opacity-40",
            )}
            style={
              { width: `${(s.main / sum) * 100}%`, background: tone(i), "--seg-delay": `${i * 40}ms` } as CSSProperties
            }
          />
        ))}
      </div>
      <ul className="-mx-1.5 flex flex-wrap gap-1 text-xs lg:mx-0 lg:shrink-0">
        {slices.map((s, i) => {
          const swatch = <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: tone(i) }} />;
          const text = (
            <>
              {swatch}
              <span>{s.name}</span>
              <span className="text-muted-foreground tabular-nums">{s.main}</span>
            </>
          );
          return (
            <li key={s.key ?? "other"}>
              {s.key ? (
                <button
                  type="button"
                  title={title(s)}
                  aria-pressed={active === s.key}
                  onClick={() => onPick(s.key === active ? "" : (s.key as string))}
                  className={cn(
                    "inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-8 pointer-coarse:px-2",
                    active === s.key && "bg-muted font-medium",
                  )}
                >
                  {text}
                </button>
              ) : (
                <span title={title(s)} className="inline-flex h-6 items-center gap-1.5 px-1.5 pointer-coarse:h-8 pointer-coarse:px-2">
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type RedditPost = Post & { image_url?: string };

function RedditRow({ post }: { post: RedditPost }) {
  const [imgFailed, setImgFailed] = useState(false);
  const img = post.image_url && !imgFailed ? post.image_url : null;
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-2 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset lg:gap-4"
    >
      <span className={cn(ROW_LABEL, "hidden lg:block")}>Newest Reddit post</span>
      {img ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="size-10 shrink-0 rounded-md bg-muted object-cover"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground lg:hidden">Newest Reddit post</span>
        <span className="line-clamp-2 text-sm lg:line-clamp-1">
          <span className="font-medium">{post.title}</span>
          {post.note ? <span className="hidden text-muted-foreground sm:inline"> {post.note}</span> : null}
        </span>
      </span>
      {post.published ? (
        <time
          dateTime={post.published}
          title={formatDate(post.published)}
          suppressHydrationWarning
          className="shrink-0 text-xs text-muted-foreground"
        >
          {relativeTime(post.published)}
        </time>
      ) : null}
      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

type Upload = Media & { device_name: string };

function UploadsRow({ uploads }: { uploads: Upload[] }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 lg:gap-4">
      <span className={ROW_LABEL}>Newest uploads</span>
      <ul className="flex min-w-0 gap-2 overflow-x-auto scrollbar-none">
        {uploads.map((m) => (
          <li key={m.id} className="shrink-0">
            <Link
              to="/device/$slug"
              params={{ slug: m.device_slug }}
              title={`${m.device_name}${m.caption ? `: ${m.caption}` : ""}, ${formatDate(m.created)}`}
              className="block size-10 overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {m.kind === "video" ? (
                <video src={m.url} muted playsInline preload="metadata" aria-label={m.device_name} className="size-full object-cover" />
              ) : (
                <img src={m.url} alt={m.caption || m.device_name} loading="lazy" decoding="async" className="size-full object-cover" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Overview summary above the phone grid: the featured phone, three
 * counts, the ports by family (its legend sets the grid's family filter), the
 * newest Reddit post and, when there are any, the newest uploads. The layout
 * is CSS only, so the server and the client render the same markup.
 */
export function OverviewSummary({
  data,
  family,
  onFamily,
}: {
  data: Dashboard;
  /** The grid's family filter ("" = any). */
  family: string;
  onFamily: (key: string) => void;
}) {
  const summary = useMemo(() => {
    const { devices, areas, forks, posts } = data;
    const byRepo = forksByRepo(forks);
    // Each phone counted once under its main family; `all` counts every family it uses.
    const main = new Map<string, number>();
    const all = new Map<string, number>();
    for (const d of devices) {
      const fams = familiesOfDevice(d, byRepo).filter((f) => f !== "unknown");
      if (fams[0]) main.set(fams[0], (main.get(fams[0]) ?? 0) + 1);
      for (const f of fams) all.set(f, (all.get(f) ?? 0) + 1);
    }
    const ranked = [...main.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const slices: FamilySlice[] = ranked
      .slice(0, TOP_FAMILIES)
      .map(([key, n]) => ({ key, name: familyName(key), main: n, all: all.get(key) ?? n }));
    const rest = ranked.slice(TOP_FAMILIES);
    if (rest.length > 0) {
      const n = rest.reduce((sum, [, c]) => sum + c, 0);
      slices.push({ key: null, name: "Other", main: n, all: n, members: rest.map(([k]) => familyName(k)) });
    }
    const uploads: Upload[] = devices
      .filter((d) => d.latest_media)
      .map((d) => ({ ...(d.latest_media as Media), device_name: d.name }))
      .sort((a, b) => (parseDate(b.created)?.getTime() ?? 0) - (parseDate(a.created)?.getTime() ?? 0))
      .slice(0, 6);
    const mainRepos = forks.filter((f) => forkKind(f) !== "fork").length;
    return {
      featured: featuredDevice(devices, areas),
      phones: devices.length,
      booting: devices.filter(boots).length,
      oneios: devices.filter((d) => d.base === "oneios").length,
      repos: forks.length,
      mainRepos,
      slices,
      post: posts[0] as RedditPost | undefined,
      uploads,
    };
  }, [data]);

  const pick = (key: string) => {
    onFamily(key);
    // Bring the grid into view when it is below the fold (phones, small windows).
    const grid = document.getElementById("devices-heading")?.closest("section");
    if (grid && key && grid.getBoundingClientRect().top > window.innerHeight * 0.6) {
      grid.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  };

  const { featured, slices, post, uploads } = summary;
  const rows = slices.length > 0 || post || uploads.length > 0;

  return (
    <section aria-label="Summary" className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-3">
        {featured ? (
          <Reveal className="min-w-0 lg:col-span-2">
            <Featured device={featured} areas={data.areas} />
          </Reveal>
        ) : null}
        <Reveal className={cn("min-w-0", !featured && "lg:col-span-3")}>
          <dl className={cn(CARD, "flex h-full flex-col justify-center divide-y px-4 py-1")}>
            <Stat
              label="Phones"
              value={summary.phones}
              sub={summary.booting > 0 ? `${summary.booting} boot to Home Screen` : undefined}
            />
            <Stat
              label="Repos"
              value={summary.repos}
              sub={`${summary.mainRepos} main, ${summary.repos - summary.mainRepos} forks and ports`}
              to="repos"
            />
            <Stat label="OneiOS phones" value={summary.oneios} />
          </dl>
        </Reveal>
      </div>
      {rows ? (
        <Reveal>
          <div className={cn(CARD, "flex flex-col divide-y overflow-hidden")}>
            {slices.length > 0 ? <Families slices={slices} active={family} onPick={pick} /> : null}
            {uploads.length > 0 ? <UploadsRow uploads={uploads} /> : null}
            {post ? <RedditRow post={post} /> : null}
          </div>
        </Reveal>
      ) : null}
    </section>
  );
}
