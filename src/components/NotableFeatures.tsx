/**
 * A phone's other notable features: what the checklist does not list, or
 * uncommon hardware that works (an IR blaster, a stylus, a second screen).
 * Each has a state, what was seen and its source, like an area. The phone's
 * maintainers add, change and remove them here; agents use the CLI
 * (feature-add, feature-set, feature-remove).
 */
import { PrimaryAction } from "@/components/common";
import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { STATE_LABELS, StateLabel } from "@/components/StatusBadge";
import { LinkedText, SourceLink } from "@/components/SourceLink";
import { LinkedMedia } from "@/components/Media";
import { useAction } from "@/components/useAction";
import { OS_LABELS, STATES, addFeature, deleteFeature, updateFeature, type AreaState, type DeviceFeature, type Os } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

function FeatureForm({
  deviceSlug,
  feature,
  onDone,
}: {
  deviceSlug: string;
  feature?: DeviceFeature;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(feature?.name ?? "");
  const [state, setState] = useState<AreaState>(feature?.state ?? "works");
  const [os, setOs] = useState<Os>((feature?.os as Os) ?? "ios");
  const [detail, setDetail] = useState(feature?.detail ?? "");
  const [source, setSource] = useState(feature?.source ?? "");
  const idp = `feature-${feature?.id ?? "new"}`;
  const [save, saving] = useAction(async () => {
    const input = { name: name.trim(), state, os, detail: detail.trim(), source: source.trim() };
    if (feature) await updateFeature(deviceSlug, feature.id, input);
    else await addFeature(deviceSlug, input);
    toast.success(`${input.name}: ${STATE_LABELS[state]}`);
    await router.invalidate();
    onDone();
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) void save();
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
      <Field id={`${idp}-name`} label="Feature">
        <Input id={`${idp}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="IR blaster, S Pen, rear display" maxLength={120} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${idp}-state`} label="State">
          <NativeSelect id={`${idp}-state`} value={state} onChange={(e) => setState(e.target.value as AreaState)}>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${idp}-os`} label="System">
          <NativeSelect id={`${idp}-os`} value={os} onChange={(e) => setOs(e.target.value as Os)}>
            {(["ios", "macos", "tvos"] as const).map((o) => (
              <option key={o} value={o}>
                {OS_LABELS[o]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id={`${idp}-detail`} label="What you saw">
        <Input id={`${idp}-detail`} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Sends codes to the TV from a test app" maxLength={2000} />
      </Field>
      <Field id={`${idp}-source`} label="Source">
        <Input id={`${idp}-source`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Commit, log or video link" maxLength={500} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={saving || !name.trim()}>
          {saving ? "Saving" : feature ? "Save" : "Add feature"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function NotableFeatures({ deviceSlug, features, editable }: { deviceSlug: string; features: DeviceFeature[]; editable: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [remove] = useAction(async (f: DeviceFeature) => {
    await deleteFeature(deviceSlug, f.id);
    toast.success(`${f.name} removed`);
    await router.invalidate();
  });
  if (!features.length && !editable) return null;
  return (
    <section aria-labelledby="features-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="features-heading" className="text-base font-semibold">
          Other notable features
        </h2>
        {editable && !adding ? (
          <PrimaryAction onClick={() => setAdding(true)}>Add a feature</PrimaryAction>
        ) : null}
      </div>
      {adding ? <FeatureForm deviceSlug={deviceSlug} onDone={() => setAdding(false)} /> : null}
      {features.length ? (
        <ul className="flex flex-col divide-y overflow-hidden rounded-[14px] border bg-card text-card-foreground">
          {features.map((f) =>
            editing === f.id ? (
              <li key={f.id} className="p-3">
                <FeatureForm deviceSlug={deviceSlug} feature={f} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={f.id} className="flex min-w-0 flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{f.name}</span>
                    <StateLabel state={f.state} className="text-sm" />
                    {f.os && f.os !== "ios" ? <span className="text-xs text-muted-foreground">{OS_LABELS[f.os as Os] ?? f.os}</span> : null}
                  </p>
                  {f.detail ? (
                    <p className="text-sm break-words text-muted-foreground">
                      <LinkedText text={f.detail} />
                    </p>
                  ) : null}
                  <LinkedMedia items={f.media} className="py-1" />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {f.source ? <SourceLink source={f.source} /> : null}
                    <span>
                      {f.who ? `${f.who} · ` : ""}
                      <time dateTime={f.updated} title={formatDate(f.updated)} suppressHydrationWarning>
                        {relativeTime(f.updated)}
                      </time>
                    </span>
                  </div>
                </div>
                {editable ? (
                  <div className="flex shrink-0 gap-1 max-sm:-ml-2">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(f.id)} aria-label={`Change ${f.name}`}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => void remove(f)} aria-label={`Remove ${f.name}`}>
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="rounded-[14px] border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Uncommon hardware that works, or anything the areas above don&apos;t cover: an IR blaster, a stylus, a second screen.
        </p>
      )}
    </section>
  );
}
