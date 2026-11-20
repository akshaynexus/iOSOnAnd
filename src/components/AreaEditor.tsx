import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AreaState, DeviceStatusEntry } from "@/lib/client";
import { toast } from "sonner";
import { errorMessage, setStatus } from "@/lib/client";

const STATES: AreaState[] = ["works", "in-progress", "broken", "unknown"];

export function AreaEditor({
  deviceSlug,
  entry,
  areaName,
  onSaved,
}: {
  deviceSlug: string;
  entry: DeviceStatusEntry;
  areaName: string;
  onSaved: () => void;
}) {
  const [state, setState] = useState<AreaState>(entry.state);
  const [detail, setDetail] = useState(entry.detail);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await setStatus({ device_slug: deviceSlug, area_slug: entry.area_slug, state, detail });
      toast.success(`${areaName} saved`);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{areaName}</span>
        <Select value={state} onValueChange={(v) => setState(v as AreaState)}>
          <SelectTrigger className="ml-auto w-40" aria-label={`${areaName} state`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label htmlFor={`detail-${entry.area_slug}`} className="text-sm font-medium">
        Detail
      </label>
      <Input
        id={`detail-${entry.area_slug}`}
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="What works, what fails"
      />
      <Button size="sm" onClick={save} disabled={saving} className="self-start">
        Save
      </Button>
    </div>
  );
}
