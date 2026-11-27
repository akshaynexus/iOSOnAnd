// src/lib/version.ts — compare the version strings ports state (no imports, so unit tests load it).

/** The numbers of a version string: "iOS 27.2.1 (24B156)" -> [27, 2, 1]. */
function versionParts(v: string): number[] {
  const m = v.replace(/\(.*?\)/g, ' ').match(/\d+(?:\.\d+)*/);
  return m ? m[0].split('.').map(Number) : [];
}

/** True when `next` names a later version than `current` (or current names none). */
export function newerVersion(next: string, current: string): boolean {
  const a = versionParts(next);
  const b = versionParts(current);
  if (!a.length) return false;
  if (!b.length) return true;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}
