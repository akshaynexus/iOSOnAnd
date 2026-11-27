// /stats — public usage statistics: the most viewed and most searched phones,
// top searches, most viewed profiles, the most updated phones, the most active
// maintainers, and daily activity. Counts only (GET /api/stats); nothing about
// who viewed or searched is stored.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/Page";
import { PhoneOutline } from "@/components/common";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadStats, type PublicStats } from "@/lib/client";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/seo";

type Range = "7" | "30" | "all";

export const Route = createFileRoute("/stats")({
  validateSearch: (s: Record<string, unknown>): { range?: Range } => (s.range === "7" || s.range === "all" ? { range: s.range } : {}),
  loaderDeps: ({ search }) => ({ range: search.range ?? "30" }),
  loader: ({ deps }) => loadStats({ data: deps.range }),
  head: () => seo({ title: "Statistics: iOSOnAnd", description: "The most viewed and most searched phones, top searches and maintainer activity on the iOSOnAnd tracker.", path: "/stats" }),
  component: StatsPage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
});

const RANGE_LABEL: Record<Range, string> = { "7": "7 days", "30": "30 days", all: "All time" };
const CARD = "rounded-[14px] border bg-card text-card-foreground";
const nf = new Intl.NumberFormat("en");

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">{nf.format(value)}</dd>
    </div>
  );
}

function Thumb({ src }: { src: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {src ? <img src={src} alt="" loading="lazy" className="max-h-full max-w-full object-contain p-0.5" /> : <PhoneOutline className="h-6 w-auto text-muted-foreground/60" />}
    </span>
  );
}

/** A ranked list: label, a magnitude bar (one hue) and the count. */
function Ranked<T>({
  title,
  unit,
  rows,
  value,
  label,
  empty = "Nothing yet in this range.",
}: {
  title: string;
  unit: string;
  rows: T[];
  value: (r: T) => number;
  label: (r: T) => React.ReactNode;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <section className={cn(CARD, "flex min-w-0 flex-col")}>
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>
      {rows.length ? (
        <ol className="flex flex-col gap-2.5 p-4">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="min-w-0 truncate text-sm">{label(r)}</div>
                <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${(value(r) / max) * 100}%` }} />
                </span>
              </div>
              <span className="text-sm font-medium tabular-nums" title={`${value(r)} ${unit}`}>
                {nf.format(value(r))}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/** One measure per day as thin bars on one axis; hover a bar for the day and value. */
function DailyBars({ title, days, value, unit }: { title: string; days: PublicStats["daily"]; value: (d: PublicStats["daily"][number]) => number; unit: string }) {
  const max = Math.max(1, ...days.map(value));
  const total = days.reduce((s, d) => s + value(d), 0);
  const fmt = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <section className={cn(CARD, "flex min-w-0 flex-col")}>
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {nf.format(total)} {unit}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex h-28 items-end gap-[2px]" role="img" aria-label={`${title}: ${total} ${unit} over ${days.length} days`}>
          {days.map((d) => {
            const v = value(d);
            return (
              <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end">
                <span
                  className={cn("w-full rounded-t-[4px]", v ? "bg-foreground/70 group-hover:bg-foreground" : "bg-muted")}
                  style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : "2px" }}
                />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm group-hover:block">
                  {fmt(d.day)}: <span className="font-medium tabular-nums">{nf.format(v)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{days[0] ? fmt(days[0].day) : ""}</span>
          <span>{days.length ? fmt(days[days.length - 1].day) : ""}</span>
        </div>
        <table className="sr-only">
          <caption>{title}</caption>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <th scope="row">{d.day}</th>
                <td>{value(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PhoneLink({ slug, name, image_url }: { slug: string; name: string; image_url: string }) {
  return (
    <Link to="/device/$slug" params={{ slug }} className="flex min-w-0 items-center gap-2 hover:underline">
      <Thumb src={image_url} />
      <span className="truncate">{name}</span>
    </Link>
  );
}

function StatsPage() {
  const s = Route.useLoaderData();
  const navigate = useNavigate();
  const range = (Route.useSearch().range ?? "30") as Range;
  if (!s) return <p className="text-muted-foreground">Statistics are not available right now.</p>;
  const t = s.totals;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Statistics</h1>
        <Tabs value={range} onValueChange={(v) => void navigate({ to: "/stats", search: v === "30" ? {} : { range: v as Range }, replace: true })}>
          <TabsList aria-label="Range">
            {(["7", "30", "all"] as const).map((r) => (
              <TabsTrigger key={r} value={r}>
                {RANGE_LABEL[r]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <dl className={cn(CARD, "grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-8")}>
        <Tile label="Phone views" value={t.device_views} />
        <Tile label="Searches" value={t.searches} />
        <Tile label="Profile views" value={t.profile_views} />
        <Tile label="Status changes" value={t.status_changes} />
        <Tile label="Phones" value={t.devices} />
        <Tile label="Repos" value={t.repos} />
        <Tile label="Maintainers" value={t.maintainers} />
        <Tile label="GPU accelerated" value={t.gpu_accelerated} />
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <DailyBars title="Phone views per day" days={s.daily} value={(d) => d.views} unit="views" />
        <DailyBars title="Status changes per day" days={s.daily} value={(d) => d.status_changes} unit="changes" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Ranked title="Most viewed phones" unit="views" rows={s.most_viewed} value={(r) => r.views} label={(r) => <PhoneLink {...r} />} />
        <Ranked title="Most searched phones" unit="searches" rows={s.most_searched} value={(r) => r.searches} label={(r) => <PhoneLink {...r} />} />
        <Ranked
          title="Top searches"
          unit="searches"
          rows={s.search_terms}
          value={(r) => r.searches}
          label={(r) => (
            <Link to="/" search={{ q: r.term }} className="font-mono text-xs hover:underline">
              {r.term}
            </Link>
          )}
        />
        <Ranked title="Most updated phones" unit="status changes" rows={s.most_updated} value={(r) => r.changes} label={(r) => <PhoneLink {...r} />} />
        <Ranked
          title="Most active maintainers"
          unit="status changes"
          rows={s.top_contributors}
          value={(r) => r.changes}
          label={(r) =>
            r.id ? (
              <Link to="/u/$id" params={{ id: r.github_login || String(r.id) }} className="hover:underline">
                {r.label}
                <span className="text-muted-foreground"> · {r.phones} phone{r.phones === 1 ? "" : "s"}</span>
              </Link>
            ) : (
              r.label
            )
          }
        />
        <Ranked
          title="Most viewed profiles"
          unit="views"
          rows={s.most_viewed_profiles}
          value={(r) => r.views}
          label={(r) => (
            <Link to="/u/$id" params={{ id: r.github_login || String(r.id) }} className="hover:underline">
              {r.label}
            </Link>
          )}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Counts only: a phone or profile counts once per visitor and day, and a search counts when it matches a phone. Nothing about who viewed or
        searched is stored.
      </p>
    </div>
  );
}
