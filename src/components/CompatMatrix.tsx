import { Fragment, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { NaCell, STATE_LABELS, StateCell, StateLabel, StateLegend } from "@/components/StatusBadge";
import { SourceLink } from "@/components/SourceLink";
import { applicableAreas, applies, entryFor, groupAreas, reported, stateCounts } from "@/lib/areas";
import type { Area, Device, DeviceStatusEntry } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

function CellDetail({ area, device, entry }: { area: Area; device: Device; entry: DeviceStatusEntry }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={80}
        closeDelay={60}
        aria-label={`${area.name} on ${device.name}: ${STATE_LABELS[entry.state] ?? entry.state}`}
        className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StateCell state={entry.state} />
      </PopoverTrigger>
      <PopoverContent side="top" className="flex flex-col gap-2 duration-150 data-open:zoom-in-95 data-closed:zoom-out-95">
        <PopoverTitle>
          {area.name} <span className="font-normal text-muted-foreground">on {device.name}</span>
        </PopoverTitle>
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
      </PopoverContent>
    </Popover>
  );
}

function ColumnPicker({
  devices,
  hidden,
  onChange,
}: {
  devices: Device[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const shown = devices.length - devices.filter((d) => hidden.has(d.slug)).length;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 aria-hidden />
        Devices
        <span className="text-muted-foreground tabular-nums">
          {shown}/{devices.length}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        <fieldset>
          <legend className="sr-only">Devices shown as columns</legend>
          {devices.map((d) => (
            <label
              key={d.slug}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted"
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
        {hidden.size > 0 ? (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange(new Set())}>
            Show all
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Areas (rows, grouped by category) by devices (columns). Scrolls inside its own frame. */
export function CompatMatrix({ areas, devices }: { areas: Area[]; devices: Device[] }) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Devices with the most reported areas first; ties keep the API order.
  const ordered = useMemo(
    () =>
      devices
        .map((d, i) => ({ d, i, n: reported(stateCounts(d, areas)) }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => ({ device: x.d, reported: x.n })),
    [devices, areas],
  );
  const columns = ordered.filter((c) => !hidden.has(c.device.slug));

  const anyNa = columns.some((c) => areas.some((a) => !applies(a, c.device)));
  const hasData = (a: Area) =>
    columns.some((c) => {
      const s = entryFor(c.device, a.slug)?.state;
      return s !== undefined && s !== "unknown";
    });
  const emptyCount = areas.filter((a) => !hasData(a)).length;
  const visibleAreas = hideEmpty ? areas.filter(hasData) : areas;
  const groups = groupAreas(visibleAreas, (a) => a.slug);

  if (devices.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">No devices match.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StateLegend na={anyNa} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
            <input
              type="checkbox"
              className="size-4 accent-(--brand)"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
            />
            Hide areas with no reports
            {emptyCount > 0 ? <span className="text-muted-foreground tabular-nums">({emptyCount})</span> : null}
          </label>
          <ColumnPicker devices={ordered.map((c) => c.device)} hidden={hidden} onChange={setHidden} />
        </div>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
          Every device column is hidden.
        </p>
      ) : (
        <div
          className="max-h-[calc(100dvh-13rem)] overflow-auto rounded-lg border"
          tabIndex={0}
          role="region"
          aria-label="Compatibility matrix"
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 left-0 z-30 h-14 min-w-36 border-r border-b bg-background px-3 text-left text-xs font-medium text-muted-foreground sm:min-w-52"
                >
                  Area
                </th>
                {columns.map(({ device: d, reported: n }) => (
                  <th
                    key={d.slug}
                    scope="col"
                    className="sticky top-0 z-20 h-14 min-w-24 border-b bg-background px-2 text-center align-middle font-normal sm:min-w-32"
                  >
                    <Link
                      to="/device/$slug"
                      params={{ slug: d.slug }}
                      className="block text-sm font-medium whitespace-nowrap hover:underline"
                    >
                      {d.name}
                    </Link>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {n > 0 ? `${n} of ${applicableAreas(d, areas).length} reported` : "No reports"}
                    </span>
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
                        className="sticky left-0 z-10 h-10 border-r border-b bg-background px-3 text-left font-normal group-hover:bg-muted"
                      >
                        <span className="block truncate" title={a.notes || undefined}>
                          {a.name}
                        </span>
                      </th>
                      {columns.map(({ device: d }) => {
                        const entry = entryFor(d, a.slug);
                        const na = !applies(a, d);
                        return (
                          <td
                            key={d.slug}
                            className="h-10 border-b px-2 text-center align-middle group-hover:bg-muted/50"
                          >
                            {na ? (
                              <span title={`${a.name} applies only to OneiOS-based ports`}>
                                <NaCell />
                                <span className="sr-only">Not applicable</span>
                              </span>
                            ) : entry ? (
                              <CellDetail area={a} device={d} entry={entry} />
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
    </div>
  );
}
