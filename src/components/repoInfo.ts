/**
 * Which repo a device runs, and which family a repo belongs to. Works with the
 * v2 fields (device.supported_by, fork.kind, fork.base_project) and falls back
 * to the older shape (device.forks, repo_kind) while they are missing.
 */
import { forkKind, type Device, type Fork, type SupportedBy } from "@/lib/client";

/** The OneiOS main repo; a device with repo_kind 'home' runs it. */
export const ONEIOS_REPO = "akshaynexus/OneiOS";

const SUPPORT_RANK: Record<string, number> = { primary: 0, merged: 1, ported: 2, claimed: 3 };
const KIND_RANK: Record<string, number> = { upstream: 0, standalone: 1, fork: 2 };

/** Repos that support the device, upstream first, then by support level. */
export function supportersOf(d: Pick<Device, "supported_by" | "forks" | "repo_kind">): SupportedBy[] {
  if (Array.isArray(d.supported_by) && d.supported_by.length > 0) {
    return [...d.supported_by].sort(
      (a, b) =>
        (KIND_RANK[a.kind] ?? 3) - (KIND_RANK[b.kind] ?? 3) ||
        (SUPPORT_RANK[a.support] ?? 4) - (SUPPORT_RANK[b.support] ?? 4),
    );
  }
  const rows: SupportedBy[] = d.forks.map((f) => ({
    repo: f.repo,
    kind: forkKind(f),
    support: f.verified === "merged" ? "merged" : "claimed",
    via: null,
    note: "",
  }));
  if (d.repo_kind === "home" && !rows.some((r) => r.repo.toLowerCase() === ONEIOS_REPO.toLowerCase())) {
    rows.unshift({ repo: ONEIOS_REPO, kind: "upstream", support: "primary", via: null, note: "" });
  }
  return rows;
}

/** The repo to show for a device: its first supporter, or null. */
export function mainRepoOf(d: Pick<Device, "supported_by" | "forks" | "repo_kind">): string | null {
  return supportersOf(d)[0]?.repo ?? null;
}

/** A repo's family label: the API's base_project, else OneiOS for the upstream. */
export function familyOfFork(f: Pick<Fork, "base_project" | "kind" | "repo"> | undefined): string | null {
  if (!f) return null;
  if (f.base_project) return f.base_project;
  if (f.repo.toLowerCase() === ONEIOS_REPO.toLowerCase()) return "OneiOS";
  return null;
}

/** The device's family: the family of its main repo, when known. */
export function familyOfDevice(
  d: Pick<Device, "supported_by" | "forks" | "repo_kind">,
  forksByRepo: Map<string, Fork>,
): string | null {
  const repo = mainRepoOf(d);
  if (!repo) return null;
  if (repo.toLowerCase() === ONEIOS_REPO.toLowerCase()) return "OneiOS";
  return familyOfFork(forksByRepo.get(repo.toLowerCase()) ?? d.forks.find((f) => f.repo === repo));
}

export function forksByRepo(forks: Fork[]): Map<string, Fork> {
  return new Map(forks.map((f) => [f.repo.toLowerCase(), f]));
}

export const SUPPORT_LABELS: Record<string, string> = {
  primary: "Main device",
  merged: "Merged",
  ported: "Ported",
  claimed: "Says it supports",
};

/** "Merged from xaxaapple/s25ver", "Main device", "Claimed by the fork". */
export function supportPhrase(support: string, via: string | null): string {
  if (support === "primary") return "Main device";
  if (support === "merged") return via ? `Merged from ${via}` : "Merged";
  if (support === "ported") return via ? `Ported from ${via}` : "Ported";
  return "says it supports this phone";
}

const FAMILY_NAMES: Record<string, string> = {
  oneios: "OneiOS",
  hackios: "HackiOS",
  "ios-sweet": "ios-sweet",
  scion: "Scion",
  unixnu: "UniXNU",
  iosplus10: "iOSPlus10",
  "jesvi-ios": "Jesvi-iOS",
  "open mapple": "Open Mapple",
  "open-mapple": "Open Mapple",
  "xnu-hd2": "xnu-hd2",
  emulator: "Emulator",
  tooling: "Tooling",
  custom: "Custom",
  unknown: "Base unknown",
};

/** The display name of a family key ("unknown" reads "Base unknown"). */
export function familyName(key: string): string {
  return FAMILY_NAMES[key.trim().toLowerCase()] ?? key;
}

/**
 * The families a device's port is based on, main first: the API's
 * device.families, else derived from the repos that support it. [] = no repo;
 * ["unknown"] = repos without lineage.
 */
export function familiesOfDevice(
  d: Pick<Device, "families" | "family" | "supported_by" | "forks" | "repo_kind">,
  byRepo: Map<string, Fork>,
): string[] {
  const api = Array.isArray(d.families) ? d.families.filter(Boolean) : d.family ? [d.family] : [];
  if (api.length > 0) return api;
  const repos = supportersOf(d);
  if (repos.length === 0) return [];
  const out: string[] = [];
  for (const r of repos) {
    const fam =
      r.base_project ||
      (r.repo.toLowerCase() === ONEIOS_REPO.toLowerCase()
        ? "OneiOS"
        : familyOfFork(byRepo.get(r.repo.toLowerCase()) ?? d.forks.find((f) => f.repo === r.repo)));
    if (fam && !out.some((x) => x.toLowerCase() === fam.toLowerCase())) out.push(fam);
  }
  return out.length > 0 ? out : ["unknown"];
}
