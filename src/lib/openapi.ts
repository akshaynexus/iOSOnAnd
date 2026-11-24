// src/lib/openapi.ts: the one description of the tracker's HTTP API.
//
// - GET /api/openapi.json serves openapiDocument() (OpenAPI 3.1).
// - GET /api/docs serves docsEndpoints(), derived from the same OPERATIONS.
// - /api-reference renders the document with Scalar.
// - tests/api/openapi.test.ts walks src/routes/api/** and fails when a route
//   or a method is missing here, or when the document's structure is wrong.
//
// Add an operation here in the same change that adds or changes a handler.
// Dependency-free on purpose: the test imports this file outside the Worker
// (src/lib/scopes.ts is dependency-free too).
//
// Each operation's token scope (`x-scope`) is not written by hand: it is
// scopeFor(method, path) from src/lib/scopes.ts, the rule requireUser in
// src/lib/auth.ts enforces.

import { SCOPES, SCOPE_TEXT, scopeFor } from './scopes';

export type AuthLevel = 'public' | 'login' | 'maintainer' | 'repo' | 'uploader' | 'poster' | 'admin';

export const AUTH_LEVELS: Record<AuthLevel, string> = {
  public: 'no login',
  login: 'any logged-in user: session cookie, or Authorization: Bearer <tracker-token>',
  maintainer: 'admin, or a maintainer of that device (an approved claim on it); else 403 with a claim hint',
  repo: 'admin, or a maintainer of that repo (an approved repo claim: POST /api/repos/claim; a repo can have several)',
  uploader: 'admin, or the user who uploaded it',
  poster: 'admin, or a maintainer of any device',
  admin: 'admin only (users.is_admin = 1)',
};

export const API_NOTES = [
  'errors are JSON {error, hint}; unknown /api paths are 404, unsupported methods 405 (with an Allow header)',
  'cookie-authenticated writes need Content-Type: application/json, or the header X-Requested-With: iosonand (multipart uploads); an Origin from another site is 403, and Sec-Fetch-Site, when sent, must be same-origin or same-site; bearer-token clients are unaffected',
  'maintainer of a device = a user whose claim on it an admin approved (POST /api/claims, then POST /api/claims/:id/approve), or who maintains a repo of it (POST /api/repos/claim)',
  'API keys carry scopes (all | read | status:write | fork:write | post:write | media:write); each operation lists the scope it needs as x-scope. A key without it gets 403 {error:"token scope", hint:"needs <scope>"}; an expired key gets 401. A session cookie is not scoped',
  'every call counts against a per-minute rate limit (per account for logged-in writes, else per IP; sign-in calls also per email); over it is 429 with Retry-After',
  'lists take ?limit= and ?offset= and answer {<items>, total, limit, offset, next}; next is the offset of the next page, null on the last one',
  'a status write on an area with scope oneios for a device whose base is not oneios is 400 "area not applicable"',
];

// Enums. tests/api/openapi.test.ts checks them against src/lib/auth.ts.
export const STATES = ['works', 'broken', 'in-progress', 'unknown'];
export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'];
export const VERIFIED = ['fork-claim', 'reproduced', 'merged'];
export const REPO_KINDS = ['home', 'fork', 'snapshot', 'mirror', 'none'];
export const BASES = ['oneios', 'other'];
export const AREA_SCOPES = ['all', 'oneios'];
export const FORK_KINDS = ['upstream', 'fork', 'standalone'];
export const SUPPORT_LEVELS = ['primary', 'merged', 'ported', 'claimed'];
export const REPO_CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'expired'];
export const REPO_CLAIM_METHODS = ['owner', 'proof-file', 'review', 'maintainer', 'admin'];
export const LINEAGE_RELATIONS = ['fork-of', 'derived-from', 'ported-from', 'uses'];

type Schema = Record<string, unknown>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Operation {
  method: Method;
  /** OpenAPI path, params as {name}. */
  path: string;
  auth: AuthLevel;
  /** One line with the body shape; the `desc` in GET /api/docs. */
  summary: string;
  description?: string;
  tag: string;
  /** Names from QUERY. */
  query?: string[];
  body?: Schema;
  /** A multipart/form-data body instead of JSON (uploads). */
  multipart?: Schema;
  /** Body is optional (an empty body is {}). */
  bodyOptional?: boolean;
  /** Success status -> response schema. */
  ok: Record<number, Schema>;
  /** Error statuses this operation can return (besides 405 and 500). */
  errors?: number[];
  /** Sets the session cookie. */
  setsCookie?: boolean;
  /** Public, but uses the caller's login when one is sent. */
  optionalAuth?: boolean;
}

/* ------------------------------------------------------------------ */
/* Schemas (src/lib/types.ts, src/lib/devices.ts, src/lib/auth.ts)     */
/* ------------------------------------------------------------------ */

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (description?: string, extra: Schema = {}): Schema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const int = (description?: string): Schema => ({ type: 'integer', ...(description ? { description } : {}) });
const bool = (description?: string): Schema => ({ type: 'boolean', ...(description ? { description } : {}) });
const arr = (items: Schema): Schema => ({ type: 'array', items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  ...extra,
});
const nullable = (s: Schema): Schema => ({ oneOf: [s, { type: 'null' }] });

const SCHEMAS: Record<string, Schema> = {
  Error: obj(
    { error: str('what went wrong'), hint: str('what to do next') },
    ['error'],
    { description: 'Every error body. 401, 403 and 409 carry a hint.' },
  ),
  State: { type: 'string', enum: STATES, description: 'The only status words.' },
  Verified: {
    type: 'string',
    enum: VERIFIED,
    description: 'fork-claim: the fork says so. reproduced: someone reproduced it. merged: the code is in OneiOS main. Only an admin sets reproduced or merged.',
  },
  ClaimStatus: { type: 'string', enum: CLAIM_STATUSES },
  RepoKind: { type: 'string', enum: REPO_KINDS },
  Device: obj(
    {
      slug: str('lowercase letters, digits and dashes', { examples: ['s24-ultra'] }),
      name: str(undefined, { examples: ['Galaxy S24 Ultra'] }),
      model: str(undefined, { examples: ['SM-S928'] }),
      soc: str(undefined, { examples: ['SM8650'] }),
      repo_kind: ref('RepoKind'),
      status: ref('State'),
      best_result: str(),
      notes: str(),
      updated: str('date or ISO time of the last write'),
      base: ref('Base'),
      ios_version: str('the iOS version the port runs, as stated by its source; empty when not stated', { examples: ['iOS 27.0.1', 'iOS 16.7.16'] }),
      image_url: str('a freely licensed photo of the phone (Wikimedia Commons, 640 px); empty when none'),
      image_credit: str('the photo author, as the file page names them'),
      image_license: str('e.g. CC BY-SA 4.0'),
      image_source_url: str('the photo file page'),
    },
    ['slug', 'name', 'model', 'soc', 'repo_kind', 'status', 'best_result', 'notes', 'updated', 'base', 'ios_version', 'image_url', 'image_credit', 'image_license', 'image_source_url'],
  ),
  Base: { type: 'string', enum: BASES, description: 'oneios: a OneiOS-based port (hosted XNU next to Android); other: any other port.' },
  AreaScope: { type: 'string', enum: AREA_SCOPES, description: 'oneios: the area only applies to OneiOS-based ports (N/A elsewhere).' },
  Area: obj({ slug: str(undefined, { examples: ['wifi'] }), name: str(), notes: str(), scope: ref('AreaScope') }, ['slug', 'name', 'notes', 'scope']),
  Scope: { type: 'string', enum: [...SCOPES], description: Object.entries(SCOPE_TEXT).map(([k, v]) => `${k}: ${v}`).join('. ') },
  ForkKind: { type: 'string', enum: FORK_KINDS, description: "upstream: a project's main repo; fork: a device fork; standalone: an own port that is no fork." },
  Support: { type: 'string', enum: SUPPORT_LEVELS, description: 'primary: the repo\'s own device; merged / ported: fork work merged or ported into the repo; claimed: the repo says so.' },
  UserRef: obj({ id: int(), display_name: str(), github_login: nullable(str()) }, ['id', 'display_name', 'github_login']),
  SupportRow: obj(
    { device_slug: str(), device_name: str(), support: ref('Support'), via: nullable(str('OWNER/REPO the work came from')), note: str() },
    ['device_slug', 'device_name', 'support', 'via', 'note'],
  ),
  SupportedBy: obj(
    { repo: str(), kind: ref('ForkKind'), base_project: str('the repo family label'), support: ref('Support'), via: nullable(str()), note: str() },
    ['repo', 'kind', 'base_project', 'support', 'via', 'note'],
  ),
  BasedOn: obj(
    {
      base: str('OWNER/REPO, or a project name'),
      base_repo_url: nullable(str('https://github.com/<base> when base is a repo that exists')),
      relation: { type: 'string', enum: LINEAGE_RELATIONS },
      note: str(),
    },
    ['base', 'base_repo_url', 'relation', 'note'],
  ),
  Media: obj(
    {
      id: int(),
      device_slug: str(),
      fork_id: nullable(int()),
      area_slug: nullable(str()),
      url: str('/media/<r2_key>: GET it (Range supported)'),
      content_type: str(undefined, { examples: ['image/png', 'video/mp4'] }),
      kind: { type: 'string', enum: ['image', 'video'] },
      bytes: int(),
      width: nullable(int()),
      height: nullable(int()),
      caption: str(),
      user: ref('UserRef'),
      created: str(),
    },
    ['id', 'device_slug', 'fork_id', 'area_slug', 'url', 'content_type', 'kind', 'bytes', 'width', 'height', 'caption', 'user', 'created'],
  ),
  CatalogEntry: obj(
    {
      id: int(),
      brand: str(undefined, { examples: ['Redmi'] }),
      name: str('marketing name', { examples: ['Redmi Note 7'] }),
      display: str('the name the tracker would give it', { examples: ['Redmi Note 7'] }),
      codenames: { type: 'array', items: str(undefined, { examples: ['lavender'] }) },
      models: { type: 'array', items: str() },
      tracked: nullable(str('the tracked device slug, when the tracker lists this phone')),
    },
    ['id', 'brand', 'name', 'display', 'codenames', 'models', 'tracked'],
    { description: "A phone or tablet from Google Play's device list (scripts/sync-catalog.mjs)." },
  ),
  DeviceUpdate: obj(
    {
      id: int(),
      device_slug: str(),
      body: str(),
      user: ref('UserRef'),
      created: str(),
      media: { type: 'array', items: ref('Media') },
    },
    ['id', 'device_slug', 'body', 'user', 'created', 'media'],
    { description: "A maintainer's update on a phone: text with photos and clips." },
  ),
  RepoClaim: obj(
    {
      id: int(),
      repo: str('OWNER/REPO'),
      fork_id: nullable(int()),
      device_slug: nullable(str()),
      user_id: int(),
      user: ref('UserRef'),
      method: { type: 'string', enum: REPO_CLAIM_METHODS },
      status: { type: 'string', enum: REPO_CLAIM_STATUSES },
      note: str(),
      nonce: nullable(str('the verification code: write it alone to .iosonand-verify; shown to the claimant and admins while pending')),
      path: { const: '.iosonand-verify' },
      created: str(),
      expires: nullable(str('24 h after created')),
      decided: nullable(str()),
    },
    ['id', 'repo', 'fork_id', 'device_slug', 'user_id', 'user', 'method', 'status', 'note', 'nonce', 'path', 'created', 'expires', 'decided'],
  ),
  DeviceStatus: obj(
    {
      device_slug: str(),
      area_slug: str(),
      state: ref('State'),
      detail: str('what was seen'),
      source: str('file, log, commit or link that proves it'),
      updated: str(),
    },
    ['device_slug', 'area_slug', 'state', 'detail', 'source', 'updated'],
  ),
  DeviceStatusWithArea: {
    allOf: [ref('DeviceStatus'), obj({ area_name: str() }, ['area_name'])],
  },
  Fork: obj(
    {
      id: int(),
      kind: ref('ForkKind'),
      base_project: str('the family label: OneiOS, ios-sweet, HackiOS, UniXNU, Scion, custom ...; empty when not known'),
      maintainer_user_id: nullable(int()),
      maintainer_since: nullable(str()),
      maintainer: { ...nullable(ref('UserRef')), description: 'the first of the repo maintainers (older clients); see maintainers' },
      maintainers: {
        type: 'array',
        items: obj({ id: int(), display_name: str(), github_login: nullable(str()), since: str() }, ['id', 'display_name', 'github_login', 'since']),
        description: 'everyone who maintains the repo (repo_maintainers), longest-standing first; a repo can have several',
      },
      supports: { ...arr(ref('SupportRow')), description: 'every device the repo supports (repo_devices)' },
      based_on: { ...arr(ref('BasedOn')), description: 'what the repo is based on (repo_lineage)' },
      device_slug: nullable(str()),
      repo: str('OWNER/NAME on GitHub', { examples: ['YMGPwcca/OneiOS'] }),
      branch: str(),
      url: str(),
      best_result: str("the fork's own claim"),
      ported: str('what already flowed back to OneiOS main'),
      fork_only: str('what is still fork-only'),
      verified: ref('Verified'),
      notes: str(),
      updated: str(),
    },
    ['id', 'kind', 'base_project', 'device_slug', 'repo', 'branch', 'url', 'best_result', 'ported', 'fork_only', 'verified', 'notes', 'updated', 'maintainer_user_id', 'maintainer_since', 'maintainer', 'maintainers', 'supports', 'based_on'],
  ),
  RedditPost: obj(
    {
      id: int(),
      title: str(),
      url: str('canonical https://www.reddit.com/r/... URL'),
      published: str('YYYY-MM-DD'),
      note: str(),
      image_url: str('a thumbnail from the post (https://, e.g. i.redd.it); empty when none'),
      image_width: nullable(int()),
      image_height: nullable(int()),
    },
    ['id', 'title', 'url', 'published', 'note', 'image_url', 'image_width', 'image_height'],
  ),
  Claim: obj(
    {
      id: int(),
      device_slug: str(),
      user_id: int(),
      user: str('@github_login, display name, or user#id'),
      note: str(),
      status: ref('ClaimStatus'),
      updated: str(),
    },
    ['id', 'device_slug', 'user_id', 'user', 'note', 'status', 'updated'],
  ),
  DeviceDetail: {
    allOf: [
      ref('Device'),
      obj(
        {
          area_names: { type: 'object', additionalProperties: { type: 'string' }, description: 'area slug -> name' },
          statuses: arr(ref('DeviceStatusWithArea')),
          forks: { ...arr(ref('Fork')), description: 'forks whose own device this is' },
          claims: arr(ref('Claim')),
          maintainers: arr(str()),
          posts: { ...arr(ref('RedditPost')), description: 'the 10 newest posts on GET /api/devices/{slug}; empty in lists' },
          supported_by: { ...arr(ref('SupportedBy')), description: 'every repo that supports the device, upstream first' },
          latest_media: { ...nullable(ref('Media')), description: 'the newest image uploaded for the device' },
          media_count: int('uploads for the device'),
          families: { ...arr(str()), description: 'base_project labels of the repos that support the device: supported_by first, then its forks; by best support level (primary > merged > ported > claimed), then repo count. "unknown" only when nothing else is known; empty with no repo' },
          family: str('families[0], or empty when the device has no repo'),
        },
        ['area_names', 'statuses', 'forks', 'claims', 'maintainers', 'posts', 'supported_by', 'latest_media', 'media_count', 'families', 'family'],
      ),
    ],
  },
  PublicUser: obj(
    { id: int(), display_name: str(), github_login: nullable(str()), is_admin: bool(), created: str() },
    ['id', 'display_name', 'github_login', 'is_admin', 'created'],
  ),
  SelfUser: { allOf: [ref('PublicUser'), obj({ email: nullable(str()) }, ['email'])] },
  SelfUserWithTrust: {
    allOf: [
      ref('SelfUser'),
      obj(
        {
          maintains: { ...arr(str()), description: 'device slugs this user maintains (approved claims)' },
          maintains_repos: { ...arr(str()), description: 'repos (OWNER/REPO) this user maintains' },
          can_post: bool('admin, or maintains any device'),
        },
        ['maintains', 'maintains_repos', 'can_post'],
      ),
    ],
  },
  ChangelogEntry: obj({ id: int(), who: str(), summary: str(), created: str() }, ['id', 'who', 'summary', 'created']),
  TokenMeta: obj(
    {
      id: int(),
      name: str(),
      prefix: str('first 12 characters of the token'),
      scopes: arr(ref('Scope')),
      created: str(),
      last_used: nullable(str('updated at most once a minute')),
      expires: nullable(str('null: never')),
      revoked: bool(),
    },
    ['id', 'name', 'prefix', 'scopes', 'created', 'last_used', 'expires', 'revoked'],
  ),
  TokenRecord: { allOf: [ref('TokenMeta')], description: 'The v1 name of TokenMeta.' },
  Page: obj(
    {
      total: int('rows matching the filters'),
      limit: int(),
      offset: int(),
      next: nullable(int('the offset of the next page; null on the last page')),
    },
    ['total', 'limit', 'offset', 'next'],
  ),
  MintedToken: obj(
    {
      token: str('ion_... plaintext, shown once'),
      name: str(),
      prefix: str(),
      expires: nullable(str()),
      id: nullable(int()),
      scopes: arr(ref('Scope')),
      note: str(),
    },
    ['token', 'name', 'prefix', 'expires', 'id'],
  ),
  ForkWrite: obj(
    {
      repo: str('OWNER/NAME; a https://github.com/ prefix and .git suffix are stripped'),
      device_slug: nullable(str('the device the fork targets; empty or null: no device (admin only)')),
      device: str('alias of device_slug'),
      branch: str(undefined, { maxLength: 200 }),
      url: str('http(s) URL; default https://github.com/<repo>', { maxLength: 500 }),
      best_result: str(undefined, { maxLength: 2000 }),
      ported: str(undefined, { maxLength: 4000 }),
      fork_only: str(undefined, { maxLength: 4000 }),
      verified: ref('Verified'),
      notes: str(undefined, { maxLength: 4000 }),
      kind: { ...ref('ForkKind'), description: 'admin only, except fork' },
      base_project: str('admin only', { maxLength: 64 }),
    },
  ),
};

/* ------------------------------------------------------------------ */
/* Query parameters                                                    */
/* ------------------------------------------------------------------ */

function limit(def: number, max: number): Schema {
  return { name: 'limit', in: 'query', description: `1 to ${max}, default ${def}`, schema: { type: 'integer', minimum: 1, maximum: max, default: def } };
}

const QUERY: Record<string, Schema> = {
  q: { name: 'q', in: 'query', description: 'text search (up to 100 characters)', schema: str() },
  device: { name: 'device', in: 'query', description: 'device slug', schema: str(undefined, { examples: ['s24-ultra'] }) },
  area: { name: 'area', in: 'query', description: 'area slug', schema: str(undefined, { examples: ['wifi'] }) },
  state: { name: 'state', in: 'query', description: 'only rows in this state', schema: ref('State') },
  status: { name: 'status', in: 'query', description: 'claim status', schema: ref('ClaimStatus') },
  user: { name: 'user', in: 'query', description: '`me`: only your own claims (needs login)', schema: { type: 'string', enum: ['me'] } },
  id: { name: 'id', in: 'query', description: 'token id from GET /api/auth/tokens', schema: int() },
  limit_500: limit(500, 500),
  limit_posts: limit(100, 500),
  limit_changelog: limit(50, 500),
  limit_claims: limit(200, 500),
  limit_100: limit(100, 500),
  limit_media: limit(50, 500),
  limit_updates: limit(20, 100),
  limit_status: limit(2000, 5000),
  offset: { name: 'offset', in: 'query', description: 'rows to skip (the next of the previous page); default 0', schema: { type: 'integer', minimum: 0, default: 0 } },
  base: { name: 'base', in: 'query', description: 'only devices with this base', schema: ref('Base') },
  family: { name: 'family', in: 'query', description: 'only devices whose families include this label (case-insensitive)', schema: str(undefined, { examples: ['HackiOS'] }) },
  relation_param: { name: 'relation', in: 'query', description: 'only this relation (default: every row for the base)', schema: { type: 'string', enum: LINEAGE_RELATIONS } },
  kind: { name: 'kind', in: 'query', description: 'only repos of this kind', schema: ref('ForkKind') },
  base_project: { name: 'base_project', in: 'query', description: 'only repos of this family (forks.base_project), case-insensitive', schema: str(undefined, { examples: ['ios-sweet'] }) },
  catalog_q: { name: 'q', in: 'query', required: true, description: 'at least 2 characters: name, codename or model words', schema: str(undefined, { examples: ['redmi note 7', 'lavender'] }) },
  catalog_limit: { name: 'limit', in: 'query', description: 'default 20, max 50', schema: int() },
  github_redirect: { name: 'redirect', in: 'query', description: 'a same-site path to land on afterwards', schema: str(undefined, { examples: ['/profile'] }) },
  maintainer_user: { name: 'user', in: 'query', description: 'the user id of the maintainer to remove', schema: int() },
  maintainer_login: { name: 'github_login', in: 'query', description: 'the GitHub login of the maintainer to remove', schema: str() },
  brief: { name: 'brief', in: 'query', description: '1: only {slug, name} per device (for pickers), not the full rows', schema: { type: 'string', enum: ['1'] } },
  repo_name: { name: 'repo', in: 'query', description: 'only this repo (OWNER/REPO), case-insensitive', schema: str(undefined, { examples: ['akshaynexus/OneiOS'] }) },
  device_forks: { name: 'device', in: 'query', description: 'repos whose own device this is, or that support it (repo_devices)', schema: str(undefined, { examples: ['s25'] }) },
  fork_id: { name: 'fork_id', in: 'query', description: 'fork id', schema: int() },
  media_kind: { name: 'kind', in: 'query', description: 'image or video', schema: { type: 'string', enum: ['image', 'video'] } },
  repo_claim_status: { name: 'status', in: 'query', description: 'repo claim status', schema: { type: 'string', enum: REPO_CLAIM_STATUSES } },
  repo: { name: 'repo', in: 'query', description: 'OWNER/REPO', schema: str() },
  device_param: { name: 'device', in: 'query', description: 'device slug (or send it in the body)', schema: str() },
  base_param: { name: 'base', in: 'query', description: 'the base to remove (or send it in the body)', schema: str() },
};

/* ------------------------------------------------------------------ */
/* Operations, in the order GET /api/docs lists them                   */
/* ------------------------------------------------------------------ */

const statusBody = obj(
  {
    state: ref('State'),
    detail: str('what you saw', { maxLength: 2000 }),
    source: str('file, log, commit or link', { maxLength: 500 }),
  },
  ['state'],
);
const devicePatch = obj({
  name: str(undefined, { maxLength: 120 }),
  model: str(undefined, { maxLength: 64 }),
  soc: str(undefined, { maxLength: 64 }),
  repo_kind: ref('RepoKind'),
  status: ref('State'),
  best_result: str(undefined, { maxLength: 2000 }),
  notes: str(undefined, { maxLength: 4000 }),
  ios_version: str(undefined, { maxLength: 64 }),
  base: { ...ref('Base'), description: 'admin only' },
  image_url: str('admin only; https://', { maxLength: 500 }),
  image_credit: str('admin only', { maxLength: 300 }),
  image_license: str('admin only', { maxLength: 100 }),
  image_source_url: str('admin only; https://', { maxLength: 500 }),
});
const postBody = obj({
  title: str(undefined, { maxLength: 300 }),
  url: str('https://(www.|old.)reddit.com/r/... or https://redd.it/<id>; stored as https://www.reddit.com/..., no query'),
  published: str('YYYY-MM-DD; default today', { format: 'date' }),
  note: str(undefined, { maxLength: 1000 }),
  image_url: str('https:// thumbnail, or empty for none', { maxLength: 1000 }),
  image_width: nullable({ type: 'integer', minimum: 1, maximum: 20000 }),
  image_height: nullable({ type: 'integer', minimum: 1, maximum: 20000 }),
});
const githubIdentity = {
  github_login: str('`gh api user --jq .login`; resolved to an id through the GitHub API'),
  github_id: int('`gh api user --jq .id`'),
};
const gistProof = {
  gist_url: str('URL of a secret gist that holds the nonce'),
  gist_id: str('alias of gist_url'),
  nonce: str('from POST /api/auth/gh-challenge; default: your latest unused challenge'),
};
const deleted = (s: Schema) => obj({ deleted: s }, ['deleted']);
/** A list response: {<key>: [item], total, limit, offset, next}. */
const page = (key: string, item: Schema): Schema => ({ allOf: [obj({ [key]: arr(item) }, [key]), ref('Page')] });
const forkWrap = obj({ fork: ref('Fork') }, ['fork']);
const claimFork = obj({ claim: ref('RepoClaim'), fork: ref('Fork') }, ['claim', 'fork']);
const mediaUpload = obj(
  {
    device: str('device slug; must come before the file part (or use ?device=)'),
    fork_id: int('optional: the fork the media shows'),
    area: str('optional: the area the media proves, e.g. wifi'),
    caption: str(undefined, { maxLength: 500 }),
    file: { type: 'string', format: 'binary', description: 'the last part. image/jpeg, png, webp, avif up to 15 MB; video/mp4, webm, quicktime up to 95 MB; the type is read from the bytes' },
  },
  ['device', 'file'],
);
const userWrap = (name: string) => obj({ user: ref(name) }, ['user']);

export const OPERATIONS: Operation[] = [
  { method: 'get', path: '/api/docs', auth: 'public', tag: 'meta', summary: 'this list',
    description: 'The endpoint list with the auth level of each, derived from the OpenAPI document. `node cli.mjs check` reads it.',
    ok: { 200: obj({ auth_levels: { type: 'object', additionalProperties: { type: 'string' } }, notes: arr(str()),
      endpoints: arr(obj({ method: str('one method, or several joined by commas'), path: str(), auth: str(), desc: str() }, ['method', 'path', 'auth', 'desc'])) },
      ['auth_levels', 'notes', 'endpoints']) } },
  { method: 'get', path: '/api/openapi.json', auth: 'public', tag: 'meta', summary: 'this API as an OpenAPI 3.1 document',
    description: 'Rendered at /api-reference.', ok: { 200: { type: 'object', description: 'OpenAPI 3.1 document' } } },

  { method: 'get', path: '/api/areas', auth: 'public', tag: 'areas', summary: 'checklist areas (each with scope all | oneios)',
    query: ['limit_500', 'offset'], ok: { 200: page('areas', ref('Area')) }, errors: [400] },
  { method: 'post', path: '/api/areas', auth: 'admin', tag: 'areas', summary: 'add an area {slug,name,notes?,scope?}',
    body: obj({ slug: str('lowercase letters, digits, dashes', { maxLength: 64 }), name: str(undefined, { maxLength: 120 }), notes: str(undefined, { maxLength: 2000 }), scope: ref('AreaScope') }, ['slug', 'name']),
    ok: { 201: obj({ area: ref('Area') }, ['area']) }, errors: [400, 401, 403, 409] },

  { method: 'get', path: '/api/devices', auth: 'public', tag: 'devices', summary: 'device list; each device carries statuses, forks, claims, maintainers',
    description: '`q` matches slug, name, model, SoC and notes. Sorted by slug.',
    query: ['q', 'state', 'base', 'family', 'brief', 'limit_500', 'offset'], ok: { 200: page('devices', ref('DeviceDetail')) }, errors: [400] },
  { method: 'post', path: '/api/devices', auth: 'admin', tag: 'devices', summary: 'add a device {slug,name,model?,soc?,repo_kind?,status?,best_result?,notes?,base?,ios_version?,image_*?}',
    body: { allOf: [devicePatch, obj({ slug: str('lowercase letters, digits, dashes', { maxLength: 64 }) }, ['slug', 'name'])] },
    ok: { 201: obj({ device: ref('Device') }, ['device']) }, errors: [400, 401, 403, 409] },
  { method: 'get', path: '/api/devices/{slug}', auth: 'public', tag: 'devices', summary: 'detail: statuses, forks, claims, maintainers, recent posts',
    ok: { 200: obj({ device: ref('DeviceDetail') }, ['device']) }, errors: [404] },
  { method: 'patch', path: '/api/devices/{slug}', auth: 'maintainer', tag: 'devices', summary: 'update a device (name, model, soc, repo_kind, status, best_result, notes, ios_version; admin: base, image_*)',
    description: 'Only the fields sent change. An empty body is 400. base and the image_* fields are admin-only (CLI: `device-set`).',
    body: devicePatch, ok: { 200: obj({ device: ref('Device') }, ['device']) }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/devices/{slug}', auth: 'admin', tag: 'devices', summary: 'remove a device (its statuses and claims; forks are detached)',
    ok: { 200: deleted(str()) }, errors: [401, 403, 404] },
  { method: 'get', path: '/api/devices/{slug}/updates', auth: 'public', tag: 'devices', summary: "the phone's maintainer updates (text with photos and clips), newest first",
    query: ['limit_updates', 'offset'], ok: { 200: page('updates', ref('DeviceUpdate')) }, errors: [400, 404] },
  { method: 'post', path: '/api/devices/{slug}/updates', auth: 'maintainer', tag: 'devices', summary: 'post an update {body, media_ids?}',
    description: 'CLI: `update <device> --text "..." --photo FILE ...` uploads the files (POST /api/media) and posts them as one update. body: up to 2000 characters; media_ids: up to 10 of your uploads of this phone that are in no other update.',
    body: obj({ body: str(undefined, { maxLength: 2000 }), media_ids: { type: 'array', items: int(), maxItems: 10 } }),
    ok: { 201: obj({ update: ref('DeviceUpdate') }, ['update']) }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/devices/{slug}/updates/{id}', auth: 'uploader', tag: 'devices', summary: 'remove an update (its author or an admin); its files stay in the gallery',
    ok: { 200: obj({ ok: { type: 'boolean' } }, ['ok']) }, errors: [401, 403, 404] },
  { method: 'get', path: '/api/catalog', auth: 'public', tag: 'devices', summary: "search every Android phone and tablet (Google Play's device list) by name, codename or model",
    description: 'For adding a phone the tracker does not list: each entry says whether it is tracked (`tracked`). Every word of q must match; name matches come first.',
    query: ['catalog_q', 'catalog_limit'], ok: { 200: obj({ catalog: { type: 'array', items: ref('CatalogEntry') } }, ['catalog']) }, errors: [400] },

  { method: 'get', path: '/api/status', auth: 'public', tag: 'status', summary: 'per-area states',
    description: 'Sorted by device then area. An area with no row is unknown (or N/A: scope oneios on a device whose base is not oneios).',
    query: ['device', 'area', 'state', 'limit_status', 'offset'], ok: { 200: page('statuses', ref('DeviceStatusWithArea')) }, errors: [400] },
  { method: 'put', path: '/api/status', auth: 'maintainer', tag: 'status', summary: 'upsert one cell {device|device_slug, area|area_slug, state, detail?, source?}',
    body: { allOf: [statusBody, obj({ device: str('device slug'), device_slug: str('alias of device'), area: str('area slug'), area_slug: str('alias of area') })] },
    ok: { 200: obj({ ok: { const: true }, status: ref('DeviceStatus') }, ['ok', 'status']) }, errors: [400, 401, 403, 404] },
  { method: 'post', path: '/api/status', auth: 'maintainer', tag: 'status', summary: 'upsert one cell {device|device_slug, area|area_slug, state, detail?, source?}',
    description: 'Alias of PUT /api/status.',
    body: { allOf: [statusBody, obj({ device: str('device slug'), device_slug: str('alias of device'), area: str('area slug'), area_slug: str('alias of area') })] },
    ok: { 200: obj({ ok: { const: true }, status: ref('DeviceStatus') }, ['ok', 'status']) }, errors: [400, 401, 403, 404] },
  { method: 'get', path: '/api/status/{device}/{area}', auth: 'public', tag: 'status', summary: 'one cell',
    ok: { 200: obj({ status: ref('DeviceStatus') }, ['status']) }, errors: [404] },
  { method: 'put', path: '/api/status/{device}/{area}', auth: 'maintainer', tag: 'status', summary: 'upsert one cell {state, detail?, source?}; state: works | broken | in-progress | unknown',
    description: 'CLI: `status-set`. Checks in order: 401 anonymous, 404 unknown device, 403 not an editor of that device (or a key without status:write), 404 unknown area, 400 "area not applicable" (scope oneios, device base not oneios), 400 bad state.',
    body: statusBody, ok: { 200: obj({ ok: { const: true }, status: ref('DeviceStatus') }, ['ok', 'status']) }, errors: [400, 401, 403, 404] },
  { method: 'post', path: '/api/status/{device}/{area}', auth: 'maintainer', tag: 'status', summary: 'upsert one cell {state, detail?, source?}; state: works | broken | in-progress | unknown',
    description: 'Alias of PUT.', body: statusBody, ok: { 200: obj({ ok: { const: true }, status: ref('DeviceStatus') }, ['ok', 'status']) }, errors: [400, 401, 403, 404] },

  { method: 'get', path: '/api/forks', auth: 'public', tag: 'forks', summary: 'repo list: upstream repos, standalone ports and forks',
    description: 'Upstream first, then standalone, then forks, each by repo. Every repo carries maintainer, supports and based_on.',
    query: ['device_forks', 'kind', 'base_project', 'repo_name', 'limit_500', 'offset'], ok: { 200: page('forks', ref('Fork')) }, errors: [400] },
  { method: 'post', path: '/api/forks', auth: 'maintainer', tag: 'forks', summary: 'add a fork {repo:"OWNER/NAME", device_slug, ...}; no device_slug: admin only; kind, verified other than fork-claim: admin only; 409 if tracked',
    description: 'The repo name is unique (case-insensitive). Logged-in users who are not maintainers add their repo with POST /api/repos/claim.',
    body: { allOf: [ref('ForkWrite'), { required: ['repo'] }] }, ok: { 201: forkWrap }, errors: [400, 401, 403, 404, 409] },
  { method: 'post', path: '/api/forks/sync', auth: 'maintainer', tag: 'forks', summary: 'upsert a fork by repo+device_slug; only the fields sent change',
    description: 'CLI: `fork-sync`. A new fork starts as fork-claim. The repo is found by name; sending another device than its own is 409.',
    body: { allOf: [ref('ForkWrite'), { required: ['repo'] }] },
    ok: { 200: obj({ fork: ref('Fork'), created: { const: false } }, ['fork', 'created']), 201: obj({ fork: ref('Fork'), created: { const: true } }, ['fork', 'created']) },
    errors: [400, 401, 403, 404, 409] },
  { method: 'get', path: '/api/forks/{id}', auth: 'public', tag: 'forks', summary: 'one fork', ok: { 200: forkWrap }, errors: [404] },
  { method: 'patch', path: '/api/forks/{id}', auth: 'maintainer', tag: 'forks', summary: 'update a fork (its repo maintainer, or a maintainer of its device; moving it needs the new device too)',
    body: ref('ForkWrite'), ok: { 200: forkWrap }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/forks/{id}', auth: 'admin', tag: 'forks', summary: 'remove a fork (its support and lineage rows too)', ok: { 200: deleted(int()) }, errors: [401, 403, 404] },
  { method: 'post', path: '/api/forks/{id}/devices', auth: 'repo', tag: 'forks', summary: 'record that the repo supports a device {device_slug, support, via?, note?}',
    description: 'CLI: `repo-support`. support primary, merged or ported: admin only; the repo maintainer adds claimed rows. via: the tracked repo (OWNER/REPO) the merged or ported work came from. The repo maintainer maintains its primary, merged and ported phones; a claimed phone they add is theirs at once when nobody maintains it, else a pending device claim (device_claim in the answer).',
    body: obj({ device_slug: str(), device: str('alias of device_slug'), support: ref('Support'), via: str('OWNER/REPO, a tracked repo'), note: str(undefined, { maxLength: 4000 }) }, ['support']),
    ok: { 200: { ...obj({ fork: ref('Fork'), device_claim: obj({ status: { type: 'string', enum: ['approved', 'pending'] }, claim_id: nullable(int()), already: { type: 'boolean' } }, ['status']) }, ['fork']), description: 'the repo; device_claim when its maintainer added a claimed phone' } }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/forks/{id}/devices', auth: 'repo', tag: 'forks', summary: 'remove a supported device ?device= (the maintainer: claimed rows only)', query: ['device_param'],
    body: obj({ device_slug: str() }), bodyOptional: true, ok: { 200: forkWrap }, errors: [400, 401, 403, 404] },
  { method: 'post', path: '/api/forks/{id}/lineage', auth: 'repo', tag: 'forks', summary: 'record what the repo is based on {base, relation, note?, source?, base_project?}',
    description: 'CLI: `repo-lineage`. base: OWNER/REPO or a project name; base_fork_id is set when it is a tracked repo. base_project sets the family label.',
    body: obj({ base: str(), relation: { type: 'string', enum: LINEAGE_RELATIONS, default: 'derived-from' }, note: str(undefined, { maxLength: 1000 }), source: str('a README URL or github:parent', { maxLength: 500 }), base_project: str(undefined, { maxLength: 64 }) }, ['base']),
    ok: { 200: forkWrap }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/forks/{id}/lineage', auth: 'repo', tag: 'forks', summary: 'remove the "based on" rows for ?base= (&relation=)', query: ['base_param', 'relation_param'],
    body: obj({ base: str() }), bodyOptional: true, ok: { 200: forkWrap }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/forks/{id}/maintainer', auth: 'repo', tag: 'repos', summary: 'step down as one of the repo maintainers (?user=ID: an admin or the repo owner removes that one)',
    description: 'The others stay. The device claims their repo claim granted go too, unless they maintain another repo of that phone.',
    query: ['maintainer_user'], ok: { 200: forkWrap }, errors: [401, 403, 404] },
  { method: 'get', path: '/api/forks/{id}/maintainers', auth: 'public', tag: 'repos', summary: "the repo's maintainers, longest-standing first",
    description: 'CLI: `repo-maintainers`.', ok: { 200: obj({ maintainers: { type: 'array', items: ref('UserRef') } }, ['maintainers']) }, errors: [404] },
  { method: 'post', path: '/api/forks/{id}/maintainers', auth: 'repo', tag: 'repos', summary: 'add a collaborator as a maintainer {github_login}',
    description: 'CLI: `repo-maintainer-add`. They need an account linked to that GitHub login (404 otherwise), and then maintain the repo and its phones too.',
    body: obj({ github_login: str(undefined, { examples: ['octocat'] }) }, ['github_login']), ok: { 200: forkWrap }, errors: [400, 401, 403, 404] },
  { method: 'delete', path: '/api/forks/{id}/maintainers', auth: 'login', tag: 'repos', summary: 'remove a maintainer (?github_login= or ?user=; none: yourself)',
    description: "CLI: `repo-maintainer-remove`. A maintainer steps down themselves; removing someone else takes an admin or the repo's GitHub owner.",
    query: ['maintainer_login', 'maintainer_user'], ok: { 200: forkWrap }, errors: [401, 403, 404] },
  { method: 'get', path: '/api/lineage', auth: 'public', tag: 'forks', summary: 'the repo family tree: nodes and "based on" edges',
    description: 'Every tracked repo is a node (tracked: true); untracked repos and bases the lineage names are nodes too (tracked: false, kind external; exists: false when GitHub has no such repo). Edge: from the repo to what it is based on. families: label -> tracked repos.',
    ok: { 200: obj({
      nodes: arr(obj({ repo: str(), base_project: str(), device_slug: nullable(str()), kind: str(), tracked: bool(), exists: bool() }, ['repo', 'base_project', 'device_slug', 'kind', 'tracked', 'exists'])),
      edges: arr(obj({ from: str(), to: str(), relation: { type: 'string', enum: LINEAGE_RELATIONS } }, ['from', 'to', 'relation'])),
      families: { type: 'object', additionalProperties: { type: 'integer' } },
    }, ['nodes', 'edges', 'families']) } },

  { method: 'post', path: '/api/repos/claim', auth: 'login', tag: 'repos', summary: 'claim a repo {repo, device?, note?, branch?, best_result?}',
    description: 'CLI: `repo-claim`, `repo-add`. Your linked GitHub login must be the repo owner: then it is approved at once (200). A repo owned by a GitHub organization gives 202 with a pending proof-file claim: write `nonce` alone to .iosonand-verify on the default branch, push, then POST /api/repos/claim/{id}/verify (24 h). No linked GitHub account, or a personal repo of another login: 403. An untracked repo needs device (a fork row is created), or new_device {name, model?, soc?} to add a phone the tracker does not list (your own repo only; 409 when it is listed). Another maintainer: 409.',
    body: obj({ repo: str('OWNER/REPO or a github.com URL'), device: str('needed when the repo is not tracked yet'), new_device: obj({ name: str('Redmi Note 7'), model: str('codename or model number'), soc: str('chip') }, ['name']), note: str(undefined, { maxLength: 1000 }), branch: str(), best_result: str() }, ['repo']),
    ok: { 200: { ...claimFork, description: 'approved (owner), or you already maintain it (already: true)' }, 202: { ...obj({ claim: ref('RepoClaim'), fork: ref('Fork') }, ['claim']), description: 'pending: write the nonce to .iosonand-verify' } },
    errors: [400, 401, 403, 404, 409, 502, 503] },
  { method: 'post', path: '/api/repos/claim/{id}/verify', auth: 'login', tag: 'repos', summary: 'check .iosonand-verify and approve the claim (the claimant, or an admin)',
    description: 'CLI: `repo-verify`. Reads raw.githubusercontent.com/OWNER/REPO/HEAD/.iosonand-verify (then the GitHub contents API). The GitHub login of the claimant must also be a public member of the owning organization or a contributor to the repo (403 otherwise). 422 when the file is missing or wrong, 410 when expired, 409 when not pending.',
    ok: { 200: claimFork }, errors: [401, 403, 404, 409, 410, 422, 502] },
  { method: 'get', path: '/api/repos/claims', auth: 'login', tag: 'repos', summary: "your repo claims and those on repos you maintain (admin: everyone's)", description: 'CLI: `repo-claims`. Newest first.',
    query: ['repo_claim_status', 'repo', 'limit_100', 'offset'], ok: { 200: page('claims', ref('RepoClaim')) }, errors: [400, 401] },
  { method: 'post', path: '/api/repos/claims/{id}/approve', auth: 'repo', tag: 'repos', summary: "approve a pending repo claim (an admin, or a maintainer of that repo; method admin or maintainer): the claimant joins the repo's maintainers",
    ok: { 200: claimFork }, errors: [401, 403, 404, 409] },
  { method: 'post', path: '/api/repos/claims/{id}/reject', auth: 'repo', tag: 'repos', summary: 'reject a pending repo claim (an admin, or a maintainer of that repo)',
    ok: { 200: obj({ claim: ref('RepoClaim') }, ['claim']) }, errors: [401, 403, 404, 409] },

  { method: 'get', path: '/api/media', auth: 'public', tag: 'media', summary: 'uploads, newest first', query: ['device', 'fork_id', 'area', 'media_kind', 'limit_media', 'offset'],
    ok: { 200: page('media', ref('Media')) }, errors: [400] },
  { method: 'post', path: '/api/media', auth: 'maintainer', tag: 'media', summary: 'upload an image or clip (multipart: device, fork_id?, area?, caption?, file)',
    description: 'CLI: `media-upload`. Streamed into R2. From a page with the session cookie, send the header X-Requested-With: iosonand (the body is not JSON). Needs Content-Length (411); over 95 MB is 413 before the body is read; the type comes from the file bytes (415); images over 15 MB are 413.',
    multipart: mediaUpload, ok: { 201: obj({ media: ref('Media') }, ['media']) }, errors: [400, 401, 403, 404, 411, 413, 415] },
  { method: 'get', path: '/api/media/{id}', auth: 'public', tag: 'media', summary: 'one upload', ok: { 200: obj({ media: ref('Media') }, ['media']) }, errors: [404] },
  { method: 'delete', path: '/api/media/{id}', auth: 'uploader', tag: 'media', summary: 'delete an upload (soft delete plus the R2 object)', description: 'CLI: `media-delete`.',
    ok: { 200: deleted(int()) }, errors: [401, 403, 404] },

  { method: 'get', path: '/api/posts', auth: 'public', tag: 'posts', summary: 'updates list', description: 'Newest first.',
    query: ['limit_posts', 'offset'], ok: { 200: page('posts', ref('RedditPost')) }, errors: [400] },
  { method: 'post', path: '/api/posts', auth: 'poster', tag: 'posts', summary: 'add a reddit post {title,url,published?,note?}; url: https://(www|old).reddit.com/r/... or https://redd.it/<id>; 409 on dup',
    description: 'CLI: `post-add`. `link` is accepted as an alias of `url`.',
    body: { allOf: [postBody, obj({ link: str('alias of url') }), { required: ['title'] }] },
    ok: { 201: obj({ post: ref('RedditPost') }, ['post']) }, errors: [400, 401, 403, 409] },
  { method: 'get', path: '/api/posts/{id}', auth: 'public', tag: 'posts', summary: 'one post', ok: { 200: obj({ post: ref('RedditPost') }, ['post']) }, errors: [404] },
  { method: 'patch', path: '/api/posts/{id}', auth: 'admin', tag: 'posts', summary: 'update a post (title, url, published, note, image_url, image_width, image_height)', description: 'CLI: `post-set`.', body: postBody,
    ok: { 200: obj({ post: ref('RedditPost') }, ['post']) }, errors: [400, 401, 403, 404, 409] },
  { method: 'delete', path: '/api/posts/{id}', auth: 'admin', tag: 'posts', summary: 'remove a post', ok: { 200: deleted(int()) }, errors: [401, 403, 404] },
  { method: 'post', path: '/api/reddit/fetch', auth: 'admin', tag: 'posts', summary: 'fetch r/<subreddit> candidates {subreddit?}',
    description: 'Searches the subreddit (default hackios) for "OneiOS" and stores unseen posts. 502 when Reddit fails and nothing was added.',
    body: obj({ subreddit: str('without r/; letters, digits, underscore', { maxLength: 21, default: 'hackios' }) }), bodyOptional: true,
    ok: { 200: obj({ added: int(), posts: arr(ref('RedditPost')), warning: str('Reddit error when some posts were still added') }, ['added', 'posts']) },
    errors: [400, 401, 403, 502] },

  { method: 'get', path: '/api/claims', auth: 'public', tag: 'claims', summary: 'claims (user=me needs login)', optionalAuth: true,
    description: 'Newest first.', query: ['device', 'status', 'user', 'limit_claims', 'offset'], ok: { 200: page('claims', ref('Claim')) }, errors: [400, 401] },
  { method: 'post', path: '/api/claims', auth: 'login', tag: 'claims', summary: 'claim a device {device|device_slug, note?}; 409 if you already have a pending or approved claim on it',
    description: 'CLI: `claim-add`. An admin approves the claim; then you maintain the device.',
    body: obj({ device: str('device slug'), device_slug: str('alias of device'), note: str(undefined, { maxLength: 1000 }) }),
    ok: { 201: obj({ claim: ref('Claim') }, ['claim']) }, errors: [400, 401, 404, 409] },
  { method: 'get', path: '/api/claims/{id}', auth: 'public', tag: 'claims', summary: 'one claim', ok: { 200: obj({ claim: ref('Claim') }, ['claim']) }, errors: [404] },
  { method: 'patch', path: '/api/claims/{id}', auth: 'admin', tag: 'claims', summary: 'set status {status: pending | approved | rejected}',
    body: obj({ status: ref('ClaimStatus') }, ['status']), ok: { 200: obj({ claim: ref('Claim') }, ['claim']) }, errors: [400, 401, 403, 404, 409] },
  { method: 'delete', path: '/api/claims/{id}', auth: 'login', tag: 'claims', summary: 'withdraw your own claim (admin: any claim)',
    ok: { 200: deleted(int()) }, errors: [401, 403, 404] },
  { method: 'post', path: '/api/claims/{id}/approve', auth: 'admin', tag: 'claims', summary: 'approve a pending claim: the claimant becomes a maintainer',
    ok: { 200: obj({ claim: ref('Claim') }, ['claim']) }, errors: [401, 403, 404, 409] },
  { method: 'post', path: '/api/claims/{id}/reject', auth: 'admin', tag: 'claims', summary: 'reject a pending claim',
    ok: { 200: obj({ claim: ref('Claim') }, ['claim']) }, errors: [401, 403, 404, 409] },

  { method: 'get', path: '/api/changelog', auth: 'public', tag: 'meta', summary: 'write feed', description: 'One row per write, newest first.',
    query: ['limit_changelog', 'offset'], ok: { 200: page('changelog', ref('ChangelogEntry')) }, errors: [400] },
  { method: 'get', path: '/api/search', auth: 'public', tag: 'meta', summary: 'search devices (with details), forks, areas, posts', query: ['q'],
    ok: { 200: obj({ q: str(), devices: arr(ref('DeviceDetail')), forks: arr(ref('Fork')), areas: arr(ref('Area')), posts: arr(ref('RedditPost')) }, ['q', 'devices', 'forks', 'areas', 'posts']) } },

  { method: 'post', path: '/api/auth/signup', auth: 'public', tag: 'auth', summary: 'email signup {email,password,display_name?} (alias: /api/auth/register)',
    description: 'Password: 10 to 256 characters. ADMIN_EMAIL only signs up with ADMIN_PASSWORD.', setsCookie: true,
    body: obj({ email: str(undefined, { format: 'email' }), password: str(undefined, { minLength: 10, maxLength: 256 }), display_name: str(undefined, { maxLength: 64 }) }, ['email', 'password']),
    ok: { 201: userWrap('SelfUserWithTrust') }, errors: [400, 409] },
  { method: 'post', path: '/api/auth/register', auth: 'public', tag: 'auth', summary: 'email signup (alias of /api/auth/signup)', setsCookie: true,
    body: obj({ email: str(undefined, { format: 'email' }), password: str(undefined, { minLength: 10, maxLength: 256 }), display_name: str(undefined, { maxLength: 64 }) }, ['email', 'password']),
    ok: { 201: userWrap('SelfUserWithTrust') }, errors: [400, 409] },
  { method: 'get', path: '/api/auth/github', auth: 'public', tag: 'auth', summary: 'is "Continue with GitHub" set up (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)?',
    ok: { 200: obj({ enabled: { type: 'boolean' } }, ['enabled']) } },
  { method: 'get', path: '/api/auth/github/start', auth: 'public', tag: 'auth', summary: 'begin "Continue with GitHub": a state cookie, then 302 to GitHub',
    description: 'A browser navigation, not an API call. ?redirect=/path is where the user lands after signing in. Logged in already: GitHub is linked to that account instead.',
    query: ['github_redirect'], ok: { 302: { description: "to GitHub's authorize page (scope read:user), or /login?error=github_off when not set up" } } },
  { method: 'get', path: '/api/auth/github/callback', auth: 'public', tag: 'auth', summary: 'GitHub sends the browser back here; signs in, makes an account or links GitHub, then 302',
    description: 'Checks the state cookie, swaps the code for a token, reads the GitHub user and discards the token. A new account (bound to the GitHub login, no password) lands on /profile/keys. Errors go to /login?error=<code> (or /profile?tab=github&error=<code> when linking): github_off, github_denied, github_state, github_failed, github_taken.',
    setsCookie: true, ok: { 302: { description: 'to where the user started, or /profile/keys for a new account' } } },
  { method: 'post', path: '/api/auth/login', auth: 'public', tag: 'auth', summary: 'email login -> session cookie',
    description: 'ADMIN_EMAIL with ADMIN_PASSWORD always logs in as the admin (the account is created on first use). One generic 401 for any bad pair.', setsCookie: true,
    body: obj({ email: str(), password: str(undefined, { maxLength: 256 }) }, ['email', 'password']),
    ok: { 200: userWrap('SelfUserWithTrust') }, errors: [400, 401] },
  { method: 'post', path: '/api/auth/password', auth: 'login', tag: 'auth', summary: 'change my password {current_password,new_password,revoke_tokens?}',
    description: 'Ends every other session of the account. API keys stay unless revoke_tokens is true. 409 for a GitHub-only account (no password).',
    body: obj({ current_password: str(undefined, { maxLength: 256 }), new_password: str(undefined, { minLength: 10, maxLength: 256 }), revoke_tokens: bool() }, ['current_password', 'new_password']),
    ok: { 200: obj({ ok: { const: true }, sessions_ended: int(), tokens_revoked: int() }, ['ok', 'sessions_ended', 'tokens_revoked']) }, errors: [400, 401, 403, 409] },
  { method: 'post', path: '/api/auth/password-reset', auth: 'public', tag: 'auth', summary: 'mail a password-reset link {email}',
    description: 'Always the same 200, whether or not the email has an account. The link (/reset-password#token=...) works once, for 30 minutes; a new request replaces older links. 5 requests a minute per email.',
    body: obj({ email: str(undefined, { format: 'email' }) }, ['email']),
    ok: { 200: obj({ ok: { const: true }, hint: str() }, ['ok']) }, errors: [400] },
  { method: 'post', path: '/api/auth/password-reset/confirm', auth: 'public', tag: 'auth', summary: 'set a new password with a reset link {token,password} -> session cookie',
    description: 'Spends the link, ends every session, revokes every API key of the account and logs in.', setsCookie: true,
    body: obj({ token: str('the token from the reset link'), password: str(undefined, { minLength: 10, maxLength: 256 }) }, ['token', 'password']),
    ok: { 200: obj({ user: ref('SelfUserWithTrust'), tokens_revoked: int() }, ['user', 'tokens_revoked']) }, errors: [400, 410] },
  { method: 'post', path: '/api/auth/logout', auth: 'public', tag: 'auth', summary: 'end the cookie session', ok: { 200: obj({ ok: { const: true } }, ['ok']) } },
  { method: 'get', path: '/api/auth/me', auth: 'login', tag: 'auth', summary: 'current user -> {user, maintains: [device slugs], maintains_repos, can_post, is_admin, token_scopes?}',
    description: 'CLI: `whoami`. token_scopes: the scopes of the key the call was made with (absent with a session cookie).',
    ok: { 200: obj({ user: ref('SelfUserWithTrust'), maintains: arr(str()), maintains_repos: arr(str()), can_post: bool(), is_admin: bool(), token_scopes: arr(ref('Scope')) }, ['user', 'maintains', 'maintains_repos', 'can_post', 'is_admin']) }, errors: [401] },
  { method: 'get', path: '/api/auth/tokens', auth: 'login', tag: 'tokens', summary: 'list my tracker tokens',
    ok: { 200: obj({ tokens: arr(ref('TokenMeta')) }, ['tokens']) }, errors: [401] },
  { method: 'post', path: '/api/auth/tokens', auth: 'login', tag: 'tokens', summary: 'mint a token {name?,expires_days?} (plaintext once)',
    body: obj({ name: str(undefined, { maxLength: 64, default: 'cli' }), expires_days: { type: 'number', minimum: 1, maximum: 3650, description: 'omit: no expiry' } }), bodyOptional: true,
    ok: { 201: ref('MintedToken') }, errors: [401] },
  { method: 'delete', path: '/api/auth/tokens', auth: 'login', tag: 'tokens', summary: 'revoke {?id=} or {id} or {token}', query: ['id'],
    body: obj({ id: int(), token: str('the plaintext token') }), bodyOptional: true,
    ok: { 200: obj({ revoked: { const: true } }, ['revoked']) }, errors: [400, 401, 404] },
  { method: 'post', path: '/api/auth/gh-challenge', auth: 'public', tag: 'auth', summary: 'gist-proof nonce {github_login|github_id} (10 min, single use)', optionalAuth: true,
    description: 'No body: uses the GitHub account linked to your login.',
    body: obj(githubIdentity), bodyOptional: true,
    ok: { 201: obj({ nonce: str(), expires: str(), instructions: str() }, ['nonce', 'expires', 'instructions']) }, errors: [400, 404, 502] },
  { method: 'post', path: '/api/auth/gh-verify', auth: 'public', tag: 'auth', summary: 'gist-proof login {gist_url,nonce?,github_login?} -> token + session',
    description: 'CLI: `login`. Creates the user on the first login of that GitHub account. 410 when the challenge is stale or used.', setsCookie: true,
    body: obj({ ...gistProof, ...githubIdentity }),
    ok: { 200: obj({ token: str('ion_... plaintext, shown once'), user: ref('SelfUser'), login: nullable(str()), note: str() }, ['token', 'user', 'login']) },
    errors: [400, 410, 422, 502] },
  { method: 'post', path: '/api/auth/link', auth: 'public', tag: 'auth', summary: 'bind github to an email account {email,password,github_login,gist_url,nonce?} (409 if linked elsewhere)',
    description: 'CLI: `link --email`. The email and password are the proof of the account.',
    body: obj({ email: str(), password: str(), ...githubIdentity, ...gistProof }, ['email', 'password']),
    ok: { 200: obj({ user: ref('SelfUser'), github_login: nullable(str()), already: bool() }, ['user']) }, errors: [400, 401, 409, 410, 422, 502] },
  { method: 'post', path: '/api/auth/gh-link', auth: 'login', tag: 'auth', summary: 'link github via gist {gist_id|gist_url, nonce?} (409 if linked elsewhere)',
    body: obj({ gist_id: str(), gist_url: str('alias of gist_id'), nonce: str() }),
    ok: { 200: obj({ user: ref('SelfUser'), already: bool() }, ['user']) }, errors: [400, 401, 409, 410, 422, 502] },
  { method: 'delete', path: '/api/auth/gh-link', auth: 'login', tag: 'auth', summary: 'unlink github', ok: { 200: userWrap('SelfUser') }, errors: [401, 404] },
  { method: 'post', path: '/api/auth/unlink', auth: 'login', tag: 'auth', summary: 'unlink github (UI shape)', ok: { 200: userWrap('SelfUser') }, errors: [401, 404] },
  { method: 'post', path: '/api/auth/token-check', auth: 'public', tag: 'tokens', summary: 'verify a tracker token, or exchange a github token {token}',
    description: 'An `ion_` token is checked and nothing is minted. Any other value is treated as a GitHub token (`gh auth token`), checked against GitHub and exchanged for a new tracker token.',
    body: obj({ token: str() }, ['token']),
    ok: { 200: obj({ valid: { const: true }, login: str(), github_login: nullable(str()), email: nullable(str()), user: ref('SelfUser'), token: str('only on a GitHub token exchange'), note: str() }, ['valid', 'login']) },
    errors: [400, 401, 502] },
  { method: 'get', path: '/api/tokens', auth: 'login', tag: 'tokens', summary: 'my API keys (revoked ones too), newest first; never the secret',
    description: 'CLI: `keys`.', query: ['limit_100', 'offset'], ok: { 200: page('tokens', ref('TokenMeta')) }, errors: [400, 401] },
  { method: 'post', path: '/api/tokens', auth: 'login', tag: 'tokens', summary: 'create a key {name?, scopes?, expires_in_days?: 30|90|365|null} -> {token, meta}',
    description: 'CLI: `keys-create`. scopes: a list or "a,b"; default ["all"]. The secret is shown once. A key never exceeds its owner\'s rights. The v1 field expires_days (1 to 3650) still works.',
    body: obj({ name: str(undefined, { maxLength: 64, default: 'tracker' }), scopes: { oneOf: [arr(ref('Scope')), str('comma-separated')] }, expires_in_days: { oneOf: [{ type: 'integer', enum: [30, 90, 365] }, { type: 'null' }], description: 'null or absent: never' }, expires_days: { type: 'number', minimum: 1, maximum: 3650, description: 'v1' } }), bodyOptional: true,
    ok: { 201: obj({ token: str('ion_... shown once'), meta: ref('TokenMeta'), record: ref('TokenMeta'), note: str() }, ['token', 'meta']) }, errors: [400, 401, 403] },
  { method: 'delete', path: '/api/tokens/{id}', auth: 'login', tag: 'tokens', summary: 'revoke one of my keys', description: 'CLI: `keys-revoke`.',
    ok: { 200: obj({ ok: { const: true }, meta: ref('TokenMeta') }, ['ok']) }, errors: [401, 403, 404] },
  { method: 'post', path: '/api/tokens/{id}/rotate', auth: 'login', tag: 'tokens', summary: 'a new secret with the same name, scopes and expiry; the old key is revoked',
    description: 'CLI: `keys-rotate`. 409 when the key is revoked or expired.',
    ok: { 201: obj({ token: str('ion_... shown once'), meta: ref('TokenMeta'), note: str() }, ['token', 'meta']) }, errors: [401, 403, 404, 409] },
  { method: 'get', path: '/api/users', auth: 'admin', tag: 'users', summary: 'every account, newest first, with the phones and repos it maintains', query: ['limit_100', 'offset'],
    ok: { 200: page('users', obj({ id: int(), display_name: str(), email: nullable(str()), github_login: nullable(str()), is_admin: { type: 'boolean' }, created: str(), maintains: { type: 'array', items: str() }, maintains_repos: { type: 'array', items: str() } }, ['id', 'display_name', 'github_login', 'is_admin', 'created', 'maintains', 'maintains_repos'])) }, errors: [401, 403] },
  { method: 'post', path: '/api/users', auth: 'admin', tag: 'users', summary: 'create an account {email,password,is_admin?,display_name?}',
    description: 'CLI: `user-add`.',
    body: obj({ email: str(undefined, { format: 'email' }), password: str(undefined, { minLength: 10, maxLength: 256 }), is_admin: bool(), display_name: str(undefined, { maxLength: 64 }) }, ['email', 'password']),
    ok: { 201: userWrap('SelfUser') }, errors: [400, 401, 403, 409] },
  { method: 'get', path: '/api/users/{id}', auth: 'public', tag: 'users', summary: 'public profile with maintains: [device slugs]',
    ok: { 200: obj({ user: { allOf: [ref('PublicUser'), obj({ maintains: arr(str()) }, ['maintains'])] } }, ['user']) }, errors: [404] },
  { method: 'delete', path: '/api/users/{id}', auth: 'admin', tag: 'users', summary: 'remove an account (its sessions, tokens, claims, repo claims, uploads; it stops maintaining its repos)',
    description: 'An admin cannot delete their own account (409).', ok: { 200: deleted(int()) }, errors: [401, 403, 404, 409] },
];

/** Short names for the reference sidebar (OpenAPI `summary`), by "METHOD path". */
export const TITLES: Record<string, string> = {
  'GET /api/docs': 'List endpoints',
  'GET /api/openapi.json': 'Get this document',
  'GET /api/areas': 'List areas',
  'POST /api/areas': 'Add an area',
  'GET /api/devices': 'List devices',
  'POST /api/devices': 'Add a device',
  'GET /api/devices/{slug}': 'Get a device',
  'PATCH /api/devices/{slug}': 'Update a device',
  'DELETE /api/devices/{slug}': 'Remove a device',
  'GET /api/devices/{slug}/updates': "List a phone's updates",
  'POST /api/devices/{slug}/updates': 'Post a photo update',
  'DELETE /api/devices/{slug}/updates/{id}': 'Remove an update',
  'GET /api/catalog': 'Search the device catalog',
  'GET /api/status': 'List statuses',
  'PUT /api/status': 'Set a status (body names the cell)',
  'POST /api/status': 'Set a status (POST alias)',
  'GET /api/status/{device}/{area}': 'Get one status',
  'PUT /api/status/{device}/{area}': 'Set one status',
  'POST /api/status/{device}/{area}': 'Set one status (POST alias)',
  'GET /api/forks': 'List forks',
  'POST /api/forks': 'Add a fork',
  'POST /api/forks/sync': 'Sync a fork',
  'GET /api/forks/{id}': 'Get a fork',
  'PATCH /api/forks/{id}': 'Update a fork',
  'DELETE /api/forks/{id}': 'Remove a fork',
  'POST /api/forks/{id}/devices': 'Add a supported device',
  'DELETE /api/forks/{id}/devices': 'Remove a supported device',
  'POST /api/forks/{id}/lineage': 'Add a "based on" row',
  'DELETE /api/forks/{id}/lineage': 'Remove a "based on" row',
  'GET /api/forks/{id}/maintainers': 'List repo maintainers',
  'POST /api/forks/{id}/maintainers': 'Add a repo maintainer',
  'DELETE /api/forks/{id}/maintainers': 'Remove a repo maintainer',
  'DELETE /api/forks/{id}/maintainer': 'Step down as a repo maintainer',
  'GET /api/lineage': 'Repo family tree',
  'POST /api/repos/claim': 'Claim a repo',
  'POST /api/repos/claim/{id}/verify': 'Verify a repo claim',
  'GET /api/repos/claims': 'List repo claims',
  'POST /api/repos/claims/{id}/approve': 'Approve a repo claim',
  'POST /api/repos/claims/{id}/reject': 'Reject a repo claim',
  'GET /api/media': 'List uploads',
  'POST /api/media': 'Upload an image or clip',
  'GET /api/media/{id}': 'Get an upload',
  'DELETE /api/media/{id}': 'Delete an upload',
  'GET /api/posts': 'List posts',
  'POST /api/posts': 'Add a post',
  'GET /api/posts/{id}': 'Get a post',
  'PATCH /api/posts/{id}': 'Update a post',
  'DELETE /api/posts/{id}': 'Remove a post',
  'POST /api/reddit/fetch': 'Fetch Reddit posts',
  'GET /api/claims': 'List claims',
  'POST /api/claims': 'Claim a device',
  'GET /api/claims/{id}': 'Get a claim',
  'PATCH /api/claims/{id}': 'Set a claim status',
  'DELETE /api/claims/{id}': 'Withdraw a claim',
  'POST /api/claims/{id}/approve': 'Approve a claim',
  'POST /api/claims/{id}/reject': 'Reject a claim',
  'GET /api/changelog': 'List changelog',
  'GET /api/search': 'Search',
  'POST /api/auth/signup': 'Sign up',
  'POST /api/auth/register': 'Sign up (alias)',
  'GET /api/auth/github': 'Is GitHub sign-in on',
  'GET /api/auth/github/start': 'Start GitHub sign-in',
  'GET /api/auth/github/callback': 'Finish GitHub sign-in',
  'POST /api/auth/login': 'Log in with email',
  'POST /api/auth/logout': 'Log out',
  'POST /api/auth/password': 'Change my password',
  'POST /api/auth/password-reset': 'Request a password reset',
  'POST /api/auth/password-reset/confirm': 'Reset a password',
  'GET /api/auth/me': 'Who am I',
  'GET /api/auth/tokens': 'List my tokens',
  'POST /api/auth/tokens': 'Mint a token',
  'DELETE /api/auth/tokens': 'Revoke a token',
  'POST /api/auth/gh-challenge': 'Start a gist proof',
  'POST /api/auth/gh-verify': 'Log in with a gist proof',
  'POST /api/auth/link': 'Link GitHub to an email account',
  'POST /api/auth/gh-link': 'Link GitHub (logged in)',
  'DELETE /api/auth/gh-link': 'Unlink GitHub',
  'POST /api/auth/unlink': 'Unlink GitHub (UI shape)',
  'POST /api/auth/token-check': 'Check or exchange a token',
  'GET /api/tokens': 'List my API keys',
  'POST /api/tokens': 'Create an API key',
  'DELETE /api/tokens/{id}': 'Revoke an API key',
  'POST /api/tokens/{id}/rotate': 'Rotate an API key',
  'GET /api/users': 'List accounts',
  'POST /api/users': 'Create an account',
  'GET /api/users/{id}': 'Get a profile',
  'DELETE /api/users/{id}': 'Remove an account',
};

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

const ERROR_TEXT: Record<number, string> = {
  400: 'Bad input: a missing field, a bad slug, state or URL, or a malformed JSON body.',
  401: 'Not logged in: send a session cookie or `Authorization: Bearer <token>` (`node cli.mjs login`).',
  403: 'Logged in, but not allowed: the hint says what grants it (an approved claim on the device, the repo, or admin). A key without the needed scope is 403 {error:"token scope", hint:"needs <scope>"}. A cross-site cookie write is also 403.',
  404: 'No such device, area, fork, post, claim, repo claim, upload, token or user.',
  405: 'Method not allowed; the Allow header lists the methods this path accepts.',
  409: 'Conflict: the row exists already (duplicate slug, fork, post URL, claim), the claim is not pending, or the GitHub account is linked to another user.',
  410: 'The gist-proof challenge expired (10 minutes) or was used, the repo claim expired (24 h), or the password-reset link expired (30 minutes) or was used: start again.',
  411: 'An upload without Content-Length.',
  413: 'Body over 64 KB (JSON), or an upload over its limit (images 15 MB, videos 95 MB).',
  415: 'An upload that is not multipart/form-data, or a file that is not an allowed image or video (read from its bytes).',
  422: 'The gist does not prove the challenge (wrong owner, no nonce in it), or .iosonand-verify is missing or wrong.',
  429: 'Rate limited: too many calls from this IP or account in the last minute (sign-in calls also count per email). Retry-After says how many seconds to wait.',
  500: 'Server error; retry.',
  502: 'GitHub or Reddit did not answer as expected; retry later.',
  503: 'Media storage (the R2 binding MEDIA) is not configured.',
};

const TAGS = [
  { name: 'devices', description: 'Phones and their headline status.' },
  { name: 'status', description: 'One cell per device and checklist area.' },
  { name: 'areas', description: 'The checklist areas.' },
  { name: 'forks', description: 'Tracked repos: upstream repos, standalone ports and device forks; the devices each supports and what each is based on.' },
  { name: 'repos', description: 'Repo ownership: claim a repo (GitHub owner or a proof file), then maintain it.' },
  { name: 'media', description: 'Screenshots and clips as proof, stored on R2.' },
  { name: 'posts', description: 'Reddit posts on the Updates tab.' },
  { name: 'claims', description: 'Requests to maintain a device; an admin approves them.' },
  { name: 'auth', description: 'Email and GitHub gist-proof login.' },
  { name: 'tokens', description: 'API keys for the CLI and agents, with scopes, expiry and rotation.' },
  { name: 'users', description: 'Accounts.' },
  { name: 'meta', description: 'Search, changelog and this description.' },
];

/** `/api/devices/{slug}` -> `/api/devices/:slug` (the /api/docs style). */
export function colonPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

/** Keep <placeholders> visible in Markdown descriptions. */
const mdEscape = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pathParams(path: string): Schema[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: m[1] === 'id' ? { type: 'integer' } : { type: 'string' },
    description: m[1] === 'id' ? 'numeric id' : `${m[1]} slug`,
  }));
}

function operationObject(op: Operation): Schema {
  const security =
    op.auth === 'public'
      ? op.optionalAuth
        ? [{}, { bearerAuth: [] }, { cookieAuth: [] }]
        : []
      : [{ bearerAuth: [] }, { cookieAuth: [] }];
  const responses: Record<string, Schema> = {};
  for (const [code, schema] of Object.entries(op.ok)) {
    if (code.startsWith('3')) {
      // A redirect: no body, a Location header (schema.description says where).
      responses[code] = { description: (schema as { description?: string }).description ?? 'Redirect', headers: { Location: { schema: { type: 'string' } } } };
      continue;
    }
    responses[code] = {
      description: code === '201' ? 'Created' : 'OK',
      ...(op.setsCookie ? { headers: { 'Set-Cookie': { description: 'iosonand_session=...; HttpOnly; SameSite=Lax', schema: { type: 'string' } } } } : {}),
      content: { 'application/json': { schema } },
    };
  }
  for (const code of [...(op.errors ?? []), 405, 429, 500]) {
    responses[String(code)] = { $ref: `#/components/responses/E${code}` };
  }
  const params = [...pathParams(op.path), ...(op.query ?? []).map((q) => ({ $ref: `#/components/parameters/${q}` }))];
  const scope = op.auth === 'public' && !op.optionalAuth ? null : scopeFor(op.method, op.path);
  const authLine = `Auth: **${op.auth}**: ${mdEscape(AUTH_LEVELS[op.auth])}.${scope ? ` API key scope: **${scope}**.` : ''}`;
  return {
    operationId: `${op.method}${op.path.replace(/^\/api/, '').replace(/[{}]/g, '').replace(/[/.-](\w)/g, (_, c: string) => c.toUpperCase())}`,
    summary: TITLES[`${op.method.toUpperCase()} ${op.path}`] ?? op.summary,
    description: [mdEscape(op.summary), op.description, authLine].filter(Boolean).join('\n\n'),
    tags: [op.tag],
    'x-auth': op.auth,
    ...(op.auth === 'public' && !op.optionalAuth ? {} : { 'x-scope': scopeFor(op.method, op.path) }),
    security,
    ...(params.length ? { parameters: params } : {}),
    ...(op.body
      ? { requestBody: { required: !op.bodyOptional, content: { 'application/json': { schema: op.body } } } }
      : op.multipart
        ? { requestBody: { required: true, content: { 'multipart/form-data': { schema: op.multipart, encoding: { file: { contentType: 'image/jpeg, image/png, image/webp, image/avif, video/mp4, video/webm, video/quicktime' } } } } } }
        : {}),
    responses,
  };
}

/** The OpenAPI 3.1 document. `origin` becomes the server URL (same-origin "Try it"). */
export function openapiDocument(origin?: string): Schema {
  const paths: Record<string, Record<string, Schema>> = {};
  for (const op of OPERATIONS) {
    (paths[op.path] ??= {})[op.method] = operationObject(op);
  }
  const responses: Record<string, Schema> = {};
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    responses[`E${code}`] = {
      description: text,
      ...(code === '405' ? { headers: { Allow: { schema: { type: 'string' } } } } : {}),
      ...(code === '429' ? { headers: { 'Retry-After': { schema: { type: 'integer' } } } } : {}),
      content: { 'application/json': { schema: ref('Error') } },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'iOSOnAnd tracker API',
      version: '1',
      description: [
        'Read and update the per-device, per-area status of iOS on Android phones (OneiOS and its forks).',
        'Reads are public. Writes need a tracker token (`node cli.mjs login`, then `Authorization: Bearer ion_...`) or the session cookie from /login. Every write adds a changelog row.',
        `Auth levels (the \`x-auth\` field of each operation): ${Object.entries(AUTH_LEVELS).map(([k, v]) => `**${k}**: ${mdEscape(v)}`).join('; ')}.`,
        ...API_NOTES.map((n) => `- ${n}`),
        'Guides: [/docs](/docs). The same endpoint list as JSON: [/api/docs](/api/docs).',
      ].join('\n\n'),
    },
    servers: [{ url: origin || '/', description: 'this tracker' }],
    tags: TAGS,
    paths,
    components: {
      schemas: SCHEMAS,
      parameters: QUERY,
      responses,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ion_<token>',
          description: 'A tracker token (api_tokens): `node cli.mjs login` saves one to ~/.config/iosonand/tokens.json; POST /api/auth/tokens mints more.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'iosonand_session',
          description: 'The session cookie set by /api/auth/login, /api/auth/signup and /api/auth/gh-verify. Writes with it need Content-Type: application/json, or X-Requested-With: iosonand (uploads).',
        },
      },
    },
  };
}

export interface DocsEndpoint {
  method: string;
  path: string;
  auth: AuthLevel;
  desc: string;
}

/**
 * The GET /api/docs list: one row per operation, with adjacent operations on
 * the same path, auth and summary joined ("PUT,POST"). Query parameters show
 * as `?name=` (`?name=value` when only one value is allowed).
 */
export function docsEndpoints(): DocsEndpoint[] {
  const out: Array<DocsEndpoint & { key: string }> = [];
  for (const op of OPERATIONS) {
    // `?name=`, or `?name=value` for a parameter with one allowed value (user=me).
    const pairs = (op.query ?? []).map((q) => {
      const p = QUERY[q] as { name: string; schema: { enum?: string[] } };
      return `${p.name}=${p.schema.enum?.length === 1 ? p.schema.enum[0] : ''}`;
    });
    const path = colonPath(op.path) + (pairs.length ? `?${pairs.join('&')}` : '');
    const key = `${path} ${op.auth} ${op.summary}`;
    const prev = out[out.length - 1];
    if (prev && prev.key === key) {
      prev.method += `,${op.method.toUpperCase()}`;
      continue;
    }
    out.push({ key, method: op.method.toUpperCase(), path, auth: op.auth, desc: op.summary });
  }
  return out.map(({ key: _key, ...e }) => e);
}
