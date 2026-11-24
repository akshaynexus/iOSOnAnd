/**
 * "GPU acceleration" on a phone's page: the GPU and its family, how the
 * acceleration works (the method and the chain of components), the measured
 * frames per second, the repos and the source (migration 0018). Maintainers
 * record or change it here; agents use `gpu-set` (cli.mjs).
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { LinkedText, SourceLink } from "@/components/SourceLink";
import { useAction } from "@/components/useAction";
import { setGpuAccel, type AreaState, type Device, type GpuAccel } from "@/lib/client";
import { STATE_LABELS } from "@/components/StatusBadge";
import { cn, formatDate, relativeTime } from "@/lib/utils";

const METHODS: Array<[GpuAccel["method"], string]> = [
  ["native-metal", "Native Metal driver"],
  ["metal-vulkan", "Metal over Vulkan"],
  ["metal-gl", "Metal over OpenGL"],
  ["gles", "OpenGL ES only"],
  ["virtio-gpu", "Forwarded to Android's GPU"],
  ["cpu", "CPU rendering"],
  ["other", "Other"],
  ["unknown", "Unknown"],
];

export function fpsText(a: Pick<GpuAccel, "fps_low" | "fps_high">): string {
  if (a.fps_low === null && a.fps_high === null) return "";
  if (a.fps_low !== null && a.fps_high !== null && a.fps_high !== a.fps_low) return `${a.fps_low}–${a.fps_high}`;
  return String(a.fps_low ?? a.fps_high);
}

function AccelForm({ deviceSlug, accel, onDone }: { deviceSlug: string; accel: GpuAccel | null; onDone: () => void }) {
  const router = useRouter();
  const [method, setMethod] = useState<GpuAccel["method"]>(accel?.method ?? "metal-vulkan");
  const [stack, setStack] = useState(accel?.stack ?? "");
  const [fps, setFps] = useState(accel ? fpsText(accel).replace("–", "-") : "");
  const [fpsNote, setFpsNote] = useState(accel?.fps_note ?? "");
  const [repos, setRepos] = useState((accel?.repos ?? []).join(", "));
  const [source, setSource] = useState(accel?.source ?? "");
  const [save, saving] = useAction(async () => {
    await setGpuAccel(deviceSlug, {
      method,
      stack: stack.trim(),
      fps: fps.trim(),
      fps_note: fpsNote.trim(),
      repos: repos.split(",").map((s) => s.trim()).filter(Boolean),
      source: source.trim(),
    });
    toast.success("GPU acceleration saved");
    await router.invalidate();
    onDone();
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
      <Field id="gpu-method" label="Method">
        <NativeSelect id="gpu-method" value={method} onChange={(e) => setMethod(e.target.value as GpuAccel["method"])}>
          {METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="gpu-stack" label="How it works">
        <Input id="gpu-stack" value={stack} onChange={(e) => setStack(e.target.value)} placeholder="AdrenoMetal → metal2vulkan → Turnip → kernel driver" maxLength={500} />
      </Field>
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <Field id="gpu-fps" label="FPS">
          <Input id="gpu-fps" value={fps} onChange={(e) => setFps(e.target.value)} placeholder="40-58" inputMode="numeric" maxLength={20} />
        </Field>
        <Field id="gpu-fps-note" label="Measured on">
          <Input id="gpu-fps-note" value={fpsNote} onChange={(e) => setFpsNote(e.target.value)} placeholder="idle lock screen, home-screen swipes" maxLength={300} />
        </Field>
      </div>
      <Field id="gpu-repos" label="Repos">
        <Input id="gpu-repos" value={repos} onChange={(e) => setRepos(e.target.value)} placeholder="OWNER/REPO, OWNER/REPO" maxLength={1000} />
      </Field>
      <Field id="gpu-source" label="Source" className="sm:col-span-2">
        <Input id="gpu-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Commit, log or video link" maxLength={500} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "label 47-53, other 58-62" -> readings, when the note lists at least two. */
export function fpsReadings(note: string): { context: string; readings: Array<{ label: string; low: number; high: number }> } {
  const colon = note.indexOf(":");
  const lead = colon > 0 && colon < 80 ? note.slice(0, colon).trim() : "";
  const rest = colon > 0 && colon < 80 ? note.slice(colon + 1) : note;
  const readings: Array<{ label: string; low: number; high: number }> = [];
  const words: string[] = lead ? [lead] : []; // parts with no number stay as context
  for (const part of rest.split(/[,;]/)) {
    const m = /^\s*([^\d]*?[A-Za-z][^\d]*?)\s*~?(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:fps)?\s*(?:\(([^)]*)\))?\s*$/i.exec(part);
    if (!m) {
      if (part.trim() && !/\d/.test(part)) words.push(part.trim());
      continue;
    }
    const low = Number(m[2]);
    const high = m[3] ? Number(m[3]) : low;
    if (!(high > 0) || high > 500) continue;
    readings.push({ label: m[1].replace(/\b(fps|at|on)\s*$/i, "").trim(), low, high });
  }
  return readings.length >= 2 ? { context: words.join("; "), readings } : { context: "", readings: [] };
}

const API_AREAS: Array<[string, string]> = [
  ["metal", "Metal"],
  ["gles", "OpenGL ES"],
  ["gpu", "GPU compositing"],
];

const ISSUE_STATE: Record<string, string> = {
  open: "border-broken/40 bg-broken-soft text-broken-fg",
  workaround: "border-progress/40 bg-progress-soft text-progress-fg",
  fixed: "border-works/40 bg-works-soft text-works-fg",
};

const CHIP: Record<string, string> = {
  works: "border-works/40 bg-works-soft text-works-fg",
  "in-progress": "border-progress/40 bg-progress-soft text-progress-fg",
  broken: "border-broken/40 bg-broken-soft text-broken-fg",
};

export function GpuAccelSection({ device, editable }: { device: Device; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const a = device.gpu_accel ?? null;
  const issues = device.gpu_issues ?? [];
  const apis = API_AREAS.map(([slug, label]) => ({ slug, label, state: device.statuses.find((s) => s.area_slug === slug)?.state })).filter(
    (x) => x.state && x.state !== "unknown",
  );
  if (!a && !editable && !device.gpu && !apis.length && !issues.length) return null;
  const fps = a ? fpsText(a) : "";
  const steps = a?.stack ? a.stack.split(/\s*(?:->|→|=>)\s*/).filter(Boolean) : [];
  const { context, readings } = a?.fps_note ? fpsReadings(a.fps_note) : { context: "", readings: [] };
  const scale = Math.max(60, ...readings.map((r) => r.high));
  return (
    <section aria-labelledby="gpu-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="gpu-heading" className="text-base font-semibold">
          GPU acceleration
        </h2>
        {editable && !editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {a ? "Change" : "Record it"}
          </Button>
        ) : null}
      </div>
      {editing ? <AccelForm deviceSlug={device.slug} accel={a} onDone={() => setEditing(false)} /> : null}

      <div className="flex flex-col gap-4 rounded-[14px] border bg-card p-4 text-card-foreground">
        {/* The headline: frame rate, method, and the APIs with their state. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">{fps || "—"}</span>
            <span className="text-sm text-muted-foreground">{fps ? "fps" : "not measured"}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="inline-flex h-6 items-center rounded-full bg-foreground px-2.5 text-xs font-medium text-background">
              {a ? a.method_label : "Method not recorded"}
            </span>
            {apis.map((x) => (
              <span
                key={x.slug}
                className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium", CHIP[x.state!] ?? "")}
                title={`${x.label}: ${STATE_LABELS[x.state as AreaState]}`}
              >
                {x.label}
                <span className="opacity-75">· {STATE_LABELS[x.state as AreaState]}</span>
              </span>
            ))}
          </div>
        </div>

        {/* How it works: the chain as steps. */}
        {steps.length ? (
          <ol aria-label="How it works" className="flex flex-wrap items-center gap-1.5 text-sm">
            {steps.map((s, i) => (
              <li key={`${i}-${s}`} className="flex items-center gap-1.5">
                {i ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                <span className={cn("rounded-md border px-2 py-0.5", i === steps.length - 1 ? "bg-muted font-medium" : "bg-background")}>{s}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {/* Frame rate per screen, on one scale. */}
        {readings.length ? (
          <div className="flex flex-col gap-1.5">
            {context ? <p className="text-xs text-muted-foreground">{context}</p> : null}
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {readings.map((r) => (
                <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground" title={r.label}>
                    {r.label}
                  </span>
                  <span className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/25" style={{ width: `${(r.high / scale) * 100}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: `${(r.low / scale) * 100}%` }} />
                  </span>
                  <span className="font-medium tabular-nums">{r.low === r.high ? r.low : `${r.low}–${r.high}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : a?.fps_note ? (
          <p className="text-xs break-words text-muted-foreground">Measured on: {a.fps_note}</p>
        ) : null}

        {/* Known issues: symptom, state, cause and fix. */}
        {issues.length ? (
          <ul aria-label="Known GPU issues" className="flex flex-col divide-y rounded-lg border">
            {issues.map((i) => (
              <li key={i.id} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium", ISSUE_STATE[i.state])}>
                    {i.state === "workaround" ? "Workaround" : i.state === "fixed" ? "Fixed" : "Open"}
                  </span>
                  <span className="font-medium">{i.title}</span>
                  <span className="text-xs text-muted-foreground">{i.kind_label}</span>
                </div>
                {i.cause ? <p className="text-xs break-words text-muted-foreground">Cause: {i.cause}</p> : null}
                {i.fix ? <p className="text-xs break-words text-muted-foreground">Fix: {i.fix}</p> : null}
                {i.source ? (
                  <div className="text-xs">
                    <SourceLink source={i.source} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {a?.detail ? (
          <p className="line-clamp-2 text-sm break-words text-muted-foreground" title={a.detail}>
            <LinkedText text={a.detail} />
          </p>
        ) : null}

        {/* One line of facts. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{device.gpu || "GPU not known"}</span>
            {device.gpu_family ? ` · ${device.gpu_family}` : ""}
          </span>
          {a?.os_version ? <span>{a.os_version}</span> : null}
          {(a?.repos ?? []).map((r) => (
            <a key={r} href={`https://github.com/${r}`} target="_blank" rel="noopener noreferrer" className="font-mono text-foreground underline-offset-4 hover:underline">
              {r}
            </a>
          ))}
          {device.gpu_driver ? <span title="The open driver whose code is the hardware reference">Open driver: {device.gpu_driver}</span> : null}
          {a?.source ? <SourceLink source={a.source} /> : null}
          {a ? (
            <span className="ml-auto">
              {a.who ? `${a.who} · ` : ""}
              <time dateTime={a.updated} title={formatDate(a.updated)} suppressHydrationWarning>
                {relativeTime(a.updated)}
              </time>
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
