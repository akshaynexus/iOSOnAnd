/**
 * "Porting records" on a phone's page: each port repo's record from a porting
 * framework (UniXNU's device records, as on unixnu.com/devices): the OS
 * profile, a summary, and each area's status (verified on the device, on the
 * host, implemented, planned). Opening one loads the full record: per area
 * the components, what it achieved, limits, next step and build commands.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getPortingRecord, type PortingRecord, type PortingRecordSummary } from "@/lib/client";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { label: string; cls: string }> = {
  "device-verified": { label: "On device", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  "host-verified": { label: "Host tested", cls: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  implemented: { label: "Implemented", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  planned: { label: "Planned", cls: "border-border bg-muted text-muted-foreground" },
  "not-applicable": { label: "Not applicable", cls: "border-border text-muted-foreground" },
};

/** The areas people look for first, then the rest in record order. */
const FIRST = ["display", "input", "gpu", "storage", "network", "audio", "bluetooth", "cellular", "camera", "power", "cpu", "memory", "firmware"];

function AreaChip({ id, status }: { id: string; status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "border-border text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs", s.cls)} title={`${id}: ${s.label}`}>
      <span className="font-medium">{id}</span>
      <span className="opacity-80">{s.label}</span>
    </span>
  );
}

function orderAreas(status: Record<string, string>): Array<[string, string]> {
  const entries = Object.entries(status).filter(([, s]) => s !== "not-applicable");
  return entries.sort(([a], [b]) => {
    const ia = FIRST.indexOf(a);
    const ib = FIRST.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function RecordDetail({ record }: { record: PortingRecord }) {
  const areas = [...record.areas].filter((a) => a.status !== "not-applicable" && (a.completion.length || a.limits.length || a.components.length));
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {areas.slice(0, 24).map((a) => (
        <div key={a.id} className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <AreaChip id={a.id} status={a.status} />
            {a.components.length ? <span className="font-mono text-xs break-all text-muted-foreground">{a.components.join(", ")}</span> : null}
          </div>
          {a.completion[0] ? <p className="text-sm break-words">{a.completion[0]}</p> : null}
          {a.limits[0] ? <p className="text-xs break-words text-muted-foreground">Limits: {a.limits[0]}</p> : null}
          {a.next_action[0] ? <p className="text-xs break-words text-muted-foreground">Next: {a.next_action[0]}</p> : null}
          {a.procedure.length ? (
            <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {a.procedure.slice(0, 4).join("\n")}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RecordCard({ r }: { r: PortingRecordSummary }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<PortingRecord | null>(null);
  const [loading, setLoading] = useState(false);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !full && !loading) {
      setLoading(true);
      try {
        setFull((await getPortingRecord(r.key)).record);
      } finally {
        setLoading(false);
      }
    }
  }
  const areas = orderAreas(r.area_status);
  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {r.repo ? (
          <a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-medium break-all underline-offset-4 hover:underline">
            {r.repo}
          </a>
        ) : (
          <span className="font-mono text-sm font-medium">{r.record}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {r.framework}
          {r.os_profile ? ` · ${r.os_profile}` : ""} · {r.counts.device_verified} on device, {r.counts.implemented + r.counts.host_verified} in progress
        </span>
      </div>
      {r.summary ? <p className="line-clamp-3 text-sm break-words text-muted-foreground">{r.summary}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {areas.slice(0, open ? areas.length : 10).map(([id, s]) => (
          <AreaChip key={id} id={id} status={s} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => void toggle()} aria-expanded={open} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          {open ? "Hide details" : "Components, limits and build steps"}
        </button>
        {r.page_url ? (
          <a href={r.page_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline-offset-4 hover:underline">
            Record on {r.framework}
          </a>
        ) : null}
      </div>
      {open ? loading ? <p className="text-xs text-muted-foreground">Loading</p> : full ? <RecordDetail record={full} /> : null : null}
    </li>
  );
}

export function PortingRecords({ records }: { records: PortingRecordSummary[] }) {
  const [all, setAll] = useState(false);
  if (!records.length) return null;
  const shown = all ? records : records.slice(0, 4);
  return (
    <section aria-labelledby="porting-heading" className="flex flex-col gap-3">
      <h2 id="porting-heading" className="text-base font-semibold">
        Porting records
      </h2>
      <ul className="flex flex-col divide-y overflow-hidden rounded-[14px] border bg-card text-card-foreground">
        {shown.map((r) => (
          <RecordCard key={r.key} r={r} />
        ))}
      </ul>
      {records.length > 4 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="self-start text-sm font-medium underline-offset-4 hover:underline">
          {all ? "Show fewer" : `Show all ${records.length}`}
        </button>
      ) : null}
    </section>
  );
}
