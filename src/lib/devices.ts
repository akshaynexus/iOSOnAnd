// src/lib/devices.ts — device rows with their statuses, forks, claims and
// maintainers attached in a fixed number of queries (no per-device N+1).
// Used by GET /api/devices, GET /api/devices/:slug and GET /api/search, so the
// dashboard's matrix gets every cell from one list call.

import { queryAll } from '@/lib/db';
import { BASES, HttpError, MAINTAINERS_SQL, oneOf, str } from '@/lib/auth';
import type { Claim, Device, DeviceStatus, RedditPost } from '@/lib/types';
import { FORK_SELECT, deviceFamilies, forkViews, supportedBy, type ForkRow, type ForkView, type SupportedBy } from '@/lib/forks';
import { mediaSummary, type Media } from '@/lib/media';

export interface ClaimView {
  id: number;
  device_slug: string;
  user_id: number;
  user: string;
  note: string;
  status: string;
  updated: string;
}

export function claimLabel(
  displayName: string | null | undefined,
  githubLogin: string | null | undefined,
  userId: number,
): string {
  if (githubLogin) return `@${githubLogin}`;
  if (displayName) return displayName;
  return `user#${userId}`;
}

export type ClaimJoinRow = Claim & { display_name?: string | null; github_login?: string | null };

export function mapClaimRow(c: ClaimJoinRow): ClaimView {
  return {
    id: c.id,
    device_slug: c.device_slug,
    user_id: c.user_id,
    user: claimLabel(c.display_name, c.github_login, c.user_id),
    note: c.note,
    status: c.status,
    updated: c.updated,
  };
}

export const CLAIM_SELECT = `SELECT c.*, u.display_name, u.github_login FROM claims c LEFT JOIN users u ON u.id = c.user_id`;

export interface DeviceDetail extends Device {
  area_names: Record<string, string>;
  statuses: Array<DeviceStatus & { area_name: string }>;
  /** Status rows for other systems than iOS (macos, tvos), by system. */
  os_statuses: Record<string, Array<DeviceStatus & { area_name: string }>>;
  forks: ForkView[];
  claims: ClaimView[];
  maintainers: string[];
  posts: RedditPost[];
  /** Every repo that supports the device (repo_devices), upstream first. */
  supported_by: SupportedBy[];
  /** The newest image uploaded for the device. */
  latest_media: Media | null;
  media_count: number;
  /** The base_project labels of the repos that support it (src/lib/forks.ts deviceFamilies). */
  families: string[];
  /** families[0], or '' when the device has no repo. */
  family: string;
}

const CHUNK = 90; // D1 allows at most 100 bound parameters per statement

async function bySlugs<T>(sqlBefore: string, sqlAfter: string, slugs: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const part = slugs.slice(i, i + CHUNK);
    out.push(...(await queryAll<T>(`${sqlBefore} IN (${part.map(() => '?').join(', ')}) ${sqlAfter}`, part)));
  }
  return out;
}

/** Attach related rows to `devices`. Posts only when `withPosts` (detail view). */
export async function withDetails(devices: Device[], withPosts = false): Promise<DeviceDetail[]> {
  if (!devices.length) return [];
  const slugs = devices.map((d) => d.slug);
  const [areas, statuses, forkRows, claims, posts, support, media, maintainerRows] = await Promise.all([
    queryAll<{ slug: string; name: string }>('SELECT slug, name FROM areas'),
    bySlugs<DeviceStatus & { area_name: string }>(
      'SELECT ds.*, a.name AS area_name FROM device_status ds JOIN areas a ON a.slug = ds.area_slug WHERE ds.device_slug',
      'ORDER BY ds.area_slug',
      slugs,
    ),
    bySlugs<ForkRow>(`${FORK_SELECT} WHERE f.device_slug`, 'ORDER BY f.repo', slugs),
    bySlugs<ClaimJoinRow>(`${CLAIM_SELECT} WHERE c.device_slug`, 'ORDER BY c.id DESC', slugs),
    withPosts ? queryAll<RedditPost>('SELECT * FROM reddit_posts ORDER BY id DESC LIMIT 10') : Promise.resolve([]),
    supportedBy(slugs),
    mediaSummary(slugs),
    bySlugs<{ device_slug: string; user_id: number; display_name: string | null; github_login: string | null }>(
      `SELECT DISTINCT m.device_slug, u.id AS user_id, u.display_name, u.github_login FROM (${MAINTAINERS_SQL}) m JOIN users u ON u.id = m.uid WHERE m.device_slug`,
      'ORDER BY u.id',
      slugs,
    ),
  ]);
  const forks = await forkViews(forkRows);
  const area_names: Record<string, string> = {};
  for (const a of areas) area_names[a.slug] = a.name;
  const group = <T extends { device_slug: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = r.device_slug ?? '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const st = group(statuses);
  const fk = group(forks);
  const cl = group(claims);
  const mt = group(maintainerRows);
  return devices.map((d) => {
    const dc = cl.get(d.slug) ?? [];
    const sup = support.get(d.slug) ?? [];
    const families = deviceFamilies(sup, fk.get(d.slug) ?? []);
    // Approved claims and repo maintainers (src/lib/auth.ts, MAINTAINERS_SQL), one entry per user.
    const maintainers = [...new Set((mt.get(d.slug) ?? []).map((m) => claimLabel(m.display_name, m.github_login, m.user_id)))];
    return {
      ...d,
      area_names,
      // statuses: the iOS (and iPadOS) checklist, as always; os_statuses: the other systems' rows, by system.
      statuses: (st.get(d.slug) ?? []).filter((s) => (s.os ?? 'ios') === 'ios'),
      os_statuses: (st.get(d.slug) ?? [])
        .filter((s) => (s.os ?? 'ios') !== 'ios')
        .reduce<Record<string, typeof statuses>>((m, s) => ((m[s.os] ??= []).push(s), m), {}),
      forks: fk.get(d.slug) ?? [],
      claims: dc.map(mapClaimRow),
      maintainers,
      posts: withPosts ? posts : [],
      supported_by: sup,
      families,
      family: families[0] ?? '',
      latest_media: media.get(d.slug)?.latest ?? null,
      media_count: media.get(d.slug)?.count ?? 0,
    };
  });
}

/** The v2 device fields (migrations/0004) and their caps; base and image_* are admin-only on PATCH. */
export const DEVICE_TEXT: Record<string, number> = {
  base: 16,
  ios_version: 64,
  macos_version: 64,
  tvos_version: 64,
  image_url: 500,
  image_credit: 300,
  image_license: 100,
  image_source_url: 500,
};
export const DEVICE_ADMIN_FIELDS = ['base', 'image_url', 'image_credit', 'image_license', 'image_source_url'];

/** A validated v2 device field from a body (base is oneios | other; the URLs are https://). */
export function deviceField(body: Record<string, any>, k: string): string {
  const v = str(body, k, DEVICE_TEXT[k]);
  if (k === 'base') oneOf(BASES, v, 'base');
  if ((k === 'image_url' || k === 'image_source_url') && v && !/^https:\/\/[^\s]+$/.test(v)) {
    throw new HttpError(400, `bad ${k}`, `${k} must be an https:// URL (or empty)`);
  }
  return v;
}

export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
