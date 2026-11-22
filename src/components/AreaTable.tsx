import { Fragment, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { NaCell, STATE_LABELS, StateLabel } from "@/components/StatusBadge";
import { SourceLink } from "@/components/SourceLink";
import { useAction } from "@/components/useAction";
import { flash } from "@/components/motion";
import { groupAreas } from "@/lib/areas";
import { STATES, setStatus, type Area, type AreaState, type DeviceStatusEntry } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

export interface AreaRowData {
  area: Area;
  entry: DeviceStatusEntry | undefined;
  /** False: the area only applies to OneiOS-based ports (shown N/A, not editable). */
  applies?: boolean;
}

function AreaEditForm({
  deviceSlug,
  row,
  onDone,
  onSaved,
}: {
  deviceSlug: string;
  row: AreaRowData;
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
    await setStatus(deviceSlug, area.slug, { state, detail: detail.trim(), source: source.trim() });
    toast.success(`${area.name}: ${STATE_LABELS[state]}`);
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
      className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-end"
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
        <Input id={`${idp}-detail`} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      <Field id={`${idp}-source`} label="Source">
        <Input
          id={`${idp}-source`}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="A log, a doc section, a commit"
        />
      </Field>
      <div className="flex gap-2">
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

const TH = "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";

/** The device's areas grouped by category; editors get an Edit button per row. */
export function AreaTable({
  deviceSlug,
  rows,
  editable,
}: {
  deviceSlug: string;
  rows: AreaRowData[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ slug: string; n: number } | null>(null);
  // Highlight the row a save just changed.
  useEffect(() => {
    if (!saved) return;
    flash(document.querySelector(`[data-area-row="${saved.slug}"]`));
  }, [saved]);
  const groups = groupAreas(rows, (r) => r.area.slug);
  const cols = 5 + (editable ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th scope="col" className={`${TH} w-48`}>
              Area
            </th>
            <th scope="col" className={`${TH} w-32`}>
              State
            </th>
            <th scope="col" className={TH}>
              Detail
            </th>
            <th scope="col" className={`${TH} hidden lg:table-cell`}>
              Source
            </th>
            <th scope="col" className={`${TH} hidden w-28 md:table-cell`}>
              Updated
            </th>
            {editable ? (
              <th scope="col" className="w-0 px-2">
                <span className="sr-only">Edit</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.category.id}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={cols}
                  className="h-8 border-b bg-muted/60 px-3 text-left text-xs font-medium text-muted-foreground"
                >
                  {g.category.name}
                </th>
              </tr>
              {g.items.map((r) => {
                const { area, entry } = r;
                const state = entry?.state ?? "unknown";
                if (r.applies === false) {
                  return (
                    <tr key={area.slug} className="border-b last:border-0">
                      <th scope="row" className="px-3 py-2.5 text-left align-top font-medium text-muted-foreground">
                        {area.name}
                      </th>
                      <td className="px-3 py-2.5 align-top">
                        <span className="inline-flex items-center gap-2 whitespace-nowrap text-muted-foreground">
                          <NaCell className="size-6 text-[9px]" />
                          Not applicable
                        </span>
                      </td>
                      <td colSpan={cols - 2} className="px-3 py-2.5 align-top text-muted-foreground">
                        Applies only to OneiOS-based ports.
                      </td>
                    </tr>
                  );
                }
                if (editing === area.slug) {
                  return (
                    <tr key={area.slug} className="border-b bg-muted/30">
                      <td colSpan={cols} className="px-3 py-3">
                        <p className="mb-2 font-medium">{area.name}</p>
                        <AreaEditForm
                          deviceSlug={deviceSlug}
                          row={r}
                          onDone={() => setEditing(null)}
                          onSaved={() => setSaved((p) => ({ slug: area.slug, n: (p?.n ?? 0) + 1 }))}
                        />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={area.slug} data-area-row={area.slug} className="border-b transition-colors last:border-0 hover:bg-muted/50">
                    <th scope="row" className="px-3 py-2.5 text-left align-top font-medium">
                      {area.name}
                    </th>
                    <td className="px-3 py-2.5 align-top">
                      <StateLabel state={state} />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {entry?.detail ? (
                        <span className="break-words">{entry.detail}</span>
                      ) : (
                        <span className="text-muted-foreground">No detail</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 align-top text-muted-foreground lg:table-cell">
                      {entry?.source ? <SourceLink source={entry.source} /> : null}
                    </td>
                    <td className="hidden px-3 py-2.5 align-top whitespace-nowrap text-muted-foreground md:table-cell">
                      {entry?.updated ? (
                        <time dateTime={entry.updated} title={formatDate(entry.updated)} suppressHydrationWarning>
                          {relativeTime(entry.updated)}
                        </time>
                      ) : null}
                    </td>
                    {editable ? (
                      <td className="px-2 py-1.5 align-top">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditing(area.slug)}
                          aria-label={`Edit ${area.name}`}
                          title="Edit"
                        >
                          <Pencil />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
