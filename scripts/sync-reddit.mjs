#!/usr/bin/env node
// Bring r/hackios threads into the tracker: new port posts for the Updates
// tab, the phones and repos they are about, and (--claims) the porters' own
// status claims.
//
//   node scripts/sync-reddit.mjs                     # dry run: print the plan
//   node scripts/sync-reddit.mjs --apply             # write it through the tracker API
//   [--url http://127.0.0.1:3001] [--since 2026-10-01 | --all] [--subreddit hackios]
//   [--claims] [--save DIR] [--input DIR] [--concurrency 4] [--source archive|reddit]
//   [--report FILE]
//
// Where it reads (no login):
//   - the Arctic Shift archive of Reddit (arctic-shift.photon-reddit.com), the
//     default: posts since --since (default: 3 days before the newest post the
//     tracker has; --all: the whole history) and every comment in the
//     subreddit since then. A comment on an older post brings that post in
//     too, so a porter's update in an old thread is read. Posts are read by
//     week and comments by day (the archive times out on wide comment
//     queries), the windows in parallel with at most --concurrency requests in
//     flight (default 4, at most 8). It follows the archive's x-ratelimit-*
//     headers, waiting for the reset when few requests remain, and backs off
//     (exponential, with jitter) on 429, 5xx and the archive's "slow down"
//     timeout.
//   - --source reddit: Reddit's public JSON, GET /r/<sub>/new.json back to
//     --since and GET /comments/<id>.json for each post with comments. Reddit
//     refuses some networks (403 "blocked by network security").
//   - --input DIR: saved responses, DIR/posts.json (an array of posts) and
//     DIR/comments.json (an array of comments with link_id), Reddit's own
//     shape. --save DIR writes the ones a run fetched there.
//
// Whose words count: the thread's author, in the post and in their own
// comments in it, and anyone linking a repo whose GitHub owner has their
// Reddit name. A repo someone else links counts when its own name points to
// one phone (hakios-apollo, oneios-s25-ultra). Other repos are only reported.
//
// What it writes (admin token: TRACKER_TOKEN, or the CLI's
// ~/.config/iosonand/tokens.json entry for the tracker URL):
//   - posts: a thread not tracked yet, when its author links a GitHub repo, or
//     it names exactly one tracked phone and has a port flair (PORT_FLAIRS).
//     The note names the phone and the repos; a preview image is kept.
//   - repos: a porter-linked repo that exists on GitHub and is not tracked,
//     for the one phone the thread names (fork-claim, like every repo found
//     through Reddit; kind fork or standalone from GitHub; base_project from
//     the GitHub fork root). A tracked repo gains that phone in its supported
//     list (claimed) when the thread names it. The tracker links lineage from
//     the GitHub parent and README itself.
//   - phones: one scripts/reddit-map.json lists (new_devices) that a kept
//     thread or a repo is about.
//   - states: only with --claims, from the porter's own sentences (see
//     claimsOf), quoted as `reddit claim (YYYY-MM-DD): "..."`, only where the
//     row is missing, unknown or an older reddit claim. Without --claims the
//     report lists, per phone, the threads and the author's own words, to be
//     written with `node cli.mjs status-set`.
// Every decision goes to the report (default: reddit-sync-report.json).
// GITHUB_TOKEN, when set, raises GitHub's rate limit for the repo checks.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const APPLY = argv.includes('--apply');
const TRACKER = flag('--url', process.env.TRACKER_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const SUB = flag('--subreddit', 'hackios');
const INPUT = flag('--input', null);
const REPORT = flag('--report', 'reddit-sync-report.json');
const SINCE_ARG = flag('--since', null);
// The archive is the default source; --source reddit reads Reddit's JSON instead (--archive is the old spelling).
const SOURCE = flag('--source', 'archive');
if (!['archive', 'reddit'].includes(SOURCE)) throw new Error(`bad --source ${SOURCE}: archive or reddit`);
const ARCHIVE = SOURCE === 'archive';
const ALL = argv.includes('--all');
const CLAIMS = argv.includes('--claims');
const SAVE = flag('--save', null);
const CONCURRENCY = Math.min(Math.max(Number(flag('--concurrency', 4)) || 4, 1), 8);
const ARCTIC = 'https://arctic-shift.photon-reddit.com/api';
const TAG = 'reddit claim';
const UA = 'iosonand-tracker-sync/1.0 (community device-status tracker)';
const PORT_FLAIRS = /port|release|showcase|progress|news|project|update|hackios|hackipados/i;
/** Phone makers: a title naming one but no tracked phone is about a phone we do not track. */
const MAKERS = /\b(samsung|galaxy|pixel|redmi|poco|xiaomi|oneplus|moto(rola)?|nokia|realme|oppo|vivo|infinix|tecno|lg|sony|xperia|huawei|honor|nothing phone|asus|rog phone|zte|nubia|lenovo|meizu|iqoo|fairphone)\b/i;
/** Repos that are tools or upstreams, not one phone's port. */
const NOT_A_PORT = new Set(['dipa-studio/ios-sweet', 'oosexgang/hakios-xnu-kernel', 'oosexgang/hackios-xnu-userland', 'unixnu/unixnu', 'akshaynexus/oneios']);
/** GitHub fork roots -> base_project. */
const ROOTS = {
  'dipa-studio/ios-sweet': 'ios-sweet',
  'oosexgang/hakios-xnu-kernel': 'HackiOS',
  'unixnu/unixnu': 'UniXNU',
  'akshaynexus/oneios': 'OneiOS',
};

if (!/^[A-Za-z0-9_]{1,21}$/.test(SUB)) throw new Error(`bad --subreddit ${SUB}`);

function token() {
  if (process.env.TRACKER_TOKEN) return process.env.TRACKER_TOKEN;
  try {
    const all = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'iosonand', 'tokens.json'), 'utf8'));
    return all[TRACKER] ?? null;
  } catch {
    return null;
  }
}
const TOKEN = token();

async function api(method, p, body) {
  const r = await fetch(TRACKER + p, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reddit(p) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://www.reddit.com${p}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
    const type = r.headers.get('content-type') || '';
    if (r.status === 429 && attempt < 3) {
      await sleep(10_000 * (attempt + 1));
      continue;
    }
    if (!r.ok || !type.includes('json')) {
      throw new Error(
        `GET reddit.com${p}: ${r.status}${type.includes('json') ? '' : ' (not JSON)'}. Reddit may refuse this network; ` +
          'run from another network, or save the responses and pass --input DIR (see the header of this script).',
      );
    }
    await sleep(1100); // about one request a second
    return r.json();
  }
}

// ---------------------------------------------------------------- archive

/** At most CONCURRENCY archive requests at a time, paused together when the rate limit runs low. */
let inFlight = 0;
const waiting = [];
let pausedUntil = 0;
async function slot() {
  while (inFlight >= CONCURRENCY) await new Promise((r) => waiting.push(r));
  inFlight++;
  const wait = pausedUntil - Date.now();
  if (wait > 0) await sleep(wait);
}
function release() {
  inFlight--;
  waiting.shift()?.();
}

let archiveRequests = 0;
async function arctic(p) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    let r;
    try {
      r = await fetch(`${ARCTIC}${p}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
    } catch (e) {
      release();
      if (attempt >= 5) throw e;
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    archiveRequests++;
    const remaining = Number(r.headers.get('x-ratelimit-remaining'));
    const reset = Number(r.headers.get('x-ratelimit-reset')) || 0;
    if (Number.isFinite(remaining) && r.headers.has('x-ratelimit-remaining') && remaining <= CONCURRENCY) {
      pausedUntil = Math.max(pausedUntil, Date.now() + (reset + 1) * 1000);
    }
    // The archive answers 422 "Timeout. Maybe slow down a bit" when a query runs too long.
    const slow = r.status === 422 && /timeout|slow down/i.test(await r.clone().text().catch(() => ''));
    if (r.status === 429 || r.status >= 500 || slow) {
      release();
      if (attempt >= 6) throw new Error(`GET ${p}: ${r.status} after ${attempt + 1} tries`);
      const backoff = r.status === 429 && reset ? (reset + 1) * 1000 : 1000 * 2 ** attempt;
      pausedUntil = Math.max(pausedUntil, Date.now() + backoff);
      await sleep(backoff + Math.random() * 1000);
      continue;
    }
    try {
      if (!r.ok) throw new Error(`GET ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).data ?? [];
    } finally {
      release();
    }
  }
}

/** Every post in [from, to), oldest first, a page of 100 at a time. */
async function archiveWindow(from, to) {
  const out = [];
  let after = from;
  for (;;) {
    const page = await arctic(`/posts/search?subreddit=${SUB}&after=${after}&before=${to}&sort=asc&limit=100`);
    out.push(...page);
    if (page.length < 100) return out;
    const last = page[page.length - 1].created_utc;
    after = last > after ? last : after + 1;
  }
}

/** Every comment in the subreddit in [from, to), a page of 100 at a time. */
async function archiveCommentWindow(from, to) {
  const out = [];
  let after = from;
  for (;;) {
    const page = await arctic(`/comments/search?subreddit=${SUB}&after=${after}&before=${to}&sort=asc&limit=100`);
    out.push(...page);
    if (page.length < 100) return out;
    const last = page[page.length - 1].created_utc;
    after = last > after ? last : after + 1;
  }
}

/** Split [from, to) into windows of `step` seconds and read them in parallel. */
async function inWindows(from, to, step, read) {
  const jobs = [];
  for (let a = from; a < to; a += step) jobs.push(read(a, Math.min(to, a + step)));
  return (await Promise.all(jobs)).flat();
}

/**
 * Posts and comments since `sinceUtc`: posts by week, comments by day (the
 * archive times out on wide comment queries), each window in parallel. A
 * comment on an older post brings that post in too (looked up by id), so a
 * porter's update in an old thread is read.
 */
async function readArchive(sinceUtc) {
  const started = Date.now();
  const now = Math.floor(Date.now() / 1000) + 60;
  // The archive's first post decides where the windows start.
  const first = (await arctic(`/posts/search?subreddit=${SUB}&sort=asc&limit=1`))[0];
  if (!first) return { posts: [], comments: [] };
  const start = Math.max(sinceUtc, first.created_utc);
  const [postRows, comments] = await Promise.all([
    inWindows(start, now, 7 * 86400, archiveWindow),
    inWindows(start, now, 86400, archiveCommentWindow),
  ]);
  const byId = new Map();
  for (const p of postRows) byId.set(p.id, p);
  const missing = [...new Set(comments.map((c) => String(c.link_id || '').replace(/^t3_/, '')))].filter((id) => id && !byId.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    for (const p of await arctic(`/posts/ids?ids=${missing.slice(i, i + 100).join(',')}`)) byId.set(p.id, p);
  }
  const posts = [...byId.values()].sort((a, b) => a.created_utc - b.created_utc);
  console.error(
    `archive: ${postRows.length} posts since ${day(start)}, ${missing.length} older posts with new comments, ${comments.length} comments, ${archiveRequests} requests in ${Math.round((Date.now() - started) / 1000)} s`,
  );
  return { posts, comments };
}

const ghCache = new Map();
async function github(repo) {
  if (ghCache.has(repo.toLowerCase())) return ghCache.get(repo.toLowerCase());
  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': UA, ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
  });
  let out = null;
  if (r.ok) {
    const j = await r.json();
    const root = (j.source?.full_name || j.parent?.full_name || '').toLowerCase();
    out = { repo: j.full_name, fork: !!j.fork, parent: j.parent?.full_name ?? null, root, branch: j.default_branch };
  } else if (r.status !== 404) {
    throw new Error(`GitHub ${repo}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  ghCache.set(repo.toLowerCase(), out);
  return out;
}

// ---------------------------------------------------------------- helpers

const lc = (s) => String(s || '').toLowerCase();
const day = (utc) => new Date(utc * 1000).toISOString().slice(0, 10);
const permalink = (p) => `https://www.reddit.com${p.permalink.replace(/\/$/, '')}`;
const canonicalUrl = (u) => u.replace(/^https?:\/\/(old\.|np\.)?reddit\.com/i, 'https://www.reddit.com').replace(/[?#].*$/, '').replace(/\/$/, '');

/** GitHub repos named in text, as {repo, branch}; site paths (orgs, settings) skipped. */
function repos(text) {
  const out = new Map();
  const SKIP = new Set(['orgs', 'settings', 'features', 'sponsors', 'marketplace', 'topics', 'apps', 'login', 'about', 'pricing']);
  for (const m of String(text || '').matchAll(/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})(?:\/tree\/([^\s)\]>"'#?]+))?/g)) {
    const owner = m[1];
    const name = m[2].replace(/\.git$/, '').replace(/[.,;:]+$/, '');
    if (SKIP.has(lc(owner)) || !name) continue;
    const repo = `${owner}/${name}`;
    if (!out.has(lc(repo))) out.set(lc(repo), { repo, branch: m[3] ?? '' });
  }
  return [...out.values()];
}

/** Repo names of the main projects: a fork that keeps one says nothing about its phone ("ios-sweet" is not the Redmi Note 10 Pro). */
const BASE_NAMES = new Set([...NOT_A_PORT].map((r) => r.split('/')[1]));

/**
 * Phone names to match: our device names (with and without maker prefixes,
 * "Note8" also as "Note 8", "(2023)" also bare, Moto also as Motorola),
 * model numbers, and reddit-map.json's aliases. Codenames (hakios-map.json,
 * reddit-map.json and each device's codename-like model) count only inside a
 * repo's name.
 */
function phoneMatcher(devices, extra) {
  const known = new Set(devices.map((d) => d.slug));
  const names = new Map(); // phrase -> slug
  const add = (phrase, slug) => {
    const p = lc(phrase).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (p.length >= 4 && !names.has(p)) names.set(p, slug);
  };
  for (const d of devices) {
    for (const part of String(d.name).split(/\s*\/\s*/)) {
      const bare = part.replace(/\(([^)]*)\)/g, ' $1 ');
      const spaced = bare.replace(/([a-z])(\d)/gi, '$1 $2');
      for (const v of new Set([part, bare, spaced])) {
        add(v, d.slug);
        add(v.replace(/^(samsung\s+)?galaxy\s+/i, 'galaxy '), d.slug);
        add(v.replace(/^(samsung\s+)?galaxy\s+/i, 'samsung '), d.slug);
        add(v.replace(/^(samsung\s+)?galaxy\s+/i, 'samsung galaxy '), d.slug);
        add(v.replace(/^moto\s+/i, 'motorola '), d.slug);
        add(v.replace(/^(samsung\s+galaxy|galaxy|google|xiaomi|samsung)\s+/i, ''), d.slug);
        add(v.replace(/\s+5g$/i, ''), d.slug);
      }
    }
    // Model numbers name one phone: SM-G930F, GT-I9100 (also as I9100).
    for (const m of String(d.model || '').split(/\s*\/\s*/)) {
      if (/\d/.test(m) && /^[A-Z0-9-]{5,}$/.test(m)) {
        add(m, d.slug);
        add(m.replace(/^(SM|GT)-/, ''), d.slug);
      }
    }
  }
  for (const [phrase, slug] of Object.entries(extra.aliases ?? {})) if (known.has(slug)) add(phrase, slug);
  const map = JSON.parse(fs.readFileSync(path.join(HERE, 'hakios-map.json'), 'utf8'));
  const code = new Map();
  for (const [c, slug] of [...Object.entries(map.codenames), ...Object.entries(extra.codenames ?? {})]) if (known.has(slug)) code.set(lc(c), slug);
  for (const d of devices) {
    for (const m of String(d.model || '').split(/\s*\/\s*/)) if (/^[a-z][a-z0-9_]{3,}$/.test(m) && !code.has(m)) code.set(m, d.slug);
  }
  const phrases = [...names.keys()].sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-z0-9])(${phrases.map(esc).join('|')})(?![a-z0-9+])`, 'g');
  const codes = [...code.keys()].sort((a, b) => b.length - a.length);
  const codeRe = new RegExp(`(?<![a-z0-9])(${codes.map(esc).join('|')})(?![a-z0-9])`, 'g');
  const byName = (text) => {
    const found = new Set();
    for (const m of lc(text).replace(/[()]/g, ' ').matchAll(re)) found.add(names.get(m[1]));
    return [...found];
  };
  /** The phones a repo's own name points to: a codename (hakios-xnu-kernel-munch) or a phone name (oneios-s25-ultra). */
  const ofRepo = (repo) => {
    const name = lc(repo.split('/')[1] ?? '').replace(/\.git$/, '');
    if (!name || BASE_NAMES.has(name)) return [];
    const found = new Set();
    for (const m of name.replace(/[_.]/g, '-').matchAll(codeRe)) found.add(code.get(m[1]));
    for (const s of byName(name.replace(/[-_.]+/g, ' '))) found.add(s);
    return [...found];
  };
  const byRepoName = (repoNames) => [...new Set(repoNames.flatMap(ofRepo))];
  /**
   * The phones a thread is about: named in the title, else in the body, else a
   * codename in a porter repo's name. A title that names a phone maker but no
   * tracked phone is about a phone we do not have (a body often names the
   * phone the port started from), so it matches nothing and is reported.
   */
  const match = ({ title, body, repoNames }) => {
    const inTitle = byName(title);
    if (inTitle.length) return { phones: inTitle };
    if (MAKERS.test(title)) return { phones: [], untracked: title };
    for (const found of [byName(body), byRepoName(repoNames)]) if (found.length) return { phones: found };
    return { phones: [] };
  };
  match.ofRepo = ofRepo;
  return match;
}

// ---------------------------------------------------------------- read

const report = { subreddit: SUB, tracker: TRACKER, applied: APPLY, at: new Date().toISOString(), devices: [], posts: [], forks: [], states: [], claims_to_review: [], repos_mentioned: [], skipped: [], errors: [] };

const devices = (await api('GET', '/api/devices?limit=1000')).devices;
const deviceBySlug = new Map(devices.map((d) => [d.slug, d]));
// Phones reddit-map.json lists that the tracker does not have yet: matched like the others, added when a thread is about them.
const REDDIT_MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'reddit-map.json'), 'utf8'));
const newDevices = new Map(REDDIT_MAP.new_devices.filter((d) => !deviceBySlug.has(d.slug)).map((d) => [d.slug, d]));
const createdDevices = new Set();
async function ensureDevice(slug, t) {
  const d = newDevices.get(slug);
  if (!d || createdDevices.has(slug)) return;
  createdDevices.add(slug);
  report.devices.push({ action: 'add', slug, name: d.name, thread: t.url });
  if (APPLY) {
    await api('POST', '/api/devices', {
      slug, name: d.name, model: d.model, soc: d.soc, repo_kind: 'fork', base: 'other', status: 'unknown',
      notes: `Added from r/${SUB} (${t.url}).`,
      ...Object.fromEntries(['image_url', 'image_credit', 'image_license', 'image_source_url'].filter((k) => d[k]).map((k) => [k, d[k]])),
    });
  }
}
const forks = (await api('GET', '/api/forks?limit=1000')).forks;
const forkByRepo = new Map(forks.map((f) => [lc(f.repo), f]));
const tracked = (await api('GET', '/api/posts?limit=500')).posts;
const trackedUrls = new Set(tracked.map((p) => canonicalUrl(p.url)));
const newest = tracked.map((p) => p.published).sort().pop();
const since = SINCE_ARG ?? (ALL ? '2015-01-01' : newest ? new Date(Date.parse(newest) - 3 * 86400_000).toISOString().slice(0, 10) : '2026-10-01');
const sinceUtc = Date.parse(`${since}T00:00:00Z`) / 1000;

if (APPLY) {
  if (!TOKEN) throw new Error(`no token for ${TRACKER}: set TRACKER_TOKEN or run node ./cli.mjs login --admin`);
  const me = await api('GET', '/api/auth/me');
  if (!me.is_admin) throw new Error('the sync needs an admin token');
}

let posts = [];
let comments = [];
if (INPUT) {
  posts = JSON.parse(fs.readFileSync(path.join(INPUT, 'posts.json'), 'utf8')).map((p) => p.data ?? p);
  const cf = path.join(INPUT, 'comments.json');
  if (fs.existsSync(cf)) comments = JSON.parse(fs.readFileSync(cf, 'utf8')).map((c) => c.data ?? c);
  posts = posts.filter((p) => p.created_utc >= sinceUtc);
} else if (ARCHIVE) {
  ({ posts, comments } = await readArchive(sinceUtc));
} else {
  try {
  let after = null;
  for (;;) {
    const page = await reddit(`/r/${SUB}/new.json?limit=100&raw_json=1${after ? `&after=${after}` : ''}`);
    const kids = page.data.children.map((c) => c.data);
    posts.push(...kids.filter((p) => p.created_utc >= sinceUtc));
    after = page.data.after;
    if (!after || !kids.length || kids[kids.length - 1].created_utc < sinceUtc) break;
  }
  const walk = (node, out) => {
    for (const c of node?.data?.children ?? []) {
      if (c.kind !== 't1') continue;
      out.push(c.data);
      if (c.data.replies) walk(c.data.replies, out);
    }
  };
  for (const p of posts) {
    if (!p.num_comments) continue;
    try {
      const [, tree] = await reddit(`/comments/${p.id}.json?raw_json=1&limit=500`);
      walk(tree, comments);
    } catch (e) {
      report.errors.push({ post: permalink(p), error: String(e.message || e) });
    }
  }
  } catch (e) {
    console.error(`sync-reddit: ${e.message || e}`);
    process.exit(2);
  }
}
if (SAVE) {
  fs.mkdirSync(SAVE, { recursive: true });
  fs.writeFileSync(path.join(SAVE, 'posts.json'), JSON.stringify(posts));
  fs.writeFileSync(path.join(SAVE, 'comments.json'), JSON.stringify(comments));
}
const commentsByPost = new Map();
for (const c of comments) {
  const id = String(c.link_id || '').replace(/^t3_/, '');
  if (!commentsByPost.has(id)) commentsByPost.set(id, []);
  commentsByPost.get(id).push(c);
}

const matchPhones = phoneMatcher([...devices, ...newDevices.values()], REDDIT_MAP);

// ---------------------------------------------------------------- threads

const threads = [];
for (const p of posts.sort((a, b) => a.created_utc - b.created_utc)) {
  if (p.removed_by_category || p.author === '[deleted]') continue;
  const url = canonicalUrl(permalink(p));
  const own = (commentsByPost.get(p.id) ?? []).filter((c) => c.author === p.author);
  const porterText = [p.title, p.selftext, p.url_overridden_by_dest ?? p.url, ...own.map((c) => c.body)].join('\n');
  const porterRepos = repos(porterText);
  // Repos others link: kept when the GitHub owner is the commenter (their own
  // repo), or when the repo's own name points to exactly one phone
  // (hakios-apollo, oneios-s25-ultra): then it is filed under that phone.
  for (const c of commentsByPost.get(p.id) ?? []) {
    if (c.author === p.author) continue;
    for (const r of repos(c.body)) {
      const named = matchPhones.ofRepo(r.repo);
      if (lc(r.repo.split('/')[0]) === lc(c.author)) porterRepos.push(r);
      else if (named.length === 1) porterRepos.push({ ...r, phone: named[0], by: c.author });
      else report.repos_mentioned.push({ thread: url, by: c.author, repo: r.repo });
    }
  }
  const { phones, untracked } = matchPhones({ title: p.title, body: p.selftext, repoNames: porterRepos.map((r) => r.repo) });
  threads.push({ p, url, phones, untracked, repos: porterRepos, own, flair: p.link_flair_text || '' });
}

// ---------------------------------------------------------------- posts

for (const t of threads) {
  if (trackedUrls.has(t.url)) continue;
  const portRepos = t.repos.filter((r) => !NOT_A_PORT.has(lc(r.repo)));
  // Without a repo, a port flair counts for a thread about one phone that
  // shows it (a photo or video) and is not a question or a request for help.
  const asks = /\?\s*$/.test(t.p.title.trim()) || /\b(help|anyone|someone|can (yall|you|i|we)|looking for|need|want|request|possible|how (to|do|can))\b/i.test(t.p.title);
  const media = !!(t.p.is_video || t.p.is_gallery || t.p.preview || t.p.media || t.p.media_metadata) || /i\.redd\.it|v\.redd\.it|imgur\.com|youtu/.test(String(t.p.url || ''));
  const keep = t.phones.length > 0 && (portRepos.length > 0 || (t.phones.length === 1 && PORT_FLAIRS.test(t.flair) && !asks && media));
  if (!keep) {
    const why = t.untracked
      ? `about a phone the tracker does not have (add it with device-add, then rerun)${portRepos.length ? `; links ${portRepos.map((r) => r.repo).join(', ')}` : ''}`
      : !t.phones.length
      ? portRepos.length ? `links ${portRepos.map((r) => r.repo).join(', ')} but names no tracked phone: review by hand` : 'names no tracked phone'
      : t.phones.length > 1 ? `names ${t.phones.length} phones and links no repo` : 'no repo from its author and no port flair';
    report.skipped.push({ thread: t.url, title: t.p.title.slice(0, 100), why });
    continue;
  }
  const phoneNames = t.phones.map((s) => deviceBySlug.get(s)?.name ?? s);
  const note = [phoneNames.join(', '), portRepos.length ? `(${portRepos.map((r) => r.repo + (r.branch ? `, branch ${r.branch}` : '')).join('; ')})` : '', t.flair ? `[${t.flair}]` : '']
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);
  const img = t.p.preview?.images?.[0]?.resolutions?.find((x) => x.width >= 600) ?? t.p.preview?.images?.[0]?.source;
  const body = {
    title: t.p.title.slice(0, 300),
    url: t.url,
    published: day(t.p.created_utc),
    note,
    ...(img?.url ? { image_url: img.url.replace(/&amp;/g, '&'), image_width: img.width, image_height: img.height } : {}),
  };
  report.posts.push({ action: 'add', ...body });
  for (const s of t.phones) await ensureDevice(s, t);
  if (APPLY) {
    try {
      await api('POST', '/api/posts', body);
    } catch (e) {
      if (!/409/.test(String(e.message))) report.errors.push({ thread: t.url, error: String(e.message || e) });
    }
  }
  trackedUrls.add(t.url);
}

// ---------------------------------------------------------------- repos

for (const t of threads) {
  for (const { repo, branch, phone } of t.repos) {
    if (NOT_A_PORT.has(lc(repo))) continue;
    // A repo linked by someone else goes under the phone its name points to;
    // the porter's own under the thread's phone, else the one its name points to.
    const named = matchPhones.ofRepo(repo);
    const slug = phone ?? (t.phones.length === 1 ? t.phones[0] : named.length === 1 ? named[0] : null);
    if (slug) await ensureDevice(slug, t);
    let fork = forkByRepo.get(lc(repo));
    try {
      if (!fork) {
        if (!slug) {
          report.skipped.push({ thread: t.url, repo, why: t.untracked ? 'thread is about a phone the tracker does not have' : t.phones.length ? `thread names ${t.phones.length} phones (${t.phones.join(', ')})` : 'thread names no tracked phone' });
          continue;
        }
        const gh = await github(repo);
        if (!gh) {
          report.skipped.push({ thread: t.url, repo, why: 'not on GitHub (404, private or renamed)' });
          continue;
        }
        if (forkByRepo.has(lc(gh.repo))) {
          fork = forkByRepo.get(lc(gh.repo)); // linked under an old name
        } else {
          const kind = gh.fork ? 'fork' : 'standalone';
          const base_project = ROOTS[gh.root] ?? '';
          report.forks.push({ action: 'add', repo: gh.repo, device: slug, kind, base_project, thread: t.url });
          if (APPLY) {
            const created = (await api('POST', '/api/forks/sync', {
              repo: gh.repo,
              device_slug: slug,
              branch: branch || '',
              notes: `${TAG} (${day(t.p.created_utc)}): linked by the porter in ${t.url}`,
            })).fork;
            await api('PATCH', `/api/forks/${created.id}`, { kind, ...(base_project ? { base_project } : {}) });
            fork = created;
          } else {
            fork = { repo: gh.repo, device_slug: slug, supports: [] };
          }
          forkByRepo.set(lc(gh.repo), fork);
          continue;
        }
      }
      if (!slug) continue;
      const supported = fork.device_slug === slug || (fork.supports ?? []).some((s) => s.device_slug === slug);
      if (!supported) {
        report.forks.push({ action: 'support', repo: fork.repo, device: slug, thread: t.url });
        if (APPLY && fork.id) await api('POST', `/api/forks/${fork.id}/devices`, { device_slug: slug, support: 'claimed', note: `${TAG} (${day(t.p.created_utc)}): ${t.url}` });
        fork.supports = [...(fork.supports ?? []), { device_slug: slug }];
      }
    } catch (e) {
      report.errors.push({ thread: t.url, repo, error: String(e.message || e) });
    }
  }
}

// ---------------------------------------------------------------- claims to review

for (const t of threads) {
  if (t.phones.length !== 1) continue;
  const words = [t.p.selftext, ...t.own.map((c) => c.body)].map((s) => String(s || '').trim()).filter(Boolean);
  if (!words.length && !t.repos.length) continue;
  report.claims_to_review.push({
    device: t.phones[0],
    thread: t.url,
    date: day(t.p.created_utc),
    title: t.p.title,
    author_words: words.join('\n---\n').slice(0, 2000),
    write_with: `node cli.mjs status-set ${t.phones[0]} <area> <state> --detail "${TAG} (${day(t.p.created_utc)}): ..." --source "${t.url}"`,
  });
}

// ---------------------------------------------------------------- states (--claims)
//
// From the porter's own words (title, post, their comments in the thread) on
// a thread about one phone: each sentence that names an area and says how it
// is. "Wi-Fi works" -> works, "no Bluetooth" -> broken, "camera in progress"
// or "laggy" -> in-progress. The row quotes the sentence and links the thread.
// Written only where the phone has no row for that area, the row says
// unknown, or it is an older reddit claim: never over a maintainer's or a
// registry's row, and never lowering a state.

const AREA_WORDS = {
  wifi: /\b(wi-?fi|wlan)\b/i,
  gpu: /\b(gpu|metal|graphics acceleration|hardware acceleration)\b/i,
  touch: /\b(touch ?screen|touch(?![ -]?id)|multitouch|buttons?)\b/i,
  audio: /\b(audio|sound|speakers?)\b/i,
  bluetooth: /\b(bluetooth)\b/i,
  modem: /\b(lte|cellular|mobile data|volte|mobile network)\b/i,
  calls: /\b(phone calls?|calls)\b/i,
  sms: /\b(sms)\b/i,
  camera: /\b(cameras?)\b/i,
  battery: /\b(battery (reading|reporting|percentage|level|status)|charging)\b/i,
  sensors: /\b(sensors?|gyro(scope)?|accelerometer)\b/i,
  haptics: /\b(haptics?|vibration)\b/i,
  keyboard: /\b(keyboard)\b/i,
  brightness: /\b(brightness|backlight)\b/i,
};
/** Boot to Home Screen: only when the Home Screen, lock screen or SpringBoard is reached. */
const BOOT_DONE = /\b(boots?|booted|booting|got|gets|reach(ed|es)?|running|runs|shows|showing|into|to)\b[^.]{0,40}\b(home ?screen|springboard|lock ?screen)\b|\b(home ?screen|lock ?screen|springboard)\b[^.]{0,25}\b(works?|working|loads?|loaded|shows|reached|(is|are) (up|working))\b/i;
/** Plans, conditions and questions say nothing about what works now. */
const NOT_NOW = /\b(will|once|try|trying|tried to|to get|get|need|needs|next|want|wants|hope|hoping|if|could|would|should|plan|planning|going to|gonna|anyone|anybody|help|probably|maybe|might|how|when|until|unless|soon|todo|to do|roadmap|wasn't able|not able|unable|couldn't|haven't tested|not tested|troubles?|struggl\w*)\b/i;
/** Sentences about another system on the phone say nothing about iOS (macOS has its own area, below). */
const OTHER_OS = /\b(windows|linux|macos|mac os|hackintosh|ubuntu)\b/i;
/** macOS on the phone: the 'macos' area (scope extra), from a sentence that names it and says it runs. */
const MACOS = /\b(mac ?os|hackintosh|about this mac)\b/i;
const MACOS_RUNS = /\b(boots?|booted|running|runs|works|working|desktop|finder|about this mac)\b/i;
const BROKEN = /\b(not working|doesn'?t work|don'?t work|isn'?t working|aren'?t working|not work(ing)? yet|broken|no (wi-?fi|sound|audio|touch|gpu|bluetooth|lte|camera|cameras|cellular)|(don'?t|doesn'?t) have|won'?t (start|work|load|boot))\b/i;
const PARTIAL = /\b(in progress|wip|working on|partially|partly|half|laggy|buggy|unstable|kinda|semi|early|basic|somewhat|sort of|mostly)\b/i;
const WORKS = /\b(works|working|fixed|functional)\b|✅/i;
const FAILS = /\b(fails?|failed|failing|crash(es|ed)?|panics?)\b/i;
const RANK = { unknown: 0, broken: 1, 'in-progress': 2, works: 3 };

function claimsOf(t) {
  const texts = [t.p.title, t.p.selftext, ...t.own.map((c) => c.body)].map((s) => String(s || ''));
  const out = new Map();
  const note = (area, state, s) => {
    if (!out.has(area)) out.set(area, { area, state, sentence: s.slice(0, 220) });
  };
  for (const text of texts) {
    for (const raw of text.split(/(?<=[.!?])\s+|\n+|;\s*/)) {
      const sentence = raw.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
      if (sentence.length < 6 || sentence.length > 300 || /\?/.test(sentence) || NOT_NOW.test(sentence)) continue;
      // macOS: the boot row of os macos (written as area 'macos' here, mapped when applied).
      if (MACOS.test(sentence) && !/\b(windows|linux|ubuntu)\b/i.test(sentence)) {
        // Booting that stops short (the logo, verbose, something not loading) is in progress.
        const short = /\b(logo|verbose|doesn'?t|does not|not|won'?t|panic)\b/i.test(sentence);
        const state = MACOS_RUNS.test(sentence)
          ? short || PARTIAL.test(sentence) ? 'in-progress' : 'works'
          : BROKEN.test(sentence) ? 'broken' : null;
        if (state) note('macos', state, sentence);
      }
      if (OTHER_OS.test(sentence)) continue;
      if (BOOT_DONE.test(sentence)) note('boot', BROKEN.test(sentence) || /\b(still no|close to|almost)\b/i.test(sentence) ? 'in-progress' : 'works', sentence);
      // "Working: A, B. Not working: C" and "A works but B doesn't": judge each clause.
      for (const clause of sentence.split(/\b(?:but|however|except)\b|(?=\bnot working\b)|(?=\bbroken\s*:)/i)) {
        for (const [area, re] of Object.entries(AREA_WORDS)) {
          if (!re.test(clause)) continue;
          let state = BROKEN.test(clause) ? 'broken' : PARTIAL.test(clause) ? 'in-progress' : WORKS.test(clause) ? 'works' : null;
          // "scanning works, but every request fails": started, not done.
          if (state === 'works' && FAILS.test(sentence)) state = 'in-progress';
          if (state) note(area, state, sentence);
        }
      }
    }
  }
  return [...out.values()];
}

if (CLAIMS) {
  // Newest thread last, so a later thread's word on an area wins.
  const latest = new Map(); // device|area -> claim
  for (const t of threads) {
    if (t.phones.length !== 1) continue;
    const slug = t.phones[0];
    for (const c of claimsOf(t)) latest.set(`${slug}|${c.area}`, { ...c, slug, date: day(t.p.created_utc), source: t.url, t });
  }
  const rows = new Map();
  for (const d of devices) for (const s of d.statuses ?? []) rows.set(`${d.slug}|${s.area_slug}`, s);
  // macOS claims are the macOS boot row (os macos, migration 0012).
  for (const d of devices) for (const s of d.os_statuses?.macos ?? []) if (s.area_slug === 'boot') rows.set(`${d.slug}|macos`, s);
  // reddit-map.json reject_claims: rows a person read and found the sentence does not say (about another phone, code merged but not run, ...).
  const rejected = new Set((REDDIT_MAP.reject_claims ?? []).map((r) => `${r.device}|${r.area}`));
  for (const [key, c] of latest) {
    if (rejected.has(key)) {
      report.skipped.push({ device: c.slug, area: c.area, why: 'reject_claims in reddit-map.json' });
      continue;
    }
    const cur = rows.get(key);
    const ours = !cur || cur.state === 'unknown' || /^reddit claim/i.test(cur.detail || '');
    if (!ours) {
      report.skipped.push({ device: c.slug, area: c.area, why: `kept the existing row (${cur.state}: ${String(cur.detail || '').slice(0, 80)})` });
      continue;
    }
    if (cur && cur.state !== 'unknown' && RANK[c.state] <= RANK[cur.state]) continue;
    const detail = `${TAG} (${c.date}): "${c.sentence}"`.slice(0, 2000);
    report.states.push({ device: c.slug, area: c.area, state: c.state, was: cur?.state ?? null, detail, source: c.source });
    if (APPLY) {
      try {
        await ensureDevice(c.slug, c.t);
        const target = c.area === 'macos' ? { area: 'boot', os: 'macos' } : { area: c.area, os: 'ios' };
        await api('PUT', `/api/status/${encodeURIComponent(c.slug)}/${encodeURIComponent(target.area)}`, { state: c.state, detail, source: c.source, os: target.os });
      } catch (e) {
        report.errors.push({ device: c.slug, area: c.area, error: String(e.message || e) });
      }
    }
  }
}

// ---------------------------------------------------------------- report

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
const count = (xs, a) => xs.filter((x) => x.action === a).length;
console.log(JSON.stringify({
  applied: APPLY,
  since,
  threads: threads.length,
  comments: comments.length,
  devices_added: count(report.devices, 'add'),
  posts_added: count(report.posts, 'add'),
  repos_added: count(report.forks, 'add'),
  repo_devices_added: count(report.forks, 'support'),
  states_written: report.states.length,
  claims_to_review: report.claims_to_review.length,
  repos_mentioned_by_others: report.repos_mentioned.length,
  skipped: report.skipped.length,
  errors: report.errors.length,
  report: REPORT,
}, null, 2));
if (report.errors.length) process.exitCode = 1;
