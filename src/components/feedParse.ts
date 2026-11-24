/**
 * Pure helpers for the site-wide feeds: read the free-text note on a Reddit
 * post into phones, repos and a flair, classify a changelog summary, and
 * group feed items by day or week. Every parser is defensive: whatever it
 * cannot read is kept as plain text.
 */

/* ---------- Reddit post notes ---------- */

export interface NoteRepo {
  repo: string;
  branch?: string;
}

export interface NotePhone {
  /** The name as the note writes it. */
  name: string;
  /** The tracked device it names, when one matches. */
  slug?: string;
}

export interface ParsedNote {
  phones: NotePhone[];
  repos: NoteRepo[];
  /** The post's flair, written as a trailing "[Flair]". */
  flair: string;
  /** What is left to show as text ("" when the chips say it all). */
  text: string;
}

const REPO = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9_.-]+$/;

/** "owner/repo, branch dev; owner2/repo2" -> repos, or null when any part is not a repo. */
function readRepos(inner: string): NoteRepo[] | null {
  const out: NoteRepo[] = [];
  for (const part of inner.split(";")) {
    const m = /^\s*([^\s,]+)(?:\s*,\s*branch\s+([^\s,;]+))?\s*$/i.exec(part);
    if (!m || !REPO.test(m[1])) return null;
    out.push(m[2] ? { repo: m[1], branch: m[2] } : { repo: m[1] });
  }
  return out.length ? out : null;
}

type DeviceLookup = (name: string) => string | undefined;

/**
 * Split a note such as "Galaxy S7 (orhunnx/ios-a5xelte, branch herolte) [HackiOS]"
 * or "POCO X6 5G (garnet): iOS 16.5 with Metal (rafsanbasunia/ios-garnet, branch dev)".
 * Phones become chips only when `lookup` finds the device, so a note that
 * starts with something else ("asoft-ios-android 0.1.7 (emulator app): ...")
 * stays text.
 */
export function parseNote(note: string, lookup: DeviceLookup): ParsedNote {
  let rest = (note ?? "").trim();
  let flair = "";
  const fl = /\s*\[([^\][]{1,60})\]\s*$/.exec(rest);
  if (fl) {
    flair = fl[1].trim();
    rest = rest.slice(0, fl.index).trim();
  }

  const repos: NoteRepo[] = [];
  rest = rest
    .replace(/\s*\(([^()]*\/[^()]*)\)/g, (whole, inner: string) => {
      const found = readRepos(inner);
      if (!found) return whole;
      repos.push(...found);
      return "";
    })
    .trim();

  const phones: NotePhone[] = [];
  const colon = rest.indexOf(": ");
  const head = colon >= 0 ? rest.slice(0, colon) : rest;
  const body = colon >= 0 ? rest.slice(colon + 2).trim() : "";
  // "owner/repo: what it is" names a repo, not a phone.
  if (body && REPO.test(head.trim())) {
    repos.unshift({ repo: head.trim() });
    return { phones, repos, flair, text: body };
  }
  if (head && head.length <= 120) {
    // With a body, the head names one phone ("Galaxy A32 4G (SM-A325F, Helio G80)");
    // without one, it may list several ("Galaxy S7, Galaxy S8").
    const names = body ? [head] : head.split(/\s*,\s*/);
    const resolved = names.map((raw) => {
      const name = raw.trim();
      const bare = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
      const code = /\(([^()]*)\)\s*$/.exec(name)?.[1].trim();
      return { name: bare || name, slug: lookup(bare) ?? lookup(name) ?? (code ? lookup(code) : undefined) };
    });
    if (resolved.length && resolved.every((p) => p.slug)) {
      phones.push(...resolved);
      return { phones, repos, flair, text: body };
    }
  }
  return { phones, repos, flair, text: rest };
}

/* ---------- Changelog summaries ---------- */

export type ChangeKind = "status" | "device" | "repo" | "claim" | "sync" | "post" | "account" | "other";

export type ChangeFilter = "all" | "status" | "device" | "repo" | "claim" | "sync";

/** Which filter shows a kind; posts arrive from the Reddit sync, so they count as syncs. */
export const FILTER_OF: Record<ChangeKind, ChangeFilter | null> = {
  status: "status",
  device: "device",
  repo: "repo",
  claim: "claim",
  sync: "sync",
  post: "sync",
  account: null,
  other: null,
};

export function classifyChange(summary: string): ChangeKind {
  const s = (summary ?? "").trim();
  if (/^status \S+\/\S+ -> /.test(s)) return "status";
  if (/^reddit-fetch\b|\bvia sync\b|^fork \S+ synced\b|\bsync(ed)?\b.*\bregistry\b/i.test(s)) return "sync";
  if (/^(repo )?claim\b|^claims \S+|^maintains \S+|\bmaintained by\b|\bno longer maintains\b|\badded with the claim of\b|\(claimed\)|\badded as a maintainer\b|\(repo claim\)/i.test(s)) return "claim";
  if (/^(device|area|media) |^update (#\d+ )?on /i.test(s)) return "device";
  if (/^(repo|fork) /i.test(s)) return "repo";
  if (/^post\b/i.test(s)) return "post";
  if (/account\b|^linked github|^unlinked github|^github (login|sign-in)|^registered\b/i.test(s)) return "account";
  return "other";
}

export interface StatusChange {
  device: string;
  area: string;
  state: string;
  detail: string;
}

/** "status s7/wifi -> works: reddit claim (...)" -> its parts, or null. */
export function parseStatusChange(summary: string): StatusChange | null {
  const m = /^status ([^\s/]+)\/(\S+) -> (works|broken|in-progress|unknown)(?::\s*([\s\S]*))?$/.exec((summary ?? "").trim());
  return m ? { device: m[1], area: m[2], state: m[3], detail: (m[4] ?? "").trim() } : null;
}

/* ---------- Grouping ---------- */

const DAY = 24 * 3600 * 1000;

/** "2026-11-21T07:46:21" or "2026-11-21" -> "2026-11-21" (UTC, like the API). */
export function dayKey(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return m ? m[1] : "";
}

/** The Monday (UTC) of the week a day falls in. */
export function weekKey(value: string): string {
  const day = dayKey(value);
  if (!day) return "";
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

function short(key: string, now: Date, weekday: boolean): string {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString("en", {
    ...(weekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    ...(d.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function dayLabel(key: string, now = new Date()): string {
  if (!key) return "Undated";
  const today = now.toISOString().slice(0, 10);
  if (key === today) return "Today";
  if (key === new Date(now.getTime() - DAY).toISOString().slice(0, 10)) return "Yesterday";
  return short(key, now, true);
}

export function weekLabel(key: string, now = new Date()): string {
  if (!key) return "Undated";
  const thisWeek = weekKey(now.toISOString());
  if (key === thisWeek) return "This week";
  if (key === new Date(new Date(`${thisWeek}T00:00:00Z`).getTime() - 7 * DAY).toISOString().slice(0, 10)) return "Last week";
  return `Week of ${short(key, now, false)}`;
}

/** Items grouped by key, newest group first; order inside a group is kept. */
export function groupBy<T>(items: T[], key: (item: T) => string): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return [...map].map(([k, list]) => ({ key: k, items: list })).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}
