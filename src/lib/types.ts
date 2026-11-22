// Shared row shapes for the iOSOnAnd tracker. Mirrors migrations/0001_init.sql
// (plus the API-facing PublicUser projection). Dependency-free: no imports.
// NOTE: users table gains email/password_hash/github columns in a follow-up
// migration owned by the auth wave; PublicUser.github_login is the API shape
// that migration must be able to serve.

export type State = "works" | "broken" | "in-progress" | "unknown";

export interface Device {
  slug: string;
  name: string;
  model: string;
  soc: string;
  repo_kind: string;
  status: State;
  best_result: string;
  notes: string;
  updated: string;
  /** 'oneios' | 'other' (migrations/0004). */
  base: string;
  ios_version: string;
  image_url: string;
  image_credit: string;
  image_license: string;
  image_source_url: string;
}

export interface Area {
  slug: string;
  name: string;
  notes: string;
  /** 'all' | 'oneios': an 'oneios' area is not applicable to other ports. */
  scope: string;
}

export interface DeviceStatus {
  device_slug: string;
  area_slug: string;
  state: State;
  detail: string;
  source: string;
  updated: string;
}

export interface Fork {
  id: number;
  device_slug: string | null;
  repo: string;
  branch: string;
  url: string;
  best_result: string;
  ported: string;
  fork_only: string;
  verified: string;
  notes: string;
  updated: string;
  /** 'upstream' | 'fork' | 'standalone' (migrations/0004). */
  kind?: string;
  maintainer_user_id?: number | null;
  maintainer_since?: string | null;
}

export interface RedditPost {
  id: number;
  title: string;
  url: string;
  published: string;
  note: string;
  /** A thumbnail from the post (https://), '' = none (migrations/0007). */
  image_url?: string;
  image_width?: number | null;
  image_height?: number | null;
}

export interface PublicUser {
  id: number;
  display_name: string;
  contact: string;
  github_login: string;
  is_admin: boolean;
  created: string;
}

export interface Claim {
  id: number;
  user_id: number;
  device_slug: string;
  note: string;
  status: string;
  updated: string;
}

export interface ChangelogEntry {
  id: number;
  who: string;
  summary: string;
  created: string;
}
