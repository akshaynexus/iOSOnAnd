import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/Field";
import { NaCell, STATE_LABELS, STATE_ORDER, StateIcon, StateLabel } from "@/components/StatusBadge";
import { SourceLink } from "@/components/SourceLink";
import { useAction } from "@/components/useAction";
import { flash } from "@/components/motion";
import { groupAreas } from "@/lib/areas";
import { OS_LABELS, STATES, setStatus, type Area, type AreaState, type DeviceStatusEntry, type Os } from "@/lib/client";
import { cn, formatDate, relativeTime } from "@/lib/utils";

export interface AreaRowData {
  area: Area;
  entry: DeviceStatusEntry | undefined;
  /** False: the area only applies to OneiOS-based ports (shown N/A, not editable). */
  applies?: boolean;
}

function AreaEditForm({
  deviceSlug,
  row,
  os = "ios",
  onDone,
  onSaved,
}: {
  deviceSlug: string;
  row: AreaRowData;
  /** The system the row is about (the page's iOS / macOS / tvOS switch). */
  os?: Os;
  onDone: () => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { area, entry } = row;
  const [state, setState] = useState<AreaState>(entry?.state ?? "unknown");
  const [detail, setDetail] = useState(entry?.detail ?? "");
  const [source, setSource] = useState(entry?.source ?? "");
  const idp = `area-${area.slug}`;
  const [save, saving] = useAction(async () => {
    await setStatus(deviceSlug, area.slug, { state, detail: detail.trim(), source: source.trim(), os });
    toast.success(`${area.name}${os === "ios" ? "" : ` on ${OS_LABELS[os]}`}: ${STATE_LABELS[state]}`);
    await router.invalidate();
    onDone();
    onSaved?.();
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
      className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,16rem)] md:items-start"
    >
      <Field id={`${idp}-state`} label="State">
        <NativeSelect
          id={`${idp}-state`}
          value={state}
          onChange={(e) => setState(e.target.value as AreaState)}
          autoFocus
        >
          {STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${idp}-detail`} label="Detail">
        <Textarea id={`${idp}-detail`} value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
      </Field>
      <Field id={`${idp}-source`} label="Source">
        <Input
          id={`${idp}-source`}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="A log, a doc section, a commit"
        />
      </Field>
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A detail cut to three lines on phones, with a More / Less toggle when it is cut. */
function Detail({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || open || typeof ResizeObserver === "undefined") return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <div className="min-w-0">
      <p ref={ref} id={id} className={cn("break-words", !open && "max-md:line-clamp-3")}>
        {text}
      </p>
      {cut || open ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="-ml-1 inline-flex min-h-8 items-center rounded-md px-1 text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

type Filter = "all" | AreaState;

const FILTER_LABELS: Record<Filter, string> = { all: "All", ...STATE_LABELS };
const EMPTY_TEXT: Record<AreaState, string> = {
  works: "No area works yet.",
  "in-progress": "No area is in progress.",
  broken: "No area is broken.",
  unknown: "Every area has a report.",
};
const ICON_TEXT: Record<AreaState, string> = {
  works: "text-works-fg",
  "in-progress": "text-progress-fg",
  broken: "text-broken-fg",
  unknown: "text-muted-foreground",
};

function stateOf(r: AreaRowData): AreaState {
  const s = r.entry?.state;
  return s && s in STATE_LABELS ? s : "unknown";
}

/**
 * Columns from md up (Area, State, Detail; Source and Updated get their own
 * columns from lg up). Below md each area is a card: name and state, the
 * detail, then source and date.
 */
const COLS = "md:grid-cols-[10rem_8rem_minmax(0,1fr)] lg:grid-cols-[12rem_8.5rem_minmax(0,1fr)_minmax(0,10rem)_6rem]";
const COLS_EDIT =
  "md:grid-cols-[10rem_8rem_minmax(0,1fr)_2.75rem] lg:grid-cols-[12rem_8.5rem_minmax(0,1fr)_minmax(0,10rem)_6rem_2.75rem]";

/**
 * The device's areas grouped by category, with a state filter; editors get an
 * edit button per area. The category headings stick under the top bar.
 */
export function AreaTable({
  deviceSlug,
  rows,
  editable,
  os = "ios",
}: {
  deviceSlug: string;
  rows: AreaRowData[];
  editable: boolean;
  /** Which system's rows these are; edits are written for it. */
  os?: Os;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [saved, setSaved] = useState<{ slug: string; n: number } | null>(null);
  // Highlight the row a save just changed.
  useEffect(() => {
    if (!saved) return;
    flash(document.querySelector(`[data-area-row="${saved.slug}"]`));
  }, [saved]);

  const counts = { works: 0, "in-progress": 0, broken: 0, unknown: 0 } as Record<AreaState, number>;
  for (const r of rows) if (r.applies !== false) counts[stateOf(r)]++;
  const shown = filter === "all" ? rows : rows.filter((r) => r.applies !== false && stateOf(r) === filter);
  const groups = groupAreas(shown, (r) => r.area.slug);
  const cols = editable ? COLS_EDIT : COLS;
  const TH = "text-xs font-medium text-muted-foreground";

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Show areas by state" className="flex flex-wrap gap-1.5">
        {(["all", ...STATE_ORDER] as Filter[]).map((f) => {
          const n = f === "all" ? rows.length : counts[f];
          const on = filter === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              disabled={n === 0 && !on}
              onClick={() => setFilter(on && f !== "all" ? "all" : f)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                on ? "border-foreground/40 bg-muted font-medium" : "hover:bg-muted",
              )}
            >
              {f === "all" ? null : <StateIcon state={f} className={cn("size-3.5", ICON_TEXT[f])} />}
              {FILTER_LABELS[f]}
              <span className="text-muted-foreground tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* overflow-clip, not hidden: the category headings stay sticky against the page. */}
      <div className="overflow-clip rounded-lg border">
        <div aria-hidden className={cn("hidden h-9 items-center gap-x-4 border-b bg-muted/40 px-3 md:grid", cols)}>
          <span className={TH}>Area</span>
          <span className={TH}>State</span>
          <span className={TH}>Detail</span>
          <span className={cn(TH, "hidden lg:block")}>Source</span>
          <span className={cn(TH, "hidden lg:block")}>Updated</span>
        </div>
        {groups.length === 0 && filter !== "all" ? (
          <p className="px-4 py-6 text-center text-muted-foreground">{EMPTY_TEXT[filter]}</p>
        ) : null}
        {groups.map((g) => (
          <section key={g.category.id} aria-label={g.category.name} className="border-b last:border-b-0">
            <h3 className="sticky top-(--header-h) z-10 border-b bg-muted px-4 py-1.5 text-xs font-medium text-muted-foreground md:px-3">
              {g.category.name}
            </h3>
            <ul className="divide-y">
              {g.items.map((r) => {
                const { area, entry } = r;
                const state = stateOf(r);
                if (r.applies === false) {
                  return (
                    <li
                      key={area.slug}
                      className={cn("flex items-center gap-3 px-4 py-2 text-muted-foreground md:grid md:gap-x-4 md:px-3", cols)}
                    >
                      <span className="min-w-0 flex-1 font-medium">{area.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
                        <NaCell className="size-6" label={false} />
                        <span className="md:hidden">OneiOS ports only</span>
                        <span className="hidden md:inline">Not applicable</span>
                      </span>
                      <span className="hidden md:block lg:col-span-3">Applies only to OneiOS-based ports.</span>
                    </li>
                  );
                }
                if (editing === area.slug) {
                  return (
                    <li key={area.slug} className="bg-muted/30 px-4 py-3 md:px-3">
                      <p className="mb-2 font-medium">{area.name}</p>
                      <AreaEditForm
                        deviceSlug={deviceSlug}
                        row={r}
                        os={os}
                        onDone={() => setEditing(null)}
                        onSaved={() => setSaved((p) => ({ slug: area.slug, n: (p?.n ?? 0) + 1 }))}
                      />
                    </li>
                  );
                }
                // Nothing reported beyond the state: one line on phones.
                const bare = !entry?.detail && !entry?.source && !entry?.updated;
                const date = entry?.updated ? (
                  <time dateTime={entry.updated} title={formatDate(entry.updated)} suppressHydrationWarning>
                    {relativeTime(entry.updated)}
                  </time>
                ) : null;
                return (
                  <li
                    key={area.slug}
                    data-area-row={area.slug}
                    className={cn(
                      "flex flex-col gap-1.5 px-4 transition-colors hover:bg-muted/50 md:grid md:items-start md:gap-x-4 md:gap-y-1 md:px-3 md:py-2.5",
                      bare ? "py-2.5" : "py-3",
                      cols,
                    )}
                  >
                    <div className="flex items-start gap-3 md:contents">
                      <h4 className="min-w-0 flex-1 font-medium md:col-start-1 md:row-start-1">{area.name}</h4>
                      <span className="shrink-0 md:col-start-2 md:row-start-1">
                        <StateLabel state={state} />
                      </span>
                      {editable ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="-my-2.5 -mr-2 shrink-0 md:col-start-4 md:row-span-2 md:row-start-1 md:my-0 md:mr-0 lg:col-start-6"
                          onClick={() => setEditing(area.slug)}
                          aria-label={`Edit ${area.name}`}
                          title="Edit"
                        >
                          <Pencil />
                        </Button>
                      ) : null}
                    </div>
                    <div className={cn("md:col-start-3 md:row-start-1", bare && "max-md:hidden")}>
                      {entry?.detail ? (
                        <Detail text={entry.detail} />
                      ) : (
                        <span className="text-muted-foreground">No detail</span>
                      )}
                    </div>
                    {entry?.source || date ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:col-start-3 md:row-start-2 lg:contents">
                        {entry?.source ? (
                          <span className="max-w-full min-w-0 lg:col-start-4 lg:row-start-1">
                            <SourceLink source={entry.source} />
                          </span>
                        ) : null}
                        {date ? (
                          <span className="whitespace-nowrap lg:col-start-5 lg:row-start-1 lg:text-sm">{date}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
