import { useEffect, useMemo, useState } from "react";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { ArrowDownUp, Check, LayoutGrid, Rows3, SlidersHorizontal, Table2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FacetFilter } from "@/components/FacetFilter";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { DeviceCard, type DeviceCardData, type Density } from "@/components/DeviceCard";
import { DevicesTable } from "@/components/DevicesTable";
import { useThemeMode } from "@/components/common";
import { Reveal, withViewTransition } from "@/components/motion";
import { familiesOfDevice, familyName, forksByRepo, mainRepoOf } from "@/components/repoInfo";
import { accelerated, boots, lastChanged, makerOf, rankScore, reported, runsMacos, stateCounts } from "@/lib/areas";
import type { Area, Device, Fork } from "@/lib/client";
import { parseDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type View = "cards" | "table";
type Sort = "best" | "working" | "verified" | "updated" | "gpu" | "fps" | "ios" | "repos" | "name" | "maker";
/** The sort options, grouped as they show in the menu. */
const SORT_GROUPS: Array<{ label: string; items: Array<[Sort, string]> }> = [
  { label: "Progress", items: [["best", "Best overall"], ["working", "Most working areas"], ["verified", "Most verified on device"], ["updated", "Recently updated"]] },
  { label: "Graphics", items: [["gpu", "GPU acceleration"], ["fps", "Highest frame rate"]] },
  { label: "Software and repos", items: [["ios", "Newest iOS"], ["repos", "Most repos"]] },
  { label: "A to Z", items: [["name", "Name"], ["maker", "Maker"]] },
];
const SORT_LABELS = Object.fromEntries(SORT_GROUPS.flatMap((g) => g.items)) as Record<Sort, string>;
/** How far the GPU acceleration goes, by method (gpu_accel), for the "GPU acceleration" sort. */
const METHOD_RANK: Record<string, number> = { "native-metal": 6, "metal-vulkan": 5, "virtio-gpu": 4, "metal-gl": 4, gles: 3, other: 2, cpu: 1, unknown: 0 };
const iosRank = (v: string) => {
  const m = /(\d+)(?:\.(\d+))?/.exec(v || "");
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : -1;
};
const VIEW_KEY = "iosonand.overview.view";
const DENSITY_KEY = "iosonand.overview.density";
const PAGE = 24;

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

function readDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

function save(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private mode or blocked storage: the choice lasts for this page only */
  }
}

/** Devices on the Overview: filters, sort, cards or table, loading more cards as you scroll. */
export function DeviceBrowser({
  devices,
  areas,
  forks,
  emptyText,
  family,
  onFamilyChange,
}: {
  devices: Device[];
  areas: Area[];
  forks: Fork[];
  emptyText: string;
  /** The family filter, when the page holds it (the Overview keeps it in ?family=); else it is local. */
  family?: string;
  onFamilyChange?: (key: string) => void;
}) {
  const theme = useThemeMode();
  const [view, setView] = useState<View>("cards");
  const [density, setDensity] = useState<Density>("comfortable");
  useEffect(() => {
    setView(readView());
    setDensity(readDensity());
  }, []);
  const [localBase, setLocalBase] = useState("");
  const base = family ?? localBase;
  const setBase = (v: string) => (onFamilyChange ? onFamilyChange(v) : setLocalBase(v));
  const [bootOnly, setBootOnly] = useState(false);
  const [macOnly, setMacOnly] = useState(false);
  const [gpuOnly, setGpuOnly] = useState(false);
  const [makers, setMakers] = useState<string[]>([]);
  const [gpuFams, setGpuFams] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("best");
  const [shown, setShown] = useState(PAGE);

  const repoMap = useMemo(() => forksByRepo(forks), [forks]);
  const rows = useMemo<DeviceCardData[]>(
    () =>
      devices.map((device) => ({
        device,
        counts: stateCounts(device, areas),
        mainRepo: mainRepoOf(device),
        families: familiesOfDevice(device, repoMap),
      })),
    [devices, areas, repoMap],
  );
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, label: value, count: n }));
  };
  const makerOptions = useMemo(() => count(devices.map((d) => makerOf(d))), [devices]);
  const gpuOptions = useMemo(() => count(devices.map((d) => d.gpu_family ?? "")), [devices]);
  const familyOptions = useMemo(() => {
    const m = new Map<string, number>();
    let none = 0;
    for (const r of rows) {
      if (r.families.length === 0) none++;
      for (const f of r.families) m.set(f, (m.get(f) ?? 0) + 1);
    }
    const list = [...m.entries()].sort((a, b) =>
      a[0] === "unknown" ? 1 : b[0] === "unknown" ? -1 : b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    return { list, none };
  }, [rows]);

  const filtered = useMemo(() => {
    const out = rows.filter(({ device: d, families }) => {
      if (base === "none" && families.length > 0) return false;
      if (base && base !== "none" && !families.includes(base)) return false;
      if (bootOnly && !boots(d)) return false;
      if (macOnly && !runsMacos(d)) return false;
      if (gpuOnly && !accelerated(d)) return false;
      if (makers.length && !makers.includes(makerOf(d))) return false;
      if (gpuFams.length && !gpuFams.includes(d.gpu_family ?? "")) return false;
      return true;
    });
    const time = (v: string) => parseDate(v)?.getTime() ?? 0;
    const now = Math.max(0, ...rows.map((r) => lastChanged(r.device)));
    const scores = new Map(out.map((r) => [r.device.slug, rankScore(r.device, areas, now)]));
    const score = (d: Device) => scores.get(d.slug) ?? 0;
    // Each sort's key, highest first; ties fall back to best overall.
    const repoCount = (d: Device) => new Set([...d.forks.map((f) => f.repo), ...(d.supported_by ?? []).map((s) => s.repo)]).size;
    const fps = (d: Device) => d.gpu_accel?.fps_high ?? d.gpu_accel?.fps_low ?? -1;
    const gpuRank = (d: Device) =>
      (d.gpu_accel ? METHOD_RANK[d.gpu_accel.method] ?? 0 : 0) * 1000 +
      (d.statuses.some((s) => s.area_slug === "metal" && s.state === "works") ? 500 : 0) +
      (accelerated(d) ? 200 : 0) +
      Math.max(0, fps(d));
    const verified = (d: Device) => Math.max(0, ...(d.porting ?? []).map((p) => p.counts.device_verified));
    const key: Record<Exclude<Sort, "name" | "maker">, (d: Device, c: DeviceCardData["counts"]) => number> = {
      best: (d) => score(d),
      working: (_d, c) => c.works * 1000 + reported(c),
      verified,
      updated: (d) => time(d.updated),
      gpu: gpuRank,
      fps,
      ios: (d) => iosRank(d.ios_version ?? ""),
      repos: repoCount,
    };
    return out
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const da = a.r.device;
        const db = b.r.device;
        if (sort === "name") return da.name.localeCompare(db.name);
        if (sort === "maker") return makerOf(da).localeCompare(makerOf(db)) || da.name.localeCompare(db.name);
        const k = key[sort];
        return k(db, b.r.counts) - k(da, a.r.counts) || score(db) - score(da) || a.i - b.i;
      })
      .map((x) => x.r);
  }, [rows, base, bootOnly, macOnly, gpuOnly, makers, gpuFams, sort, areas]);

  // A filter change starts the list from the top again.
  useEffect(() => setShown(PAGE), [base, bootOnly, macOnly, gpuOnly, makers, gpuFams, sort, devices]);

  const visible = view === "cards" ? filtered.slice(0, density === "compact" ? shown * 2 : shown) : filtered;
  const limit = density === "compact" ? shown * 2 : shown;
  const filtering = !!(base || bootOnly || macOnly || gpuOnly || makers.length || gpuFams.length);
  const [sheetOpen, setSheetOpen] = useState(false);
  const clearFilters = () => {
    setBase("");
    setBootOnly(false);
    setMacOnly(false);
    setGpuOnly(false);
    setMakers([]);
    setGpuFams([]);
  };
  const activeCount = (base ? 1 : 0) + makers.length + gpuFams.length + (bootOnly ? 1 : 0) + (macOnly ? 1 : 0) + (gpuOnly ? 1 : 0);

  // The controls (shadcn): search, faceted filters, toggles, a grouped sort menu and the layout tabs.
  const SHEET_ROW = "flex flex-col gap-2";
  const SHEET_LABEL = "text-sm font-medium";
  // Every control: 32px tall, fully rounded, a thin border on a clear background.
  const CONTROL = "h-8 rounded-full border-border bg-transparent dark:bg-transparent pointer-coarse:h-10";
  const familyFacet = (className?: string) =>
    familyOptions.list.length > 0 ? (
      <FacetFilter
        title="Family"
        single
        className={cn(CONTROL, className)}
        selected={base ? [base] : []}
        onChange={(v) => withViewTransition(() => setBase(v[0] ?? ""))}
        options={[
          ...familyOptions.list.map(([f, n]) => ({ value: f, label: familyName(f), count: n })),
          ...(familyOptions.none > 0 ? [{ value: "none", label: "No repo", count: familyOptions.none }] : []),
        ]}
      />
    ) : null;
  const makerFacet = (className?: string) => (
    <FacetFilter title="Maker" className={cn(CONTROL, className)} selected={makers} onChange={(v) => withViewTransition(() => setMakers(v))} options={makerOptions} />
  );
  const gpuFacet = (className?: string) =>
    gpuOptions.length ? (
      <FacetFilter title="GPU" className={cn(CONTROL, className)} selected={gpuFams} onChange={(v) => withViewTransition(() => setGpuFams(v))} options={gpuOptions} />
    ) : null;
  const toggle = (label: string, on: boolean, set: (v: boolean) => void) => (
    <Button
      variant={on ? "secondary" : "outline"}
      size="sm"
      aria-pressed={on}
      className={cn(CONTROL, on && "border-foreground/30 bg-muted dark:bg-muted")}
      onClick={() => withViewTransition(() => set(!on))}
    >
      {on ? <Check aria-hidden /> : null}
      {label}
    </Button>
  );
  const sortMenu = (className?: string) => (
    <Select
      value={sort}
      items={SORT_LABELS}
      onValueChange={(v) => {
        if (v) withViewTransition(() => setSort(v as Sort));
      }}
    >
      <SelectTrigger size="sm" aria-label="Sort" className={cn(CONTROL, "min-w-40 border", className)}>
        <ArrowDownUp className="text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {SORT_GROUPS.map((g, i) => (
          <SelectGroup key={g.label}>
            {i ? <SelectSeparator /> : null}
            <SelectLabel>{g.label}</SelectLabel>
            {g.items.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
  // One switch for the layout: cards, compact cards, table.
  const layout = view === "table" ? "table" : density === "compact" ? "compact" : "cards";
  const setLayout = (v: string) => {
    const nextView: View = v === "table" ? "table" : "cards";
    setView(nextView);
    save(VIEW_KEY, nextView);
    if (v !== "table") {
      const d: Density = v === "compact" ? "compact" : "comfortable";
      setDensity(d);
      save(DENSITY_KEY, d);
    }
  };
  const layoutTabs = (wide?: boolean) => (
    <Tabs value={layout} onValueChange={(v) => setLayout(String(v))} className={cn("gap-0", wide && "w-full")}>
      <TabsList aria-label="Layout" className={cn("h-8! border bg-transparent p-0.5 pointer-coarse:h-10!", wide && "w-full")}>
        {(
          [
            ["cards", "Cards", LayoutGrid],
            ["compact", "Compact", Rows3],
            ["table", "Table", Table2],
          ] as const
        ).map(([v, label, Icon]) => (
          <TabsTrigger key={v} value={v} title={label} aria-label={label} className="h-full px-2.5 text-sm dark:data-active:bg-muted data-active:bg-muted">
            <Icon aria-hidden />
            {wide ? label : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
  return (
    <section aria-labelledby="devices-heading" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="devices-heading" className="mr-2 shrink-0 text-base font-semibold">
          Phones{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {filtering ? `${filtered.length} of ${devices.length}` : devices.length}
          </span>
        </h2>
        {/* Below xl: one Filters button; the filters open in a sheet, so the row never wraps. */}
        <Button variant="outline" size="sm" className={cn(CONTROL, "xl:hidden")} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
          <SlidersHorizontal aria-hidden />
          Filters
          {activeCount > 0 ? <Badge className="ml-0.5 rounded-full tabular-nums">{activeCount}</Badge> : null}
        </Button>
        <div className="hidden min-w-0 items-center gap-2 xl:flex">
          {toggle("Boots", bootOnly, setBootOnly)}
          {toggle("GPU accelerated", gpuOnly, setGpuOnly)}
          {toggle("macOS", macOnly, setMacOnly)}
          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
          {familyFacet()}
          {makerFacet()}
          {gpuFacet()}
        </div>
        {filtering ? (
          <Button variant="ghost" size="sm" className="hidden rounded-full text-muted-foreground xl:inline-flex" onClick={() => withViewTransition(clearFilters)}>
            Reset
            <X aria-hidden />
          </Button>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {sortMenu("hidden sm:flex")}
          {layoutTabs()}
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        footer={
          <>
            {filtering ? (
              <Button variant="outline" className="flex-1" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              Show {filtered.length} {filtered.length === 1 ? "phone" : "phones"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className={SHEET_ROW}>
            <span className={SHEET_LABEL}>Show only</span>
            <div className="flex flex-wrap gap-2">
              {toggle("Boots", bootOnly, setBootOnly)}
              {toggle("GPU accelerated", gpuOnly, setGpuOnly)}
              {toggle("macOS", macOnly, setMacOnly)}
            </div>
          </div>
          <div className={SHEET_ROW}>
            <span className={SHEET_LABEL}>Filter by</span>
            <div className="flex flex-wrap gap-2">
              {familyFacet()}
              {makerFacet()}
              {gpuFacet()}
            </div>
          </div>
          <div className={SHEET_ROW}>
            <span className={SHEET_LABEL}>Sort</span>
            {sortMenu("w-full")}
          </div>
          <div className={SHEET_ROW}>
            <span className={SHEET_LABEL}>Layout</span>
            {layoutTabs(true)}
          </div>
        </div>
      </Sheet>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p>{devices.length === 0 ? emptyText : "No phones match these filters."}</p>
          {filtering ? (
            <Button variant="link" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : view === "cards" ? (
        <>
          <ul
            className={cn(
              "grid gap-3",
              density === "compact"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                : "grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
            )}
          >
            {visible.map((r) => (
              <Reveal as="li" key={r.device.slug} className="min-w-0">
                <DeviceCard data={r} theme={theme} density={density} />
              </Reveal>
            ))}
          </ul>
          {filtered.length > limit ? (
            <InfiniteSentinel onMore={() => setShown((n) => n + PAGE)} count={limit} total={filtered.length} />
          ) : null}
        </>
      ) : (
        <DevicesTable rows={visible} />
      )}
    </section>
  );
}

