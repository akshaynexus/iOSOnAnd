import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Columns3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NaCell, STATE_LABELS, StateCell, StateLabel, StateLegend } from "@/components/StatusBadge";
import { SourceLink } from "@/components/SourceLink";
import { applicableAreas, applies, entryFor, groupAreas, reported, stateCounts } from "@/lib/areas";
import type { Area, Device, DeviceStatusEntry } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

interface ActiveCell {
  el: HTMLElement;
  area: Area;
  device: Device;
  entry: DeviceStatusEntry;
}

/** What one cell's popover shows: the state, the detail, its source and date. */
function CellDetail({ area, device, entry }: Omit<ActiveCell, "el">) {
  return (
    <>
      <PopoverPrimitive.Title className="text-sm font-medium">
        {area.name} <span className="font-normal text-muted-foreground">on {device.name}</span>
      </PopoverPrimitive.Title>
      <StateLabel state={entry.state} />
      {entry.detail ? <p className="leading-snug break-words">{entry.detail}</p> : null}
      {entry.source || entry.updated ? (
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
          {entry.source ? (
            <>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="min-w-0">
                <SourceLink source={entry.source} />
              </dd>
            </>
          ) : null}
          {entry.updated ? (
            <>
              <dt className="text-muted-foreground">Updated</dt>
              <dd>
                <time dateTime={entry.updated} title={formatDate(entry.updated)} suppressHydrationWarning>
                  {relativeTime(entry.updated)}
                </time>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </>
  );
}

function ColumnPicker({
  devices,
  hidden,
  onChange,
  reportedSlugs,
}: {
  devices: Device[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Devices with at least one report: "With reports" shows only these. */
  reportedSlugs: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const shown = devices.length - devices.filter((d) => hidden.has(d.slug)).length;
  const q = query.trim().toLowerCase();
  const list = q ? devices.filter((d) => d.name.toLowerCase().includes(q) || d.slug.includes(q)) : devices;
  const ACTION = "h-8 flex-1 px-2 text-xs";
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 aria-hidden />
        Devices
        <span className="text-muted-foreground tabular-nums">
          {shown}/{devices.length}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[min(70dvh,32rem)] w-72 flex-col gap-1 p-1">
        <div className="relative p-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a device"
            aria-label="Find a device"
            autoComplete="off"
            className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm pointer-coarse:h-11 pointer-coarse:text-base dark:bg-input/30"
          />
        </div>
        <div className="flex gap-1 px-1">
          <Button variant="ghost" size="sm" className={ACTION} onClick={() => onChange(new Set())} disabled={hidden.size === 0}>
            All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={ACTION}
            onClick={() => onChange(new Set(devices.filter((d) => !reportedSlugs.has(d.slug)).map((d) => d.slug)))}
          >
            With reports
          </Button>
          <Button variant="ghost" size="sm" className={ACTION} onClick={() => onChange(new Set(devices.map((d) => d.slug)))}>
            None
          </Button>
        </div>
        <fieldset className="min-h-0 overflow-y-auto overscroll-contain border-t pt-1">
          <legend className="sr-only">Devices shown as columns</legend>
          {list.length === 0 ? <p className="px-2 py-3 text-muted-foreground">No device matches.</p> : null}
          {list.map((d) => (
            <label
              key={d.slug}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted pointer-coarse:h-11"
            >
              <input
                type="checkbox"
                className="size-4 accent-(--brand)"
                checked={!hidden.has(d.slug)}
                onChange={(e) => {
                  const next = new Set(hidden);
                  if (e.target.checked) next.delete(d.slug);
                  else next.add(d.slug);
                  onChange(next);
                }}
              />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Areas (rows, grouped by category) by devices (columns). Scrolls inside its
 * own frame, with the header row and the area column sticky. Every cell is a
 * plain button; one shared popover opens on the cell under the mouse (after a
 * short hover) or on the one tapped, so a grid of thousands of cells does not
 * mount thousands of popovers.
 */
export function CompatMatrix({ areas, devices }: { areas: Area[]; devices: Device[] }) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveCell | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An outside press closes the popover before the click on a cell lands; a
  // click on the cell that just closed it must not open it again.
  const justClosed = useRef<{ el: HTMLElement | null; t: number }>({ el: null, t: 0 });
  // The popover keeps its content and anchor while it fades out.
  const last = useRef<ActiveCell | null>(null);
  if (active) last.current = active;
  const shown = active ?? last.current;

  // Devices with the most reported areas first; ties keep the API order.
  const ordered = useMemo(
    () =>
      devices
        .map((d, i) => ({ d, i, n: reported(stateCounts(d, areas)) }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => ({ device: x.d, reported: x.n })),
    [devices, areas],
  );
  const reportedSlugs = useMemo(() => new Set(ordered.filter((c) => c.reported > 0).map((c) => c.device.slug)), [ordered]);
  const columns = ordered.filter((c) => !hidden.has(c.device.slug));
  const areaBySlug = useMemo(() => new Map(areas.map((a) => [a.slug, a])), [areas]);
  const deviceBySlug = useMemo(() => new Map(devices.map((d) => [d.slug, d])), [devices]);

  const anyNa = columns.some((c) => areas.some((a) => !applies(a, c.device)));
  const hasData = (a: Area) =>
    columns.some((c) => {
      const s = entryFor(c.device, a.slug)?.state;
      return s !== undefined && s !== "unknown";
    });
  const emptyCount = areas.filter((a) => !hasData(a)).length;
  const visibleAreas = hideEmpty ? areas.filter(hasData) : areas;
  const groups = groupAreas(visibleAreas, (a) => a.slug);

  // The cell a popover points at goes away when the columns or rows change.
  useEffect(() => setActive(null), [hidden, hideEmpty, devices]);
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const cellOf = (target: EventTarget | null): ActiveCell | null => {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("button[data-cell]");
    if (!el) return null;
    const area = areaBySlug.get(el.dataset.area ?? "");
    const device = deviceBySlug.get(el.dataset.device ?? "");
    const entry = area && device ? entryFor(device, area.slug) : undefined;
    return area && device && entry ? { el, area, device, entry } : null;
  };
  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const onClick = (e: ReactMouseEvent) => {
    const cell = cellOf(e.target);
    if (!cell) return;
    clearHover();
    const jc = justClosed.current;
    if (jc.el === cell.el && Date.now() - jc.t < 400) return;
    setActive((cur) => (cur?.el === cell.el ? null : cell));
  };
  // Mouse only: hovering a cell opens it after 80 ms; leaving closes it unless
  // the pointer moves into the popover.
  const onPointerOver = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const cell = cellOf(e.target);
    clearHover();
    if (!cell) return;
    hoverTimer.current = setTimeout(() => setActive(cell), 80);
  };
  const onPointerOut = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse" || !cellOf(e.target)) return;
    clearHover();
    hoverTimer.current = setTimeout(() => setActive(null), 120);
  };

  if (devices.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">No devices match.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StateLegend na={anyNa} />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted pointer-coarse:h-11">
            <input
              type="checkbox"
              className="size-4 accent-(--brand)"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
            />
            Hide areas with no reports
            {emptyCount > 0 ? <span className="text-muted-foreground tabular-nums">({emptyCount})</span> : null}
          </label>
          <ColumnPicker devices={ordered.map((c) => c.device)} hidden={hidden} onChange={setHidden} reportedSlugs={reportedSlugs} />
        </div>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
          Every device column is hidden.
        </p>
      ) : (
        // relative: the cells' sr-only labels (position: absolute) are clipped
        // by this frame instead of widening the page by thousands of pixels.
        <div
          className="relative max-h-[calc(100dvh-var(--header-h)-6rem)] overflow-auto overscroll-x-contain rounded-lg border sm:max-h-[calc(100dvh-13rem)]"
          tabIndex={0}
          role="region"
          aria-label="Compatibility matrix"
        >
          <table
            className="w-full border-separate border-spacing-0 text-sm"
            onClick={onClick}
            onPointerOver={onPointerOver}
            onPointerOut={onPointerOut}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 left-0 z-30 h-14 w-32 min-w-32 border-r border-b bg-background px-3 text-left text-xs font-medium text-muted-foreground sm:w-auto sm:min-w-52"
                >
                  Area
                </th>
                {columns.map(({ device: d, reported: n }) => (
                  <th
                    key={d.slug}
                    scope="col"
                    className="sticky top-0 z-20 h-14 w-16 min-w-16 border-b bg-background px-1 py-1.5 text-center align-middle font-normal sm:w-auto sm:min-w-32 sm:px-2"
                  >
                    <Link
                      to="/device/$slug"
                      params={{ slug: d.slug }}
                      title={d.name}
                      className="group/col flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="line-clamp-3 text-xs leading-tight font-medium break-words group-hover/col:underline sm:line-clamp-none sm:text-sm sm:whitespace-nowrap">
                        {d.name}
                      </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {n > 0 ? (
                        <>
                          <span className="sm:hidden">
                            {n}/{applicableAreas(d, areas).length}
                          </span>
                          <span className="hidden sm:inline">
                            {n} of {applicableAreas(d, areas).length} reported
                          </span>
                        </>
                      ) : (
                        "No reports"
                      )}
                    </span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                    No area has a report on the devices shown.
                  </td>
                </tr>
              ) : null}
              {groups.map((g, gi) => (
                <Fragment key={g.category.id}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={columns.length + 1}
                      className="h-8 border-b bg-muted/60 p-0 text-left text-xs font-medium text-muted-foreground"
                    >
                      <span className="sticky left-0 inline-block px-3">{g.category.name}</span>
                    </th>
                  </tr>
                  {g.items.map((a) => (
                    <tr
                      key={a.slug}
                      className="group fade-group"
                      style={{ "--group-delay": `${Math.min(gi, 8) * 60}ms` } as CSSProperties}
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 h-11 w-32 min-w-32 border-r border-b bg-background px-3 text-left font-normal group-hover:bg-muted sm:w-auto"
                      >
                        <span className="line-clamp-2 leading-tight break-words" title={a.notes || undefined}>
                          {a.name}
                        </span>
                      </th>
                      {columns.map(({ device: d }) => {
                        const entry = entryFor(d, a.slug);
                        const na = !applies(a, d);
                        return (
                          <td key={d.slug} className="h-11 border-b px-1 text-center align-middle group-hover:bg-muted/50 sm:px-2">
                            {na ? (
                              <span title={`${a.name} applies only to OneiOS-based ports`}>
                                <NaCell />
                                <span className="sr-only">Not applicable</span>
                              </span>
                            ) : entry ? (
                              <button
                                type="button"
                                data-cell=""
                                data-area={a.slug}
                                data-device={d.slug}
                                aria-haspopup="dialog"
                                aria-expanded={active?.area.slug === a.slug && active.device.slug === d.slug}
                                aria-label={`${a.name} on ${d.name}: ${STATE_LABELS[entry.state] ?? entry.state}`}
                                className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <StateCell state={entry.state} />
                              </button>
                            ) : (
                              <>
                                <StateCell state="unknown" className="opacity-60" />
                                <span className="sr-only">No report</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PopoverPrimitive.Root
        open={active !== null}
        onOpenChange={(open, details) => {
          if (open) return;
          if (details.reason === "outside-press") justClosed.current = { el: active?.el ?? null, t: Date.now() };
          setActive(null);
        }}
      >
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            anchor={shown?.el}
            side="top"
            sideOffset={6}
            collisionPadding={12}
            className="isolate z-50"
          >
            <PopoverPrimitive.Popup
              initialFocus={false}
              finalFocus={false}
              onPointerEnter={clearHover}
              onPointerLeave={(e) => {
                if (e.pointerType !== "mouse") return;
                clearHover();
                hoverTimer.current = setTimeout(() => setActive(null), 120);
              }}
              className="flex w-72 max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) flex-col gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            >
              {shown ? <CellDetail area={shown.area} device={shown.device} entry={shown.entry} /> : null}
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
