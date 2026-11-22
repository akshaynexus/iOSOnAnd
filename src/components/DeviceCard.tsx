import { memo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import ReflectiveCard from "@/components/reactbits/ReflectiveCard";
import { useGlSlot } from "@/components/reactbits/glBudget";
import { PhoneOutline } from "@/components/common";
import { STATE_LABELS } from "@/components/StatusBadge";
import { familyName } from "@/components/repoInfo";
import { useSeenOnce } from "@/components/motion";
import { makerOf, type StateCounts } from "@/lib/areas";
import { maintainersOf, type AreaState, type Device } from "@/lib/client";
import { cn, vtName } from "@/lib/utils";

/** The device's photo: its own image_url, else its newest uploaded image. */
export function devicePhoto(d: Pick<Device, "image_url" | "latest_media">): string | null {
  if (d.image_url) return d.image_url;
  const m = d.latest_media;
  if (m && (m.kind === "image" || m.content_type?.startsWith("image/")) && m.url) return m.url;
  return null;
}

const DOT: Record<AreaState, string> = {
  works: "#22c55e",
  "in-progress": "#f59e0b",
  broken: "#ef4444",
  unknown: "#a1a1aa",
};

/** works / in progress / broken as one segmented bar; unknown is the track. */
export function SegmentBar({ counts, className }: { counts: StateCounts; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const total = counts.works + counts["in-progress"] + counts.broken + counts.unknown;
  const parts: [AreaState, string][] = [
    ["works", "bg-works"],
    ["in-progress", "bg-progress"],
    ["broken", "bg-broken"],
  ];
  const label =
    parts
      .filter(([s]) => counts[s] > 0)
      .map(([s]) => `${counts[s]} ${STATE_LABELS[s].toLowerCase()}`)
      .join(", ") || "No reports";
  return (
    <div
      ref={ref}
      role="img"
      aria-label={`${label}, of ${total} areas`}
      title={`${label}, of ${total} areas`}
      data-seen={seen === null ? undefined : ""}
      className={cn("flex h-1 w-full gap-px overflow-hidden rounded-full bg-(--rc-track)", className)}
    >
      {total > 0
        ? parts
            .filter(([s]) => counts[s] > 0)
            .map(([s, bg], i) => (
              <span
                key={s}
                className={cn("grow-seg", bg)}
                style={{ width: `${(counts[s] / total) * 100}%`, "--seg-delay": `${i * 50}ms` } as CSSProperties}
              />
            ))
        : null}
    </div>
  );
}

export interface DeviceCardData {
  device: Device;
  counts: StateCounts;
  mainRepo: string | null;
  /** What the port is based on, main first; [] = no repo (repoInfo.familiesOfDevice). */
  families: string[];
}

/**
 * The family chip: the first family, "+N" for more (all of them on hover);
 * "No repo" when the phone has none. `card` uses the ReflectiveCard's chip style.
 */
export function FamilyChip({ families, card = false }: { families: string[]; card?: boolean }) {
  const names = families.map(familyName);
  const muted = names.length === 0 || families[0] === "unknown";
  const label = names.length === 0 ? "No repo" : names[0];
  const extra = names.length > 1 ? `+${names.length - 1}` : null;
  const title = names.length > 1 ? `Based on ${names.join(", ")}` : names.length === 1 ? `Based on ${names[0]}` : "No repo tracked";
  return (
    <span
      title={title}
      className={cn(
        card
          ? "device-card__chip"
          : "inline-flex h-5 max-w-44 items-center gap-1 rounded-full border px-2 text-xs whitespace-nowrap",
        muted && (card ? "text-(--rc-muted)" : "text-muted-foreground"),
      )}
    >
      <span className="truncate">{label}</span>
      {extra ? <span className={card ? "text-(--rc-muted)" : "text-muted-foreground"}>{extra}</span> : null}
    </span>
  );
}

export type Density = "comfortable" | "compact";

/** The photo, or a small light outline with the maker's name so it never reads as a broken image. */
function Photo({ src, name, maker, compact, vt }: { src: string | null; name: string; maker: string; compact?: boolean; vt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex flex-col items-center gap-1 text-(--rc-muted) opacity-60" style={vt ? { viewTransitionName: vt } : undefined}>
        <PhoneOutline className={compact ? "h-9 w-auto" : "h-[70px] w-auto"} />
        {compact ? null : <span className="text-[10px] tracking-wide">{maker === "Other" ? "No photo" : maker}</span>}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={vt ? { viewTransitionName: vt } : undefined}
      className="max-h-full max-w-full rounded-md object-contain"
    />
  );
}

function IosVersion({ value, compact, vt }: { value?: string; compact?: boolean; vt?: string }) {
  if (!value) {
    return (
      <span
        className="device-card__chip w-fit text-(--rc-muted)"
        style={vt ? { viewTransitionName: vt } : undefined}
        title="iOS version not stated"
        aria-label="iOS version not stated"
      >
        iOS ?
      </span>
    );
  }
  return (
    <p
      style={vt ? { viewTransitionName: vt } : undefined}
      className={cn("w-fit max-w-full truncate font-semibold tracking-tight text-(--rc-ink)", compact ? "text-sm" : "text-lg leading-6")}
    >
      {value}
    </p>
  );
}

/**
 * One phone as a React Bits ReflectiveCard (comfortable: ~300 px tall;
 * compact: an 88 px row). The WebGL metal runs only while the card holds a
 * slot from glBudget (near the viewport, under the cap); otherwise the same
 * card renders with the CSS sheen. The webcam stays off.
 */
export const DeviceCard = memo(function DeviceCard({
  data,
  theme,
  density = "comfortable",
}: {
  data: DeviceCardData;
  theme: "dark" | "light";
  density?: Density;
}) {
  const { device: d, counts, mainRepo, families } = data;
  const ref = useRef<HTMLAnchorElement>(null);
  const live = useGlSlot(ref, "card");
  const maintainers = maintainersOf(d);
  const state = (d.status in STATE_LABELS ? d.status : "unknown") as AreaState;
  const photo = devicePhoto(d);
  const sub = [d.model, d.soc].filter(Boolean).join(" · ");
  const compact = density === "compact";
  const owner = maintainers.length > 0 ? maintainers.join(", ") : "Unclaimed";
  const repoLine = mainRepo ?? "No repo";

  return (
    <Link
      ref={ref}
      to="/device/$slug"
      params={{ slug: d.slug }}
      aria-label={`${d.name}${d.ios_version ? `, ${d.ios_version}` : ""}, ${STATE_LABELS[state]}`}
      className="device-card block rounded-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring"
      data-density={density}
    >
      <ReflectiveCard
        webgl={live}
        webcam={false}
        theme={theme}
        width="100%"
        height={compact ? 88 : 300}
        radius={15}
        metalness={theme === "dark" ? 0.8 : 0.15}
        roughness={0.4}
        blurStrength={8}
        shine={theme === "dark" ? 0.3 : 0.25}
        glare={0.2}
        bevel={2}
        tiltStrength={compact ? 3 : 6}
        intro={false}
        statusColor={DOT[state]}
        style={
          {
            "--rc-pad": compact ? "10px 12px" : "12px",
            "--rc-shadow":
              theme === "dark"
                ? "0 10px 24px -16px rgba(0, 0, 0, 0.75), 0 2px 6px -3px rgba(0, 0, 0, 0.4)"
                : "0 10px 22px -16px rgba(24, 24, 27, 0.28), 0 2px 5px -3px rgba(24, 24, 27, 0.12)",
          } as CSSProperties
        }
      >
        {compact ? (
          <div className="flex h-full min-w-0 items-center gap-3">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-(--rc-track)">
              <Photo src={photo} name={d.name} maker={makerOf(d)} compact vt={vtName("img", d.slug)} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-(--rc-ink)">
                  <span className="inline-block max-w-full truncate align-bottom" style={{ viewTransitionName: vtName("name", d.slug) }}>{d.name}</span>
                </h3>
                <span className="reflective-card__status device-card__state">
                  <span className="reflective-card__dot" />
                  {STATE_LABELS[state]}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <IosVersion value={d.ios_version} compact vt={vtName("ios", d.slug)} />
                <FamilyChip families={families} card />
              </div>
              <SegmentBar counts={counts} />
              <p className="truncate text-[11px] text-(--rc-muted)">
                {repoLine}, {owner}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="reflective-card__header device-card__top">
              <FamilyChip families={families} card />
              <span className="reflective-card__status device-card__state">
                <span className="reflective-card__dot" />
                {STATE_LABELS[state]}
              </span>
            </div>

            <div className="flex h-[150px] shrink-0 items-center justify-center py-2">
              <Photo src={photo} name={d.name} maker={makerOf(d)} vt={vtName("img", d.slug)} />
            </div>

            <div className="mt-auto flex min-w-0 flex-col gap-0.5">
              <h3 className="w-fit max-w-full truncate text-sm font-semibold text-(--rc-ink)" style={{ viewTransitionName: vtName("name", d.slug) }}>{d.name}</h3>
              <IosVersion value={d.ios_version} vt={vtName("ios", d.slug)} />
              {sub ? <p className="truncate text-xs text-(--rc-muted)">{sub}</p> : null}
            </div>

            <div className="mt-2 flex flex-col gap-1.5">
              <SegmentBar counts={counts} />
              <p className="truncate text-xs text-(--rc-muted)" title={`${repoLine}, ${owner}`}>
                {mainRepo ? <span className="font-mono text-[11px]">{mainRepo}</span> : "No repo"}
                {", "}
                {owner}
              </p>
            </div>
          </>
        )}
      </ReflectiveCard>
    </Link>
  );
});
