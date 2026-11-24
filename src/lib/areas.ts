/**
 * src/lib/areas.ts: groups the tracked areas into categories for the
 * compatibility matrix and the device page, and counts area states.
 *
 * Slugs come from /api/areas (seed/seed.json). An area whose slug is not
 * listed here lands in "Other", so a new area shows up without a code change.
 */

import type { Area, AreaState, Device, DeviceStatusEntry, Fork } from "@/lib/client";

export interface Category {
  id: string;
  name: string;
  slugs: string[];
}

export const CATEGORIES: Category[] = [
  { id: "system", name: "Boot and system", slugs: ["boot", "return-to-oneui", "stability", "ipc", "kernel-mem"] },
  { id: "display", name: "Display and GPU", slugs: ["gpu", "brightness"] },
  { id: "input", name: "Input", slugs: ["touch", "keyboard", "haptics", "sensors"] },
  { id: "media", name: "Audio and media", slugs: ["audio", "camera", "video-encode"] },
  { id: "connectivity", name: "Connectivity", slugs: ["wifi", "bluetooth", "modem", "calls", "sms"] },
  { id: "power", name: "Power and thermal", slugs: ["battery", "thermal"] },
  { id: "security", name: "Security and apps", slugs: ["passcode", "face-id", "wallet"] },
];

export interface AreaGroup<T> {
  category: Category;
  items: T[];
}

/** Areas grouped in CATEGORIES order; unlisted slugs go to a trailing "Other" group. */
export function groupAreas<T>(items: T[], slugOf: (item: T) => string): AreaGroup<T>[] {
  const order = new Map<string, number>();
  CATEGORIES.forEach((c) => c.slugs.forEach((s, i) => order.set(s, i)));
  const groups: AreaGroup<T>[] = CATEGORIES.map((category) => ({ category, items: [] }));
  const other: AreaGroup<T> = { category: { id: "other", name: "Other", slugs: [] }, items: [] };
  for (const item of items) {
    const slug = slugOf(item);
    const g = groups.find((x) => x.category.slugs.includes(slug)) ?? other;
    g.items.push(item);
  }
  for (const g of groups) g.items.sort((a, b) => (order.get(slugOf(a)) ?? 0) - (order.get(slugOf(b)) ?? 0));
  return [...groups, other].filter((g) => g.items.length > 0);
}

export type StateCounts = Record<AreaState, number>;

/**
 * False for an area that only applies to OneiOS-based ports (scope 'oneios')
 * on a device built on another base. Such a cell shows "N/A", is left out of
 * the counts and cannot be edited. A device without `base` (an API from
 * before v2) counts every area as applicable.
 */
export function applies(area: Pick<Area, "scope">, device: Pick<Device, "base">): boolean {
  if (area.scope !== "oneios") return true;
  return !device.base || device.base === "oneios";
}

/** An area outside the iOS checklist (scope 'extra': macOS): shown and writable, not counted in the iOS progress. */
export function isExtra(area: Pick<Area, "scope">): boolean {
  return area.scope === "extra";
}

/** The iOS checklist areas that apply to the device (the "of N areas" total). */
export function applicableAreas(device: Pick<Device, "base">, areas: Area[]): Area[] {
  return areas.filter((a) => applies(a, device) && !isExtra(a));
}

/** macOS boots (works) or is under way (in-progress) on the device, or a port states a macOS version. */
export function runsMacos(d: Pick<Device, "os_statuses" | "macos_version">): boolean {
  const s = d.os_statuses?.macos?.find((x) => x.area_slug === "boot")?.state;
  return s === "works" || s === "in-progress" || !!d.macos_version;
}

/** How many applicable `areas` are in each state on `device` (no entry counts as unknown). */
export function stateCounts(device: Pick<Device, "statuses" | "base">, areas: Area[]): StateCounts {
  const counts: StateCounts = { works: 0, "in-progress": 0, broken: 0, unknown: 0 };
  for (const a of areas) {
    if (!applies(a, device) || isExtra(a)) continue;
    const state = entryFor(device, a.slug)?.state ?? "unknown";
    counts[state in counts ? state : "unknown"]++;
  }
  return counts;
}

/** The phone's maker, from its name (for the grid's filter). */
export function makerOf(d: Pick<Device, "name">): string {
  const n = d.name.trim();
  const rules: [RegExp, string][] = [
    [/^galaxy\b/i, "Samsung"],
    [/^(pixel|google)\b/i, "Google"],
    [/^(redmi|poco|xiaomi|mi\b)/i, "Xiaomi"],
    [/^oneplus\b/i, "OnePlus"],
    [/^moto\b/i, "Motorola"],
    [/^(huawei|honor)\b/i, "Huawei / Honor"],
    [/^realme\b/i, "realme"],
    [/^(tecno|infinix)\b/i, "Transsion"],
    [/^(zenfone|asus)\b/i, "ASUS"],
    [/^xperia\b/i, "Sony"],
    [/^lenovo\b/i, "Lenovo"],
    [/^nothing\b/i, "Nothing"],
    [/^lg\b/i, "LG"],
    [/^nokia\b/i, "Nokia"],
    [/^(zte|nubia)\b/i, "ZTE / nubia"],
    [/^surface\b/i, "Microsoft"],
  ];
  for (const [re, maker] of rules) if (re.test(n)) return maker;
  return "Other";
}

/** The boot area is reported as working. */
export function boots(d: Pick<Device, "statuses">): boolean {
  return entryFor(d, "boot")?.state === "works";
}

export function entryFor(device: Pick<Device, "statuses">, areaSlug: string): DeviceStatusEntry | undefined {
  return device.statuses.find((s) => s.area_slug === areaSlug);
}

/** Areas with a known state (works, in progress or broken). */
export function reported(counts: StateCounts): number {
  return counts.works + counts["in-progress"] + counts.broken;
}

/** Every word of `q` appears in the device's name, model, SoC, notes, best result or a repo name. */
export function deviceMatches(d: Device, q: string): boolean {
  const hay = [
    d.slug,
    d.name,
    d.model,
    d.soc,
    d.notes,
    d.best_result,
    d.ios_version ?? "",
    ...d.forks.map((f) => f.repo),
    ...(d.supported_by ?? []).map((s) => s.repo),
  ]
    .join(" ")
    .toLowerCase();
  return words(q).every((t) => hay.includes(t));
}

/** Every word of `q` appears in the fork's repo, branch, best result, notes or device name. */
export function forkMatches(f: Fork, deviceName: string, q: string): boolean {
  const hay = [f.repo, f.branch, f.best_result, f.ported, f.notes, f.device_slug ?? "", deviceName]
    .join(" ")
    .toLowerCase();
  return words(q).every((t) => hay.includes(t));
}

function words(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}
