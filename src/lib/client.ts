/**
 * src/lib/client.ts: typed fetch wrappers for the /api/* endpoints the UI
 * uses, plus the two SSR loaders (server functions) the pages read from.
 *
 * Writes follow the permission contract:
 *   claim a device          any logged-in user      POST /api/claims
 *   edit an area status     admin or maintainer     PUT  /api/status/:device/:area
 *   add / edit a fork       admin or maintainer     POST /api/forks, PATCH /api/forks/:id
 *   add an update post      admin or any maintainer POST /api/posts
 *   approve / reject claims admin                   POST /api/claims/:id/approve|reject
 *
 * Auth: login/signup set a cookie session (credentials: same-origin). Every
 * wrapper also takes { token }, sent as `Authorization: Bearer <token>`.
 * Errors are { error, hint } JSON and surface as ApiRequestError.
 */

import { createServerFn } from "@tanstack/react-start";

export type AreaState = "works" | "in-progress" | "broken" | "unknown";
export type Verified = "fork-claim" | "reproduced" | "merged";
export type ClaimStatus = "pending" | "approved" | "rejected";

export const STATES: AreaState[] = ["works", "in-progress", "broken", "unknown"];
export const VERIFIED: Verified[] = ["fork-claim", "reproduced", "merged"];

export interface Area {
  slug: string;
  name: string;
  notes: string;
  /** 'oneios': only applies to OneiOS-based ports (v2). Missing = 'all'. */
  scope?: "all" | "oneios" | "extra" | string;
}

/** A user as the API embeds it in forks, media and claims. */
export interface UserRef {
  id: number;
  display_name: string;
  github_login: string | null;
}

export type RepoKind = "upstream" | "fork" | "standalone";
export type SupportLevel = "primary" | "merged" | "ported" | "claimed";

/** A phone a repo supports (fork.supports). */
export interface RepoSupport {
  device_slug: string;
  device_name?: string;
  support: SupportLevel | string;
  via: string | null;
  note: string;
}

/** A repo that supports a device (device.supported_by), upstream first. */
export interface SupportedBy {
  repo: string;
  kind: RepoKind | string;
  /** The repo family (lineage), when the API sends it. */
  base_project?: string;
  support: SupportLevel | string;
  via: string | null;
  note: string;
}

export type LineageRelation = "fork-of" | "derived-from" | "ported-from" | "uses";

export interface BasedOn {
  base: string;
  base_repo_url: string | null;
  relation: LineageRelation | string;
  note: string;
}

export const RELATION_LABELS: Record<string, string> = {
  "fork-of": "Fork of",
  "derived-from": "Derived from",
  "ported-from": "Ported from",
  uses: "Uses",
};

export interface Lineage {
  nodes: { repo: string; base_project: string; device_slug: string | null }[];
  edges: { from: string; to: string; relation: string }[];
}

export function getLineage(opts?: CallOptions): Promise<Lineage> {
  return req("/api/lineage", undefined, opts);
}

export interface Media {
  id: number;
  device_slug: string;
  fork_id: number | null;
  area_slug: string | null;
  url: string;
  content_type: string;
  kind: "image" | "video";
  bytes: number;
  width: number | null;
  height: number | null;
  caption: string;
  user: UserRef | null;
  created: string;
}

/** The system a status is about: ios covers iOS and iPadOS. */
export type Os = "ios" | "macos" | "tvos";
export const OS_LABELS: Record<Os, string> = { ios: "iOS", macos: "macOS", tvos: "tvOS" };

export interface DeviceStatusEntry {
  device_slug: string;
  area_slug: string;
  /** Missing on rows from before migration 0012: ios. */
  os?: Os | string;
  os_version?: string;
  state: AreaState;
  detail: string;
  source: string;
  updated: string;
  area_name?: string;
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
  verified: Verified;
  /** v2: the user who maintains the repo; older responses send nothing (or a label). */
  maintainer?: UserRef | string | null;
  /** Everyone who maintains the repo (a repo can have several), longest-standing first. */
  maintainers?: Array<UserRef & { since: string }>;
  maintainer_since?: string | null;
  maintainer_user_id?: number | null;
  /** v2: 'upstream' (a project's main repo), 'fork' or 'standalone'. Missing = 'fork'. */
  kind?: RepoKind | string;
  /** v2: every phone this repo supports, with how. */
  supports?: RepoSupport[];
  /** v2 lineage: the family label ('OneiOS', 'ios-sweet', 'HackiOS', 'custom', ...). */
  base_project?: string;
  /** v2 lineage: what the repo is built on. */
  based_on?: BasedOn[];
  notes: string;
  updated: string;
}

/** "@login" or the display name of a fork's maintainer, or null. */
export function forkMaintainer(f: Pick<Fork, "maintainer" | "maintainers">): string | null {
  const label = (u: UserRef) => (u.github_login ? `@${u.github_login}` : u.display_name || `user#${u.id}`);
  if (f.maintainers?.length) {
    const names = f.maintainers.map(label);
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  }
  const m = f.maintainer;
  if (!m) return null;
  if (typeof m === "string") return m;
  return label(m);
}

export function forkKind(f: Pick<Fork, "kind">): RepoKind {
  return f.kind === "upstream" || f.kind === "standalone" ? f.kind : "fork";
}

export interface Claim {
  id: number;
  device_slug: string;
  /** Present when the API sends it; older responses only carry the label. */
  user_id?: number;
  user: string;
  note: string;
  status: ClaimStatus;
  updated: string;
}

export interface Post {
  id: number;
  title: string;
  url: string;
  published: string;
  note: string;
  /** The post's own preview image (migration 0007); '' when none. */
  image_url?: string;
  image_width?: number | null;
  image_height?: number | null;
}

/** A device row as /api/devices lists it. */
export interface DeviceRow {
  slug: string;
  name: string;
  model: string;
  soc: string;
  repo_kind: string;
  status: AreaState;
  best_result: string;
  notes: string;
  updated: string;
  /** v2 fields; absent until migration 0004 is applied. */
  base?: "oneios" | "other" | string;
  ios_version?: string;
  /** The macOS version a port runs, when one does. */
  macos_version?: string;
  tvos_version?: string;
  /** Status rows for other systems than iOS, by system (macos, tvos). */
  os_statuses?: Record<string, DeviceStatusEntry[]>;
  image_url?: string;
  image_credit?: string;
  image_license?: string;
  image_source_url?: string;
  latest_media?: Media | null;
  media_count?: number;
  supported_by?: SupportedBy[];
  /** v2: the families (base_project) of the repos that support the device, first = main. */
  families?: string[];
  /** v2: families[0], '' with no repo, 'unknown' when no repo has lineage. */
  family?: string;
}

/** A device with its nested rows, as /api/devices/:slug returns it. */
export interface Device extends DeviceRow {
  area_names: Record<string, string>;
  statuses: DeviceStatusEntry[];
  forks: Fork[];
  claims: Claim[];
  /** Labels of approved maintainers, when the API sends them. */
  maintainers?: string[];
}

/** Approved maintainers: the API's list, else the approved claims. */
export function maintainersOf(device: Pick<Device, "claims" | "maintainers">): string[] {
  if (Array.isArray(device.maintainers)) return device.maintainers;
  return device.claims.filter((c) => c.status === "approved").map((c) => c.user);
}

export interface ChangelogEntry {
  id: number;
  who: string;
  summary: string;
  created: string;
}

export interface User {
  id: number;
  email: string | null;
  display_name: string;
  github_login: string | null;
  is_admin: boolean;
  created: string;
}

export interface Me {
  user: User;
  /** Device slugs this user maintains (approved claims). Missing = none. */
  maintains: string[];
  /** May add update posts (admin or any maintainer), when the API says so. */
  can_post?: boolean;
  /** v2: repos (OWNER/REPO) this user maintains. */
  maintains_repos: string[];
}

export const TOKEN_SCOPES = ["all", "read", "status:write", "fork:write", "post:write", "media:write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export interface ApiTokenRecord {
  id: number;
  name: string;
  prefix: string;
  created: string;
  last_used: string | null;
  /** v2 fields; older responses leave them out. */
  scopes?: string[];
  expires?: string | null;
  revoked?: boolean | number | string | null;
}

export interface ApiErrorBody {
  error: string;
  hint?: string;
}

export class ApiRequestError extends Error {
  status: number;
  hint?: string;
  constructor(status: number, body: ApiErrorBody) {
    super(typeof body.error === "string" && body.error ? body.error : `Request failed (${status})`);
    this.status = status;
    this.hint = typeof body.hint === "string" ? body.hint : undefined;
  }
}

export interface CallOptions {
  /** Tracker token for CLI-style calls. Sent as `Authorization: Bearer`. */
  token?: string;
}

async function req<T>(path: string, init?: RequestInit, opts?: CallOptions): Promise<T> {
  const headers = new Headers(init?.headers);
  // Cookie-authenticated writes must be JSON (the API's CSRF check), body or not.
  const method = (init?.method ?? "GET").toUpperCase();
  if (init?.body !== undefined || (method !== "GET" && method !== "HEAD")) {
    headers.set("Content-Type", "application/json");
  }
  if (opts?.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("X-Requested-With", "iosonand");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiRequestError(0, { error: "Network error", hint: "Check your connection and try again." });
  }
  if (!res.ok) {
    let body: ApiErrorBody = { error: res.statusText || `Request failed (${res.status})` };
    try {
      const parsed = (await res.json()) as Partial<ApiErrorBody> | null;
      if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
        body = { error: parsed.error, hint: parsed.hint };
      }
    } catch {
      /* not JSON: keep the status text */
    }
    throw new ApiRequestError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Split an error into a toast title and an optional hint. */
export function errorParts(err: unknown): { message: string; hint?: string } {
  if (err instanceof ApiRequestError) return { message: err.message, hint: err.hint };
  if (err instanceof Error && err.message) return { message: err.message };
  return { message: "Request failed" };
}

export function errorMessage(err: unknown): string {
  const { message, hint } = errorParts(err);
  return hint ? `${message}: ${hint}` : message;
}

/* SSR loaders. They run in the Worker (during SSR, or by RPC on client
 * navigation) and call the API route handlers in-process, so the pages get
 * exactly the shapes the API serves. Only public GETs go through here. */

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>;
type Result<T> = { ok: true; data: T } | { ok: false; status: number };

async function serverGet<T>(
  mod: Promise<{ Route: unknown }>,
  path: string,
  params: Record<string, string> = {},
): Promise<Result<T>> {
  const { Route } = await mod;
  const handler = (Route as { options: { server?: { handlers?: { GET?: Handler } } } }).options.server
    ?.handlers?.GET;
  if (!handler) throw new Error(`no GET handler for ${path}`);
  const res = await handler({ request: new Request(new URL(path, "http://internal")), params });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

/**
 * Every row of a paged list endpoint: asks for big pages and follows
 * total/next until the list is complete (at most 20 pages).
 */
async function serverGetAll<T>(
  mod: Promise<{ Route: unknown }>,
  path: string,
  key: string,
  limit = 500,
): Promise<Result<{ items: T[]; total?: number }>> {
  const items: T[] = [];
  const seen = new Set<unknown>();
  let offset = 0;
  let total: number | undefined;
  for (let i = 0; i < 20; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await serverGet<Record<string, unknown>>(mod, `${path}${sep}limit=${limit}&offset=${offset}`);
    if (!r.ok) return r;
    const rows = Array.isArray(r.data[key]) ? (r.data[key] as T[]) : [];
    let fresh = 0;
    for (const row of rows) {
      const id = (row as { id?: unknown; slug?: unknown }).id ?? (row as { slug?: unknown }).slug ?? row;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(row);
      fresh++;
    }
    if (typeof r.data.total === "number") total = r.data.total;
    const next = nextOffset(r.data, offset, rows.length, limit);
    if (next === null || fresh === 0) break;
    offset = next;
  }
  return { ok: true, data: { items, total } };
}

/** The first page of a feed, with its total and next offset. */
async function serverPage<T>(
  mod: Promise<{ Route: unknown }>,
  path: string,
  key: string,
  limit: number,
): Promise<Result<Page<T>>> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await serverGet<Record<string, unknown>>(mod, `${path}${sep}limit=${limit}&offset=0`);
  if (!r.ok) return r;
  const items = Array.isArray(r.data[key]) ? (r.data[key] as T[]) : [];
  return {
    ok: true,
    data: {
      items,
      total: typeof r.data.total === "number" ? r.data.total : undefined,
      next: nextOffset(r.data, 0, items.length, limit),
    },
  };
}

function must<T>(r: Result<T>, what: string): T {
  if (!r.ok) throw new Error(`Loading ${what} failed (${r.status})`);
  return r.data;
}

export interface Dashboard {
  areas: Area[];
  devices: Device[];
  forks: Fork[];
  /** The first page of each feed; the feeds load the rest on demand. */
  posts: Post[];
  postsTotal?: number;
  postsNext: number | null;
  changelog: ChangelogEntry[];
  changelogTotal?: number;
  changelogNext: number | null;
}

export const FEED_PAGE = 50;

export const loadDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<Dashboard> => {
  // /api/devices already nests each device's statuses, forks, claims and
  // maintainers; /api/forks adds the forks no device is assigned to.
  const [areas, devices, forks, posts, changelog] = await Promise.all([
    serverGet<{ areas: Area[] }>(import("@/routes/api/areas"), "/api/areas"),
    serverGetAll<Device>(import("@/routes/api/devices"), "/api/devices", "devices"),
    serverGetAll<Fork>(import("@/routes/api/forks"), "/api/forks", "forks"),
    serverPage<Post>(import("@/routes/api/posts"), "/api/posts", "posts", FEED_PAGE),
    serverPage<ChangelogEntry>(import("@/routes/api/changelog"), "/api/changelog", "changelog", FEED_PAGE),
  ]);
  const p = must(posts, "posts");
  const c = must(changelog, "changelog");
  return {
    areas: must(areas, "areas").areas,
    devices: must(devices, "devices").items.map((d) => ({
      ...d,
      statuses: d.statuses ?? [],
      forks: d.forks ?? [],
      claims: d.claims ?? [],
    })),
    forks: must(forks, "forks").items,
    posts: p.items,
    postsTotal: p.total,
    postsNext: p.next,
    changelog: c.items,
    changelogTotal: c.total,
    changelogNext: c.next,
  };
});

export const loadDevice = createServerFn({ method: "GET" })
  .validator((slug: unknown) => String(slug))
  .handler(async ({ data: slug }): Promise<{ device: Device | null; areas: Area[] }> => {
    const [res, areas] = await Promise.all([
      serverGet<{ device: Device }>(
        import("@/routes/api/devices.$slug"),
        `/api/devices/${encodeURIComponent(slug)}`,
        { slug },
      ),
      serverGet<{ areas: Area[] }>(import("@/routes/api/areas"), "/api/areas"),
    ]);
    if (!res.ok) {
      if (res.status === 404) return { device: null, areas: [] };
      throw new Error(`Loading device ${slug} failed (${res.status})`);
    }
    return { device: res.data.device, areas: must(areas, "areas").areas };
  });

/* Reads (client) */

export function listClaims(
  filters?: { device?: string; status?: ClaimStatus },
  opts?: CallOptions,
): Promise<{ claims: Claim[] }> {
  const q = new URLSearchParams();
  if (filters?.device) q.set("device", filters.device);
  if (filters?.status) q.set("status", filters.status);
  const s = q.toString();
  return req(`/api/claims${s ? `?${s}` : ""}`, undefined, opts);
}

/* Writes */

export function setStatus(
  device: string,
  area: string,
  update: { state: AreaState; detail?: string; source?: string; os?: Os; os_version?: string },
  opts?: CallOptions,
): Promise<{ status: DeviceStatusEntry }> {
  return req(
    `/api/status/${encodeURIComponent(device)}/${encodeURIComponent(area)}`,
    { method: "PUT", body: JSON.stringify(update) },
    opts,
  );
}

export interface ForkInput {
  device_slug?: string | null;
  repo?: string;
  branch?: string;
  url?: string;
  best_result?: string;
  verified?: Verified;
  notes?: string;
}

export function addFork(input: ForkInput, opts?: CallOptions): Promise<{ fork: Fork }> {
  return req("/api/forks", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function updateFork(id: number, input: ForkInput, opts?: CallOptions): Promise<{ fork: Fork }> {
  return req(`/api/forks/${id}`, { method: "PATCH", body: JSON.stringify(input) }, opts);
}

export function addPost(
  input: { title: string; url: string; published?: string; note?: string },
  opts?: CallOptions,
): Promise<{ post: Post }> {
  return req("/api/posts", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function addClaim(
  input: { device_slug: string; note?: string },
  opts?: CallOptions,
): Promise<{ claim: Claim }> {
  return req("/api/claims", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function withdrawClaim(id: number, opts?: CallOptions): Promise<{ deleted: number }> {
  return req(`/api/claims/${id}`, { method: "DELETE" }, opts);
}

export function reviewClaim(
  id: number,
  decision: "approve" | "reject",
  opts?: CallOptions,
): Promise<{ claim: Claim }> {
  return req(`/api/claims/${id}/${decision}`, { method: "POST" }, opts);
}

/* Auth (cookie session) */

export function signup(
  input: { email: string; password: string; display_name?: string },
  opts?: CallOptions,
): Promise<{ user: User }> {
  return req("/api/auth/signup", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function login(
  input: { email: string; password: string },
  opts?: CallOptions,
): Promise<{ user: User }> {
  return req("/api/auth/login", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function changePassword(
  input: { current_password: string; new_password: string; revoke_tokens?: boolean },
  opts?: CallOptions,
): Promise<{ ok: true; sessions_ended: number; tokens_revoked: number }> {
  return req("/api/auth/password", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function requestPasswordReset(email: string, opts?: CallOptions): Promise<{ ok: true; hint: string }> {
  return req("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email }) }, opts);
}

export function confirmPasswordReset(
  input: { token: string; password: string },
  opts?: CallOptions,
): Promise<{ user: User; tokens_revoked: number }> {
  return req("/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function logout(opts?: CallOptions): Promise<{ ok: true }> {
  return req("/api/auth/logout", { method: "POST" }, opts);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export async function me(opts?: CallOptions): Promise<Me> {
  const res = await req<{ user: User; maintains?: unknown; can_post?: unknown; maintains_repos?: unknown }>(
    "/api/auth/me",
    undefined,
    opts,
  );
  return {
    user: res.user,
    maintains: strings(res.maintains),
    can_post: typeof res.can_post === "boolean" ? res.can_post : undefined,
    maintains_repos: strings(res.maintains_repos),
  };
}

/* GitHub linking for a logged-in user: challenge, secret gist, link. */

export function ghChallenge(
  github_login: string,
  opts?: CallOptions,
): Promise<{ nonce: string; expires: string }> {
  return req("/api/auth/gh-challenge", { method: "POST", body: JSON.stringify({ github_login }) }, opts);
}

export function ghLink(gist_url: string, nonce: string, opts?: CallOptions): Promise<{ user: User }> {
  return req("/api/auth/gh-link", { method: "POST", body: JSON.stringify({ gist_url, nonce }) }, opts);
}

export function unlinkGithub(opts?: CallOptions): Promise<{ user: User }> {
  return req("/api/auth/unlink", { method: "POST" }, opts);
}

/* Tracker tokens */

export function listTokens(opts?: CallOptions): Promise<{ tokens: ApiTokenRecord[] }> {
  return req("/api/tokens", undefined, opts);
}

export interface MintedToken {
  token: string;
  meta?: ApiTokenRecord;
  /** Older responses call it record. */
  record?: ApiTokenRecord;
}

export function mintToken(
  input: { name?: string; scopes?: string[]; expires_in_days?: number | null },
  opts?: CallOptions,
): Promise<MintedToken> {
  return req(
    "/api/tokens",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name ?? "",
        scopes: input.scopes ?? ["all"],
        expires_in_days: input.expires_in_days ?? null,
      }),
    },
    opts,
  );
}

export function revokeToken(id: number, opts?: CallOptions): Promise<{ ok: true }> {
  return req(`/api/tokens/${id}`, { method: "DELETE" }, opts);
}

export function rotateToken(id: number, opts?: CallOptions): Promise<MintedToken> {
  return req(`/api/tokens/${id}/rotate`, { method: "POST" }, opts);
}

/* Repo ownership (v2) */

export type RepoClaimStatus = "pending" | "approved" | "rejected" | "expired";

export interface RepoClaim {
  id: number;
  user_id?: number;
  user?: UserRef | string | null;
  repo: string;
  fork_id?: number | null;
  device_slug?: string | null;
  method?: "owner" | "proof-file" | "admin" | string;
  nonce?: string;
  path?: string;
  status: RepoClaimStatus | string;
  created?: string;
  expires?: string | null;
  decided?: string | null;
  note?: string;
}

export function claimRepo(
  input: { repo: string; device?: string; new_device?: { name: string; model?: string; soc?: string }; note?: string },
  opts?: CallOptions,
): Promise<{
  claim: RepoClaim;
  fork?: Fork;
  already?: boolean;
  already_pending?: boolean;
  device_claim?: { status: "approved" | "pending"; claim_id: number | null; already?: boolean };
}> {
  return req("/api/repos/claim", { method: "POST", body: JSON.stringify(input) }, opts);
}

/** An account as the admin list shows it (GET /api/users). */
export interface AdminUser {
  id: number;
  display_name: string;
  email: string | null;
  github_login: string | null;
  is_admin: boolean;
  created: string;
  maintains: string[];
  maintains_repos: string[];
}

export function listUsers(opts?: CallOptions): Promise<{ users: AdminUser[]; total: number }> {
  return req("/api/users?limit=500", undefined, opts);
}

/** A phone or tablet from Google Play's device list (GET /api/catalog). */
export interface CatalogEntry {
  id: number;
  brand: string;
  name: string;
  display: string;
  codenames: string[];
  models: string[];
  tracked: string | null;
}

export async function searchCatalog(q: string, limit = 8, opts?: CallOptions): Promise<CatalogEntry[]> {
  const res: { catalog: CatalogEntry[] } = await req(`/api/catalog?q=${encodeURIComponent(q)}&limit=${limit}`, undefined, opts);
  return res.catalog;
}

/** A maintainer's update on a phone: text with photos and clips. */
export interface DeviceUpdate {
  id: number;
  device_slug: string;
  body: string;
  user: UserRef | null;
  created: string;
  media: Media[];
}

/** One status change on a phone (GET /api/devices/:slug/history). */
export interface StatusChange {
  id: number;
  device_slug: string;
  area_slug: string;
  area_name: string | null;
  os: Os | string;
  os_version: string;
  old_state: AreaState | null;
  state: AreaState;
  detail: string;
  source: string;
  who: string;
  created: string;
}

export function listStatusHistory(
  slug: string,
  offset = 0,
  limit = 20,
  opts?: CallOptions,
): Promise<{ history: StatusChange[]; total: number; next: number | null }> {
  return req(`/api/devices/${encodeURIComponent(slug)}/history?limit=${limit}&offset=${offset}`, undefined, opts);
}

export function listDeviceUpdates(slug: string, offset = 0, opts?: CallOptions): Promise<{ updates: DeviceUpdate[]; total: number; next: number | null }> {
  return req(`/api/devices/${encodeURIComponent(slug)}/updates?limit=10&offset=${offset}`, undefined, opts);
}

export function postDeviceUpdate(slug: string, body: string, mediaIds: number[], opts?: CallOptions): Promise<{ update: DeviceUpdate }> {
  return req(`/api/devices/${encodeURIComponent(slug)}/updates`, { method: "POST", body: JSON.stringify({ body, media_ids: mediaIds }) }, opts);
}

export function deleteDeviceUpdate(slug: string, id: number, opts?: CallOptions): Promise<{ ok: true }> {
  return req(`/api/devices/${encodeURIComponent(slug)}/updates/${id}`, { method: "DELETE" }, opts);
}

/** Every device's slug and name (GET /api/devices?brief=1), for pickers. */
export async function listDeviceNames(opts?: CallOptions): Promise<Array<{ slug: string; name: string }>> {
  const res: { devices: Array<{ slug: string; name: string }> } = await req('/api/devices?brief=1&limit=500', undefined, opts);
  return res.devices;
}

/** Add a collaborator to a repo you maintain, by their GitHub login. */
export function addRepoMaintainer(forkId: number, githubLogin: string, opts?: CallOptions): Promise<{ fork: Fork; already?: boolean }> {
  return req(`/api/forks/${forkId}/maintainers`, { method: "POST", body: JSON.stringify({ github_login: githubLogin }) }, opts);
}

/** A tracked repo by name, with its supported phones; null when it is not tracked. */
export async function getForkByRepo(repo: string, opts?: CallOptions): Promise<Fork | null> {
  const res: { forks: Fork[] } = await req(`/api/forks?repo=${encodeURIComponent(repo)}&limit=1`, undefined, opts);
  return res.forks[0] ?? null;
}

/**
 * Add a phone to a repo you maintain ("claimed" support). You become the
 * phone's maintainer at once when nobody maintains it, else an admin decides.
 */
export function addRepoPhone(
  forkId: number,
  device: string,
  opts?: CallOptions,
): Promise<{ fork: Fork; device_claim?: { status: "approved" | "pending"; claim_id: number | null; already?: boolean } }> {
  return req(`/api/forks/${forkId}/devices`, { method: "POST", body: JSON.stringify({ device_slug: device, support: "claimed" }) }, opts);
}

export function verifyRepoClaim(id: number, opts?: CallOptions): Promise<{ claim: RepoClaim; fork?: Fork }> {
  return req(`/api/repos/claim/${id}/verify`, { method: "POST" }, opts);
}

export function listRepoClaims(status?: RepoClaimStatus, opts?: CallOptions): Promise<{ claims: RepoClaim[] }> {
  return req(`/api/repos/claims${status ? `?status=${status}` : ""}`, undefined, opts);
}

export function reviewRepoClaim(
  id: number,
  decision: "approve" | "reject",
  opts?: CallOptions,
): Promise<{ claim: RepoClaim }> {
  return req(`/api/repos/claims/${id}/${decision}`, { method: "POST" }, opts);
}

/* Media (v2) */

export function listMedia(
  filters: { device?: string; fork_id?: number; area?: string; limit?: number },
  opts?: CallOptions,
): Promise<{ media: Media[] }> {
  const q = new URLSearchParams();
  if (filters.device) q.set("device", filters.device);
  if (filters.fork_id) q.set("fork_id", String(filters.fork_id));
  if (filters.area) q.set("area", filters.area);
  if (filters.limit) q.set("limit", String(filters.limit));
  return req(`/api/media?${q}`, undefined, opts);
}

export function deleteMedia(id: number, opts?: CallOptions): Promise<unknown> {
  return req(`/api/media/${id}`, { method: "DELETE" }, opts);
}

/**
 * Upload one file with progress (XMLHttpRequest, since fetch has no upload
 * progress). Multipart: file, device, fork_id?, area?, caption?.
 */
export function uploadMedia(
  input: { file: Blob; filename: string; device: string; fork_id?: number | null; area?: string | null; caption?: string },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ media: Media }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Text fields first: the API streams the body and reads them before the file.
    form.append("device", input.device);
    if (input.fork_id) form.append("fork_id", String(input.fork_id));
    if (input.area) form.append("area", input.area);
    if (input.caption) form.append("caption", input.caption);
    form.append("file", input.file, input.filename);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.withCredentials = true;
    // A custom header a cross-site form cannot send; the API accepts cookie multipart writes with it.
    xhr.setRequestHeader("X-Requested-With", "iosonand");
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body && typeof body === "object") {
        resolve(body as { media: Media });
      } else {
        const b = (body ?? {}) as Partial<ApiErrorBody>;
        reject(
          new ApiRequestError(xhr.status, {
            error: typeof b.error === "string" ? b.error : `Upload failed (${xhr.status})`,
            hint: typeof b.hint === "string" ? b.hint : undefined,
          }),
        );
      }
    };
    xhr.onerror = () => reject(new ApiRequestError(0, { error: "Network error", hint: "Check your connection and try again." }));
    xhr.onabort = () => reject(new ApiRequestError(0, { error: "Upload cancelled" }));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/* Paged feeds. The API pages with limit/offset and may add total and next;
 * an older API ignores offset, so pages are merged by id and paging stops
 * when a page brings nothing new. */

export interface Page<T> {
  items: T[];
  total?: number;
  /** Offset of the next page, or null when this was the last one. */
  next: number | null;
}

function nextOffset(body: Record<string, unknown>, offset: number, got: number, limit: number): number | null {
  const next = body.next;
  if (next === null) return null;
  if (typeof next === "number") return next;
  if (typeof next === "string") {
    const n = Number(new URL(next, "http://x").searchParams.get("offset"));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const total = typeof body.total === "number" ? body.total : undefined;
  if (total !== undefined) return offset + got < total ? offset + got : null;
  return got >= limit ? offset + got : null;
}

async function page<T>(path: string, key: string, offset: number, limit: number): Promise<Page<T>> {
  const sep = path.includes("?") ? "&" : "?";
  const body = await req<Record<string, unknown>>(`${path}${sep}limit=${limit}&offset=${offset}`);
  const items = Array.isArray(body[key]) ? (body[key] as T[]) : [];
  return {
    items,
    total: typeof body.total === "number" ? body.total : undefined,
    next: nextOffset(body, offset, items.length, limit),
  };
}

export function listPostsPage(offset: number, limit = 50): Promise<Page<Post>> {
  return page<Post>("/api/posts", "posts", offset, limit);
}

export function listChangelogPage(offset: number, limit = 50): Promise<Page<ChangelogEntry>> {
  return page<ChangelogEntry>("/api/changelog", "changelog", offset, limit);
}

/** The label the API shows for a user on claims (display name, @login, user#id). */
export function claimLabelFor(user: User): string {
  if (user.display_name) return user.display_name;
  if (user.github_login) return `@${user.github_login}`;
  return `user#${user.id}`;
}

/** True when the claim belongs to this user (by id when the API sends it, else by label). */
export function isOwnClaim(claim: Claim, user: User): boolean {
  return claim.user_id !== undefined ? claim.user_id === user.id : claim.user === claimLabelFor(user);
}
