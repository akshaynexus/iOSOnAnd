// src/lib/stats.ts — public usage statistics (migration 0021): daily counts of
// phone and profile page views and of searches, plus activity read from the
// tracker's own tables (status changes, updates, who writes them). Nothing per
// person is stored: no IP, no user id, only how many times a day.

import { exec, queryAll, queryFirst } from '@/lib/db';
import { HttpError, nowIso, validSlug } from '@/lib/auth';
import { likeEscape } from '@/lib/devices';

export const HIT_KINDS = ['device_view', 'profile_view', 'search'] as const;
export type HitKind = (typeof HIT_KINDS)[number];

const today = () => nowIso().slice(0, 10);

async function bump(kind: string, key: string): Promise<void> {
  await exec(
    'INSERT INTO stats_daily (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1',
    [today(), kind, key],
  );
}

/** The phone a search term names best: name or slug first, then model, then chip; null when none. */
async function deviceForTerm(term: string): Promise<{ slug: string } | null> {
  const like = `%${likeEscape(term)}%`;
  return queryFirst<{ slug: string }>(
    `SELECT slug FROM devices
      WHERE lower(name) LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR lower(model) LIKE ? ESCAPE '\\' OR lower(soc) LIKE ? ESCAPE '\\'
      ORDER BY CASE WHEN lower(name) = ? OR slug = ? THEN 0 WHEN lower(name) LIKE ? ESCAPE '\\' THEN 1 WHEN slug LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END, length(name)
      LIMIT 1`,
    [like, like, like, like, term, term, `${likeEscape(term)}%`, like],
  );
}

/**
 * Count one hit. device_view: a known phone slug; profile_view: a known user id;
 * search: a term that matches a phone (anything else is dropped, so no free
 * text is stored). Unknown keys are ignored (204), never an error page.
 */
export async function recordHit(kind: string, rawKey: string): Promise<boolean> {
  if (!(HIT_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad kind', `kind is one of ${HIT_KINDS.join(', ')}`);
  const key = String(rawKey ?? '').trim();
  if (kind === 'device_view') {
    if (!validSlug(key) || !(await queryFirst('SELECT slug FROM devices WHERE slug = ?', [key]))) return false;
    await bump(kind, key);
    return true;
  }
  if (kind === 'profile_view') {
    if (!/^\d{1,15}$/.test(key) || !(await queryFirst('SELECT id FROM users WHERE id = ?', [Number(key)]))) return false;
    await bump(kind, key);
    return true;
  }
  const term = key.toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  if (term.length < 2) return false;
  const hit = await deviceForTerm(term);
  if (!hit) return false;
  await bump('search', term);
  await bump('search_device', hit.slug);
  return true;
}

export type Range = '7' | '30' | 'all';
const since = (range: Range) => (range === 'all' ? '0000-00-00' : new Date(Date.now() - (Number(range) - 1) * 86_400_000).toISOString().slice(0, 10));

async function top(kind: string, from: string, limit: number): Promise<Array<{ key: string; n: number }>> {
  return queryAll<{ key: string; n: number }>(
    'SELECT key, SUM(n) AS n FROM stats_daily WHERE kind = ? AND day >= ? GROUP BY key ORDER BY n DESC, key LIMIT ?',
    [kind, from, limit],
  );
}

export interface PublicStats {
  range: Range;
  since: string;
  totals: {
    devices: number;
    repos: number;
    maintainers: number;
    working_areas: number;
    gpu_accelerated: number;
    device_views: number;
    profile_views: number;
    searches: number;
    status_changes: number;
  };
  most_viewed: Array<{ slug: string; name: string; image_url: string; views: number }>;
  most_searched: Array<{ slug: string; name: string; image_url: string; searches: number }>;
  search_terms: Array<{ term: string; searches: number }>;
  most_viewed_profiles: Array<{ id: number; label: string; github_login: string | null; views: number }>;
  most_updated: Array<{ slug: string; name: string; image_url: string; changes: number }>;
  top_contributors: Array<{ id: number | null; label: string; github_login: string | null; changes: number; phones: number }>;
  daily: Array<{ day: string; views: number; searches: number; status_changes: number }>;
}

/** Everything the Statistics page shows, for a range of days. */
export async function publicStats(range: Range): Promise<PublicStats> {
  const from = since(range);
  const [viewed, searched, terms, profiles, totalsRow, hitTotals, updated, contributors, dailyHits, dailyChanges] = await Promise.all([
    top('device_view', from, 15),
    top('search_device', from, 15),
    top('search', from, 20),
    top('profile_view', from, 10),
    queryFirst<{ devices: number; repos: number; maintainers: number; working: number; gpu: number }>(
      `SELECT (SELECT COUNT(*) FROM devices) AS devices,
              (SELECT COUNT(*) FROM forks) AS repos,
              (SELECT COUNT(DISTINCT user_id) FROM repo_maintainers) AS maintainers,
              (SELECT COUNT(*) FROM device_status WHERE state = 'works' AND os = 'ios') AS working,
              (SELECT COUNT(DISTINCT device_slug) FROM device_status WHERE state = 'works' AND area_slug IN ('gpu', 'metal', 'gles')) AS gpu`,
    ),
    queryAll<{ kind: string; n: number }>('SELECT kind, SUM(n) AS n FROM stats_daily WHERE day >= ? GROUP BY kind', [from]),
    queryAll<{ slug: string; name: string; image_url: string; changes: number }>(
      `SELECT h.device_slug AS slug, d.name, d.image_url, COUNT(*) AS changes FROM status_history h JOIN devices d ON d.slug = h.device_slug
        WHERE substr(h.created, 1, 10) >= ? GROUP BY h.device_slug ORDER BY changes DESC LIMIT 10`,
      [from],
    ),
    queryAll<{ id: number | null; who: string; github_login: string | null; display_name: string | null; changes: number; phones: number }>(
      `SELECT MAX(h.user_id) AS id, h.who, u.github_login, u.display_name, COUNT(*) AS changes, COUNT(DISTINCT h.device_slug) AS phones
         FROM status_history h LEFT JOIN users u ON u.id = h.user_id
        WHERE substr(h.created, 1, 10) >= ? AND h.who NOT IN ('', 'admin') AND (u.is_admin IS NULL OR u.is_admin = 0)
          -- rows without a user id (history read back from the changelog) name admins by label only
          AND h.who NOT IN (SELECT '@' || github_login FROM users WHERE is_admin = 1 AND github_login IS NOT NULL)
          AND h.who NOT IN (SELECT display_name FROM users WHERE is_admin = 1 AND display_name IS NOT NULL AND display_name <> '')
        GROUP BY COALESCE('@' || u.github_login, NULLIF(u.display_name, ''), h.who) ORDER BY changes DESC LIMIT 10`,
      [from],
    ),
    queryAll<{ day: string; kind: string; n: number }>(
      "SELECT day, kind, SUM(n) AS n FROM stats_daily WHERE day >= ? AND kind IN ('device_view', 'search') GROUP BY day, kind",
      [range === 'all' ? since('30') : from],
    ),
    queryAll<{ day: string; n: number }>(
      'SELECT substr(created, 1, 10) AS day, COUNT(*) AS n FROM status_history WHERE substr(created, 1, 10) >= ? GROUP BY day',
      [range === 'all' ? since('30') : from],
    ),
  ]);

  const devs = new Map(
    (await queryAll<{ slug: string; name: string; image_url: string }>(
      `SELECT slug, name, image_url FROM devices WHERE slug IN (${[...viewed, ...searched].map(() => '?').join(', ') || "''"})`,
      [...viewed, ...searched].map((r) => r.key),
    )).map((d) => [d.slug, d]),
  );
  const users = new Map(
    (await queryAll<{ id: number; display_name: string | null; github_login: string | null }>(
      `SELECT id, display_name, github_login FROM users WHERE id IN (${profiles.map(() => '?').join(', ') || '0'})`,
      profiles.map((p) => Number(p.key)),
    )).map((u) => [u.id, u]),
  );
  const hits = Object.fromEntries(hitTotals.map((h) => [h.kind, Number(h.n)]));

  // One row per day of the range (the last 30 for "all"), zeros included.
  const days: string[] = [];
  const span = range === 'all' ? 30 : Number(range);
  for (let i = span - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const byDay = (kind: string, day: string) => Number(dailyHits.find((r) => r.day === day && r.kind === kind)?.n ?? 0);
  const changesOn = new Map(dailyChanges.map((r) => [r.day, Number(r.n)]));

  const label = (u: { display_name: string | null; github_login: string | null } | undefined, fallback: string) =>
    u?.github_login ? `@${u.github_login}` : u?.display_name || fallback;

  return {
    range,
    since: from,
    totals: {
      devices: Number(totalsRow?.devices ?? 0),
      repos: Number(totalsRow?.repos ?? 0),
      maintainers: Number(totalsRow?.maintainers ?? 0),
      working_areas: Number(totalsRow?.working ?? 0),
      gpu_accelerated: Number(totalsRow?.gpu ?? 0),
      device_views: hits.device_view ?? 0,
      profile_views: hits.profile_view ?? 0,
      searches: hits.search ?? 0,
      status_changes: [...changesOn.values()].reduce((a, b) => a + b, 0),
    },
    most_viewed: viewed.filter((r) => devs.has(r.key)).map((r) => ({ ...devs.get(r.key)!, views: Number(r.n) })),
    most_searched: searched.filter((r) => devs.has(r.key)).map((r) => ({ ...devs.get(r.key)!, searches: Number(r.n) })),
    search_terms: terms.map((t) => ({ term: t.key, searches: Number(t.n) })),
    most_viewed_profiles: profiles
      .filter((p) => users.has(Number(p.key)))
      .map((p) => {
        const u = users.get(Number(p.key))!;
        return { id: u.id, label: label(u, `user #${u.id}`), github_login: u.github_login, views: Number(p.n) };
      }),
    most_updated: updated.map((r) => ({ ...r, changes: Number(r.changes) })),
    top_contributors: contributors.map((c) => ({
      id: c.id,
      label: c.github_login ? `@${c.github_login}` : c.display_name || c.who,
      github_login: c.github_login,
      changes: Number(c.changes),
      phones: Number(c.phones),
    })),
    daily: days.map((day) => ({ day, views: byDay('device_view', day), searches: byDay('search', day), status_changes: changesOn.get(day) ?? 0 })),
  };
}

/** Views of one key: the last 7 and 30 days and all time. */
export async function viewsOf(kind: 'device_view' | 'profile_view', key: string): Promise<{ d7: number; d30: number; total: number }> {
  const r = await queryFirst<{ d7: number; d30: number; total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN day >= ? THEN n END), 0) AS d7, COALESCE(SUM(CASE WHEN day >= ? THEN n END), 0) AS d30, COALESCE(SUM(n), 0) AS total
       FROM stats_daily WHERE kind = ? AND key = ?`,
    [since('7'), since('30'), kind, key],
  );
  return { d7: Number(r?.d7 ?? 0), d30: Number(r?.d30 ?? 0), total: Number(r?.total ?? 0) };
}
