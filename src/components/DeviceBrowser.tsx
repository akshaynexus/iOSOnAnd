import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Rows3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/Field";
import { DeviceCard, type DeviceCardData, type Density } from "@/components/DeviceCard";
import { DevicesTable } from "@/components/DevicesTable";
import { useThemeMode } from "@/components/common";
import { Reveal, withViewTransition } from "@/components/motion";
import { familiesOfDevice, familyName, forksByRepo, mainRepoOf } from "@/components/repoInfo";
import { boots, makerOf, reported, stateCounts } from "@/lib/areas";
import type { Area, Device, Fork } from "@/lib/client";
import { parseDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type View = "cards" | "table";
type Sort = "working" | "name" | "updated";
const VIEW_KEY = "iosonand.overview.view";
const DENSITY_KEY = "iosonand.overview.density";
const PAGE = 24;
/** The owner's main device: first under the default sort. */
const MAIN_DEVICE = "s24-ultra";

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

/** Devices on the Overview: filters, sort, cards or table, and "Show more". */
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
  const [maker, setMaker] = useState("");
  const [sort, setSort] = useState<Sort>("working");
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
  const makers = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devices) m.set(makerOf(d), (m.get(makerOf(d)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [devices]);
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
      if (maker && makerOf(d) !== maker) return false;
      return true;
    });
    const time = (v: string) => parseDate(v)?.getTime() ?? 0;
    return out
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        if (sort === "name") return a.r.device.name.localeCompare(b.r.device.name);
        if (sort === "updated") return time(b.r.device.updated) - time(a.r.device.updated) || a.i - b.i;
        // Default: the main device, then OneiOS-based phones, then by working areas.
        const pin = (d: Device) => (d.slug === MAIN_DEVICE ? 0 : d.base === "oneios" ? 1 : 2);
        return (
          pin(a.r.device) - pin(b.r.device) ||
          b.r.counts.works - a.r.counts.works ||
          reported(b.r.counts) - reported(a.r.counts) ||
          b.r.device.forks.length - a.r.device.forks.length ||
          a.i - b.i
        );
      })
      .map((x) => x.r);
  }, [rows, base, bootOnly, maker, sort]);

  // A filter change starts the list from the top again.
  useEffect(() => setShown(PAGE), [base, bootOnly, maker, sort, devices]);

  const visible = view === "cards" ? filtered.slice(0, density === "compact" ? shown * 2 : shown) : filtered;
  const limit = density === "compact" ? shown * 2 : shown;
  const filtering = !!(base || bootOnly || maker);

  return (
    <section aria-labelledby="devices-heading" className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="devices-heading" className="mr-auto text-base font-semibold">
          Phones{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {filtering ? `${filtered.length} of ${devices.length}` : devices.length}
          </span>
        </h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {familyOptions.list.length > 0 ? (
            <>
              <label htmlFor="flt-base" className="sr-only">
                Based on
              </label>
              <NativeSelect id="flt-base" value={base} onChange={(e) => {
                  const v = e.target.value;
                  withViewTransition(() => setBase(v));
                }} className="h-8 min-w-36 basis-36 flex-1 sm:w-auto sm:flex-none">
                <option value="">Any family</option>
                {familyOptions.list.map(([f, n]) => (
                  <option key={f} value={f}>
                    {familyName(f)} ({n})
                  </option>
                ))}
                {familyOptions.none > 0 ? <option value="none">No repo ({familyOptions.none})</option> : null}
              </NativeSelect>
            </>
          ) : null}
          <label htmlFor="flt-maker" className="sr-only">
            Maker
          </label>
          <NativeSelect id="flt-maker" value={maker} onChange={(e) => {
              const v = e.target.value;
              withViewTransition(() => setMaker(v));
            }} className="h-8 min-w-36 basis-36 flex-1 sm:w-auto sm:flex-none">
            <option value="">Any maker</option>
            {makers.map(([m, n]) => (
              <option key={m} value={m}>
                {m} ({n})
              </option>
            ))}
          </NativeSelect>
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input px-2.5 text-sm hover:bg-muted dark:bg-input/30">
            <input
              type="checkbox"
              className="size-4 accent-(--brand)"
              checked={bootOnly}
              onChange={(e) => {
                const v = e.target.checked;
                withViewTransition(() => setBootOnly(v));
              }}
            />
            Boots
          </label>
          <label htmlFor="flt-sort" className="sr-only">
            Sort
          </label>
          <NativeSelect
            id="flt-sort"
            value={sort}
            onChange={(e) => {
              const v = e.target.value as Sort;
              withViewTransition(() => setSort(v));
            }}
            className="h-8 min-w-36 basis-36 flex-1 sm:w-auto sm:flex-none"
          >
            <option value="working">Most working areas</option>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </NativeSelect>
          <div role="group" aria-label="View" className="inline-flex rounded-md border p-0.5">
            {(
              [
                ["cards", "Cards", LayoutGrid],
                ["table", "Table", Table2],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  save(VIEW_KEY, v);
                }}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          {view === "cards" ? (
            <div role="group" aria-label="Density" className="inline-flex rounded-md border p-0.5">
              {(
                [
                  ["comfortable", "Comfortable", LayoutGrid],
                  ["compact", "Compact", Rows3],
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={density === v}
                  title={label}
                  onClick={() => {
                    setDensity(v);
                    save(DENSITY_KEY, v);
                  }}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    density === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden lg:inline">{label}</span>
                  <span className="sr-only lg:hidden">{label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p>{devices.length === 0 ? emptyText : "No phones match these filters."}</p>
          {filtering ? (
            <Button
              variant="link"
              onClick={() => {
                setBase("");
                setBootOnly(false);
                setMaker("");
              }}
            >
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
                : "grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
            )}
          >
            {visible.map((r) => (
              <Reveal as="li" key={r.device.slug} className="min-w-0">
                <DeviceCard data={r} theme={theme} density={density} />
              </Reveal>
            ))}
          </ul>
          {filtered.length > limit ? (
            <div className="flex flex-col items-center gap-1">
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Show more
              </Button>
              <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {limit} of {filtered.length}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <DevicesTable rows={visible} />
      )}
    </section>
  );
}

