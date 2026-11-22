export { cn } from "cn"

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

/** Parse the API's dates: "2026-11-20" or "2026-11-21T07:46:21" (UTC, no zone). */
export function parseDate(value: string): Date | null {
  if (!value) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00Z`
    : /[zZ]$|[+-]\d\d:?\d\d$/.test(value)
      ? value
      : `${value}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "3 days ago", "yesterday", "just now". Empty for a missing date. */
export function relativeTime(value: string, now = Date.now()): string {
  const d = parseDate(value)
  if (!d) return ""
  const diff = Math.round((d.getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.trunc(diff / secs), unit)
  }
  return "just now"
}

/** "Nov 20, 2026" (UTC; with the time when the value has one), for hover titles. */
export function formatDate(value: string): string {
  const d = parseDate(value)
  if (!d) return value
  const withTime = value.includes("T")
  const s = d.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "UTC",
  })
  return withTime ? `${s} UTC` : s
}

/**
 * Shared-element names for the card ↔ device page transition: the photo, name
 * and iOS version carry the same view-transition-name on both pages, so the
 * browser morphs them into place (View Transitions API; no-op where missing).
 */
export function vtName(part: "img" | "name" | "ios", slug: string): string {
  return `dev-${part}-${slug.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}
