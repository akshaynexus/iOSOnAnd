import { useRef } from "react";
import type { ComponentProps, CSSProperties } from "react";
import { useSeenOnce } from "@/components/motion";
import type { AreaState, ClaimStatus, Verified } from "@/lib/client";
import type { StateCounts } from "@/lib/areas";
import { cn } from "@/lib/utils";

/* Every state is an icon plus a colour, never colour alone:
 * works = check (green), in progress = half circle (amber),
 * broken = cross (red), unknown = dash (grey). */

export const STATE_LABELS: Record<AreaState, string> = {
  works: "Works",
  "in-progress": "In progress",
  broken: "Broken",
  unknown: "Unknown",
};

export const STATE_ORDER: AreaState[] = ["works", "in-progress", "broken", "unknown"];

const CELL: Record<AreaState, string> = {
  works: "bg-works-soft text-works-fg",
  "in-progress": "bg-progress-soft text-progress-fg",
  broken: "bg-broken-soft text-broken-fg",
  unknown: "text-muted-foreground/50",
};

const TEXT: Record<AreaState, string> = {
  works: "text-works-fg",
  "in-progress": "text-progress-fg",
  broken: "text-broken-fg",
  unknown: "text-muted-foreground",
};

const BAR: Record<AreaState, string> = {
  works: "bg-works",
  "in-progress": "bg-progress",
  broken: "bg-broken",
  unknown: "bg-unknown",
};

function known(state: string): AreaState {
  return (state in STATE_LABELS ? state : "unknown") as AreaState;
}

export function StateIcon({ state, className, ...props }: { state: AreaState } & ComponentProps<"svg">) {
  const s = known(state);
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      {s === "works" ? <path d="M3.5 8.5l3 3 6-7" /> : null}
      {s === "in-progress" ? (
        <>
          <circle cx="8" cy="8" r="5.25" strokeWidth={1.75} />
          <path d="M8 2.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {s === "broken" ? <path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5" /> : null}
      {s === "unknown" ? <path d="M5.5 8h5" strokeWidth={1.5} /> : null}
    </svg>
  );
}

/** A square matrix cell: tinted fill and icon; unknown is an empty cell with a faint dash. */
export function StateCell({ state, className }: { state: AreaState; className?: string }) {
  const s = known(state);
  return (
    <span className={cn("inline-flex size-7 items-center justify-center rounded-md", CELL[s], className)}>
      <StateIcon state={s} />
    </span>
  );
}

/** Icon and label in the state's colour, for tables and headers. */
export function StateLabel({ state, className }: { state: AreaState; className?: string }) {
  const s = known(state);
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium whitespace-nowrap", TEXT[s], className)}>
      <StateIcon state={s} />
      {STATE_LABELS[s]}
    </span>
  );
}

/** One bar split by state, with the counts beside it. */
export function StatusBar({ counts, className }: { counts: StateCounts; className?: string }) {
  const total = STATE_ORDER.reduce((n, s) => n + counts[s], 0);
  const summary = STATE_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${STATE_LABELS[s].toLowerCase()}`)
    .join(", ");
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div
        ref={ref}
        data-seen={seen === null ? undefined : ""}
        role="img"
        aria-label={summary || "No areas"}
        className="flex h-1.5 min-w-12 flex-1 gap-px overflow-hidden rounded-full bg-unknown"
      >
        {total > 0
          ? STATE_ORDER.filter((s) => s !== "unknown" && counts[s] > 0).map((s, i) => (
              <span
                key={s}
                className={cn("grow-seg", BAR[s])}
                style={{ width: `${(counts[s] / total) * 100}%`, "--seg-delay": `${i * 50}ms` } as CSSProperties}
              />
            ))
          : null}
      </div>
      {total - counts.unknown > 0 ? (
        <StateCountList counts={counts} />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">No reports</span>
      )}
    </div>
  );
}

/** Count per state with its icon; zero counts are dimmed. */
export function StateCountList({ counts }: { counts: StateCounts }) {
  return (
    <ul className="flex shrink-0 items-center gap-2.5 text-xs tabular-nums" aria-hidden>
      {STATE_ORDER.map((s) => (
        <li
          key={s}
          title={STATE_LABELS[s]}
          className={cn(
            "inline-flex items-center gap-1",
            counts[s] > 0 && s !== "unknown" ? TEXT[s] : "text-muted-foreground/70",
            s === "unknown" && "hidden sm:inline-flex",
          )}
        >
          <StateIcon state={s} className="size-3.5" />
          <span className={counts[s] > 0 && s !== "unknown" ? "font-medium" : undefined}>{counts[s]}</span>
        </li>
      ))}
    </ul>
  );
}

/** A cell for an area that does not apply to this device (OneiOS-only area, other base). */
export function NaCell({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,var(--muted)_0_3px,transparent_3px_6px)] text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      N/A
    </span>
  );
}

/** The legend: one line, every state with its cell; `na` adds the "Not applicable" cell. */
export function StateLegend({ className, na = false }: { className?: string; na?: boolean }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      {STATE_ORDER.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <StateCell state={s} className={cn("size-5", s === "unknown" && "border border-dashed border-border")} />
          {STATE_LABELS[s]}
        </li>
      ))}
      {na ? (
        <li className="inline-flex items-center gap-1.5" title="Applies only to OneiOS-based ports">
          <NaCell className="size-5 text-[8px]" />
          Not applicable
        </li>
      ) : null}
    </ul>
  );
}

const PILL = "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap";

const VERIFIED: Record<Verified, { label: string; className: string }> = {
  merged: { label: "Merged", className: "bg-works-soft text-works-fg" },
  reproduced: { label: "Reproduced", className: "bg-progress-soft text-progress-fg" },
  "fork-claim": { label: "Fork claim", className: "border border-border text-muted-foreground" },
};

/** Merged first: the sort order of the Verification column. */
export const VERIFIED_RANK: Record<Verified, number> = { merged: 0, reproduced: 1, "fork-claim": 2 };

export function verifiedLabel(v: Verified): string {
  return (VERIFIED[v] ?? VERIFIED["fork-claim"]).label;
}

export function VerifiedBadge({ verified }: { verified: Verified }) {
  const v = VERIFIED[verified] ?? VERIFIED["fork-claim"];
  return <span className={cn(PILL, v.className)}>{v.label}</span>;
}

const CLAIM: Record<ClaimStatus, string> = {
  approved: "bg-works-soft text-works-fg",
  pending: "bg-progress-soft text-progress-fg",
  rejected: "border border-border text-muted-foreground",
};

export function ClaimBadge({ status }: { status: ClaimStatus }) {
  return (
    <span className={cn(PILL, CLAIM[status] ?? CLAIM.rejected)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
