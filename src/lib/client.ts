/**
 * src/lib/client.ts — typed fetch wrappers for every /api/* endpoint.
 *
 * Assumed API surface (PLAN.md sections 2-4 plus schema.sql; backend agent
 * owns the routes, this file only calls them):
 *
 *   GET    /api/docs                        live endpoint list
 *   GET    /api/areas                       24 checklist areas
 *   GET    /api/devices?q=&state=           device list (filters ?q= ?state=)
 *   GET    /api/search?q=                   name/model/SoC/repo text search
 *   GET    /api/devices/:slug               full device detail
 *   PUT    /api/status                      {device_slug, area_slug, state, detail?, source?}
 *   GET    /api/forks?device=               fork list (filter ?device=)
 *   POST   /api/forks                       add a fork
 *   GET    /api/posts                       r/hackios + related posts
 *   POST   /api/posts                       {title, url, note?}
 *   GET    /api/claims?device=&status=      claims (filters ?device= ?status=)
 *   POST   /api/claims                      {device_slug, note?}
 *   PATCH  /api/claims/:id                  {status} (admin)
 *   GET    /api/changelog                   write feed
 *   POST   /api/auth/signup                 {email, password, display_name?}
 *   POST   /api/auth/login                  {email, password}
 *   POST   /api/auth/logout
 *   GET    /api/auth/me                     current session user (401 logged out)
 *   POST   /api/auth/gh-challenge           {nonce} for gist-proof linking
 *   POST   /api/auth/gh-verify              {gist_url}
 *   POST   /api/auth/unlink                 unlink GitHub (409 stays server-side)
 *   GET    /api/tokens                      my tracker tokens
 *   POST   /api/tokens                      {name?} -> secret shown once
 *   DELETE /api/tokens/:id                  revoke
 *
 * Auth: login/signup set a server cookie session (credentials: same-origin).
 * Every wrapper also accepts { token } for future CLI use, sent as
 * `Authorization: Bearer <token>`. Errors are { error, hint } JSON.
 */

export type AreaState = "works" | "in-progress" | "broken" | "unknown";
export type Verified = "fork-claim" | "reproduced" | "merged";
export type ClaimStatus = "pending" | "approved" | "rejected";

export interface Area {
  slug: string;
  name: string;
  notes: string;
}

export interface DeviceStatusEntry {
  area_slug: string;
  state: AreaState;
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
  verified: Verified;
  maintainer: string;
  notes: string;
  updated: string;
}

export interface Claim {
  id: number;
  device_slug: string;
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
}

export interface Device {
  slug: string;
  name: string;
  model: string;
  soc: string;
  repo_kind: string;
  status: AreaState;
  best_result: string;
  notes: string;
  updated: string;
  area_names: Record<string, string>;
  statuses: DeviceStatusEntry[];
  forks: Fork[];
  claims: Claim[];
  posts: Post[];
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

export interface ApiTokenRecord {
  id: number;
  name: string;
  prefix: string;
  created: string;
  last_used: string | null;
}

export interface ApiErrorBody {
  error: string;
  hint?: string;
}

export class ApiRequestError extends Error {
  status: number;
  hint?: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.hint = body.hint;
  }
}

export interface CallOptions {
  /** Tracker token for future CLI use. Sent as `Authorization: Bearer`. */
  token?: string;
}

async function req<T>(path: string, init?: RequestInit, opts?: CallOptions): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  if (opts?.token) headers.set("Authorization", `Bearer ${opts.token}`);
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    let body: ApiErrorBody = { error: res.statusText };
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* keep default */
    }
    throw new ApiRequestError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) out.set(k, v);
  const s = out.toString();
  return s ? `?${s}` : "";
}

/* Reads */

export function getAreas(opts?: CallOptions): Promise<{ areas: Area[] }> {
  return req("/api/areas", undefined, opts);
}

export function listDevices(
  filters?: { q?: string; state?: string },
  opts?: CallOptions,
): Promise<{ devices: Device[] }> {
  return req(`/api/devices${qs({ q: filters?.q, state: filters?.state })}`, undefined, opts);
}

export function searchDevices(q: string, opts?: CallOptions): Promise<{ devices: Device[] }> {
  return req(`/api/search${qs({ q })}`, undefined, opts);
}

export function getDevice(slug: string, opts?: CallOptions): Promise<{ device: Device }> {
  return req(`/api/devices/${encodeURIComponent(slug)}`, undefined, opts);
}

export function listForks(
  filters?: { device?: string },
  opts?: CallOptions,
): Promise<{ forks: Fork[] }> {
  return req(`/api/forks${qs({ device: filters?.device })}`, undefined, opts);
}

export function listPosts(opts?: CallOptions): Promise<{ posts: Post[] }> {
  return req("/api/posts", undefined, opts);
}

export function listClaims(
  filters?: { device?: string; status?: string },
  opts?: CallOptions,
): Promise<{ claims: Claim[] }> {
  return req(
    `/api/claims${qs({ device: filters?.device, status: filters?.status })}`,
    undefined,
    opts,
  );
}

export function getChangelog(opts?: CallOptions): Promise<{ changelog: ChangelogEntry[] }> {
  return req("/api/changelog", undefined, opts);
}

/* Writes (editors) */

export interface StatusUpdate {
  device_slug: string;
  area_slug: string;
  state: AreaState;
  detail?: string;
  source?: string;
}

export function setStatus(update: StatusUpdate, opts?: CallOptions): Promise<{ ok: true }> {
  return req("/api/status", { method: "PUT", body: JSON.stringify(update) }, opts);
}

export interface ForkInput {
  device_slug?: string | null;
  repo: string;
  branch?: string;
  url?: string;
  best_result?: string;
  ported?: string;
  fork_only?: string;
  notes?: string;
}

export function addFork(input: ForkInput, opts?: CallOptions): Promise<{ fork: Fork }> {
  return req("/api/forks", { method: "POST", body: JSON.stringify(input) }, opts);
}

export function addPost(
  input: { title: string; url: string; note?: string },
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

export function reviewClaim(
  id: number,
  status: ClaimStatus,
  opts?: CallOptions,
): Promise<{ claim: Claim }> {
  return req(
    `/api/claims/${id}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    opts,
  );
}

/* Auth (cookie session; login stores the session server-side) */

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

export function logout(opts?: CallOptions): Promise<{ ok: true }> {
  return req("/api/auth/logout", { method: "POST" }, opts);
}

export function me(opts?: CallOptions): Promise<{ user: User }> {
  return req("/api/auth/me", undefined, opts);
}

/* GitHub linking (gist-proof nonce flow) */

export function ghChallenge(opts?: CallOptions): Promise<{ nonce: string }> {
  return req("/api/auth/gh-challenge", { method: "POST" }, opts);
}

export function ghVerify(gist_url: string, opts?: CallOptions): Promise<{ user: User }> {
  return req(
    "/api/auth/gh-verify",
    { method: "POST", body: JSON.stringify({ gist_url }) },
    opts,
  );
}

export function unlinkGithub(opts?: CallOptions): Promise<{ user: User }> {
  return req("/api/auth/unlink", { method: "POST" }, opts);
}

/* Tracker tokens */

export function listTokens(opts?: CallOptions): Promise<{ tokens: ApiTokenRecord[] }> {
  return req("/api/tokens", undefined, opts);
}

export function mintToken(
  name?: string,
  opts?: CallOptions,
): Promise<{ token: string; record: ApiTokenRecord }> {
  return req(
    "/api/tokens",
    { method: "POST", body: JSON.stringify({ name: name ?? "" }) },
    opts,
  );
}

export function revokeToken(id: number, opts?: CallOptions): Promise<{ ok: true }> {
  return req(`/api/tokens/${id}`, { method: "DELETE" }, opts);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.hint ? `${err.message} (${err.hint})` : err.message;
  return err instanceof Error ? err.message : "Request failed";
}
